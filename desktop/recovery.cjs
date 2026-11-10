'use strict';

// All mutation queues live in the single desktop main process. Each document has
// its own durable record: closing one window can never replace another draft.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function decodeMarkdown(bytes) {
  if (bytes.includes(0)) {
    throw new Error('This file contains NUL bytes and may use UTF-16 or a binary format. Convert it to UTF-8 before opening it in Markpad.');
  }
  try {
    // ignoreBOM:true preserves a UTF-8 BOM as U+FEFF for exact source roundtrip.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('This file is not valid UTF-8 text. Convert it to UTF-8 before opening it in Markpad; the original file has not been changed.');
  }
}

async function fingerprint(file) {
  try {
    const bytes = await fs.readFile(file);
    const stat = await fs.stat(file);
    return { hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// A failed replacement never deletes/truncates the original. The temporary file
// is in the destination directory, so the rename stays on one filesystem.
async function atomicWrite(file, data) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.markpad-${randomUUID()}.tmp`);
  let handle;
  try {
    let mode = 0o600;
    try { mode = (await fs.stat(file)).mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(data, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    // Windows antivirus/indexers may briefly hold a file. Retry only the atomic
    // rename; do not use the dangerous unlink-original/rename fallback.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    if (process.platform !== 'win32') {
      let directoryHandle;
      try {
        directoryHandle = await fs.open(directory, 'r');
        await directoryHandle.sync();
      } catch (error) {
        // Not every filesystem supports directory fsync. File data has already
        // been synced, and the atomic rename has already succeeded.
        if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF'].includes(error.code)) throw error;
      } finally { await directoryHandle?.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function validEntry(value, expectedId) {
  return !!value && value.version === 1 && value.id === expectedId &&
    /^[a-f\d-]{36}$/i.test(value.id) && typeof value.markdown === 'string' &&
    typeof value.name === 'string' && typeof value.dirty === 'boolean' &&
    (value.path === null || typeof value.path === 'string') &&
    typeof value.updatedAt === 'string';
}

const clone = value => structuredClone(value);

class RecoveryStore {
  constructor(directory) {
    this.directory = directory;
    this.entries = new Map();
    this.settings = { theme: 'system' };
    this.warnings = [];
    this.queue = Promise.resolve();
  }

  serial(operation) {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = await fs.readdir(this.directory);
    const ids = new Set(names.map(name => /^([a-f\d-]{36})\.json(?:\.bak)?$/i.exec(name)?.[1]).filter(Boolean));
    for (const id of ids) {
      const file = path.join(this.directory, `${id}.json`);
      let loaded = false;
      for (const suffix of ['', '.bak']) {
        try {
          const value = JSON.parse(await fs.readFile(file + suffix, 'utf8'));
          if (!validEntry(value, id)) throw new Error('Invalid document record');
          this.entries.set(id, value);
          if (suffix) this.warnings.push(`Recovered a backup for “${value.name}”. Its most recent checkpoint was damaged.`);
          loaded = true;
          break;
        } catch (error) {
          if (suffix && error.code !== 'ENOENT') this.warnings.push(`A damaged recovery record (${id}) was preserved on disk for manual recovery.`);
        }
      }
      if (!loaded) this.warnings.push(`Could not read a recovery record (${id}). Its files have been preserved.`);
    }
    for (const suffix of ['', '.bak']) {
      try {
        const settings = JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json' + suffix), 'utf8'));
        if (['system', 'light', 'dark'].includes(settings.theme)) this.settings.theme = settings.theme;
        break;
      } catch { /* First run, or use the backup/default. */ }
    }
    return this;
  }

  get(id) { const entry = this.entries.get(id); return entry ? clone(entry) : null; }

  async create(initial = {}) {
    return this.serial(async () => {
      const now = new Date().toISOString();
      const entry = {
        version: 1, id: randomUUID(), name: 'Untitled', path: null,
        markdown: '', dirty: false, mode: 'formatted', createdAt: now,
        updatedAt: now, closed: false, diskFingerprint: null,
        ...initial,
      };
      // IDs are generated here; incoming filenames or content cannot choose paths.
      entry.version = 1;
      entry.id = randomUUID();
      if (!validEntry(entry, entry.id)) throw new Error('Invalid document state');
      await atomicWrite(path.join(this.directory, `${entry.id}.json`), JSON.stringify(entry));
      this.entries.set(entry.id, entry);
      return clone(entry);
    });
  }

  async update(id, patch) {
    return this.serial(async () => {
      const previous = this.entries.get(id);
      if (!previous) throw new Error('Document recovery record no longer exists');
      const changes = typeof patch === 'function' ? patch(clone(previous)) : patch;
      const entry = { ...previous, ...changes, version: 1, id, updatedAt: new Date().toISOString() };
      if (!validEntry(entry, id)) throw new Error('Invalid document state');
      const file = path.join(this.directory, `${id}.json`);
      // Backup the last validated in-memory record, not potentially damaged bytes.
      await atomicWrite(file + '.bak', JSON.stringify(previous));
      await atomicWrite(file, JSON.stringify(entry));
      this.entries.set(id, entry);
      return clone(entry);
    });
  }

  async close(id) { return this.update(id, { closed: true }); }

  list() {
    const entries = [...this.entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const seenFiles = new Set();
    const recents = [];
    for (const entry of entries) {
      if (!entry.path && !entry.markdown && !entry.dirty) continue;
      const key = process.platform === 'win32' ? entry.path?.toLowerCase() : entry.path;
      if (entry.path && !entry.dirty) {
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
      }
      recents.push({
        id: entry.id, name: entry.name, path: entry.path, updatedAt: entry.updatedAt,
        dirty: entry.dirty, closed: entry.closed, kind: entry.dirty || !entry.path ? 'draft' : 'file',
        excerpt: entry.markdown.replace(/<!--[^]*?-->/g, '').replace(/[\s#*_>`]+/g, ' ').trim().slice(0, 140),
      });
    }
    return recents;
  }

  async forget(id) {
    return this.serial(async () => {
      if (!this.entries.has(id)) return;
      const file = path.join(this.directory, `${id}.json`);
      // Remove the backup first so a successfully forgotten entry cannot reappear.
      await fs.unlink(file + '.bak').catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      this.entries.delete(id);
    });
  }

  async setTheme(theme) {
    if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Unknown theme');
    return this.serial(async () => {
      const settings = { ...this.settings, theme };
      const file = path.join(this.directory, 'settings.json');
      await atomicWrite(file + '.bak', JSON.stringify(this.settings));
      await atomicWrite(file, JSON.stringify(settings));
      this.settings = settings;
      return clone(settings);
    });
  }

  async flush() { await this.queue; }
}

module.exports = { RecoveryStore, atomicWrite, fingerprint, hashText, decodeMarkdown };
