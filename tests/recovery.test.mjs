import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RecoveryStore, atomicWrite, fingerprint, hashText, decodeMarkdown } = require('../desktop/recovery.cjs');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markpad-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('independent windows retain different unsaved drafts after restart', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  const first = await store.create();
  const second = await store.create();
  assert.notEqual(first.id, second.id);
  await Promise.all([
    store.update(first.id, { markdown: '# First\n\nUnsent notes.', dirty: true }),
    store.update(second.id, { markdown: '# Second\n\nA different document.', dirty: true }),
  ]);
  await store.close(first.id);
  await store.close(second.id);
  const reopened = await new RecoveryStore(directory).init();
  assert.equal(reopened.get(first.id).markdown, '# First\n\nUnsent notes.');
  assert.equal(reopened.get(second.id).markdown, '# Second\n\nA different document.');
  assert.equal(reopened.get(first.id).closed, true);
  assert.equal(reopened.list().filter(entry => entry.kind === 'draft').length, 2);
});

test('an edited saved file remains a recovery draft without changing the disk file', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'notes.md');
  await fs.writeFile(file, 'Original notes.');
  const store = await new RecoveryStore(path.join(directory, 'recovery')).init();
  const entry = await store.create({ name: 'notes.md', path: file, markdown: 'Original notes.', diskFingerprint: await fingerprint(file) });
  await store.update(entry.id, { markdown: 'Unsaved changes, including a worksheet.', dirty: true });
  await store.close(entry.id);
  assert.equal(await fs.readFile(file, 'utf8'), 'Original notes.');
  const restarted = await new RecoveryStore(path.join(directory, 'recovery')).init();
  assert.equal(restarted.get(entry.id).markdown, 'Unsaved changes, including a worksheet.');
  assert.equal(restarted.get(entry.id).dirty, true);
  assert.equal(restarted.list()[0].kind, 'draft');
});

test('a corrupted latest record restores the last validated backup', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  const entry = await store.create({ markdown: 'Earlier good version', dirty: true });
  await store.update(entry.id, { markdown: 'Later good version' });
  await fs.writeFile(path.join(directory, `${entry.id}.json`), '{broken');
  const restarted = await new RecoveryStore(directory).init();
  assert.equal(restarted.get(entry.id).markdown, 'Earlier good version');
  assert.match(restarted.warnings.join('\n'), /backup/);
  await restarted.update(entry.id, { markdown: 'Resumed writing' });
  const backup = JSON.parse(await fs.readFile(path.join(directory, `${entry.id}.json.bak`), 'utf8'));
  assert.equal(backup.markdown, 'Earlier good version');
});

test('queued updates and close retain the final keystroke snapshot', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  const entry = await store.create();
  const writes = [];
  for (const markdown of ['a', 'ab', 'abc', 'abcd']) writes.push(store.update(entry.id, { markdown, dirty: true }));
  writes.push(store.close(entry.id));
  await Promise.all(writes);
  const restarted = await new RecoveryStore(directory).init();
  assert.equal(restarted.get(entry.id).markdown, 'abcd');
  assert.equal(restarted.get(entry.id).closed, true);
});

test('save completion merges a new file identity without replacing a later queued edit', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  const entry = await store.create({ markdown: 'Snapshot being saved', dirty: true });
  const laterEdit = store.update(entry.id, { markdown: 'Newer typing while saving', dirty: true });
  const completedSave = store.update(entry.id, current => ({
    path: path.join(directory, 'saved.md'), name: 'saved.md',
    diskFingerprint: { hash: hashText('Snapshot being saved') },
    dirty: hashText(current.markdown) !== hashText('Snapshot being saved'),
  }));
  await Promise.all([laterEdit, completedSave]);
  await store.close(entry.id);
  const restarted = await new RecoveryStore(directory).init();
  assert.equal(restarted.get(entry.id).markdown, 'Newer typing while saving');
  assert.equal(restarted.get(entry.id).name, 'saved.md');
  assert.equal(restarted.get(entry.id).dirty, true);
});

test('forget removes only the selected recovery record, never its original file', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'keep.md');
  await fs.writeFile(file, 'Keep this file.');
  const store = await new RecoveryStore(path.join(directory, 'recovery')).init();
  const first = await store.create({ name: 'keep.md', path: file, markdown: 'Changed draft', dirty: true });
  const second = await store.create({ markdown: 'Other draft', dirty: true });
  await store.update(first.id, { markdown: 'Changed again' });
  await store.forget(first.id);
  const restarted = await new RecoveryStore(path.join(directory, 'recovery')).init();
  assert.equal(restarted.get(first.id), null);
  assert.equal(restarted.get(second.id).markdown, 'Other draft');
  assert.equal(await fs.readFile(file, 'utf8'), 'Keep this file.');
});

test('atomic file save replaces exact UTF-8 data and fingerprints detect outside edits', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'unicode.md');
  await atomicWrite(file, '# Original\r\n');
  const original = await fingerprint(file);
  await atomicWrite(file, '# € café\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  const saved = await fingerprint(file);
  assert.notEqual(saved.hash, original.hash);
  assert.equal(saved.hash, hashText(await fs.readFile(file, 'utf8')));
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
  await fs.writeFile(file, 'Changed elsewhere');
  assert.notEqual((await fingerprint(file)).hash, saved.hash);
});

test('theme defaults to system, persists, and rejects unknown values', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  assert.equal(store.settings.theme, 'system');
  await store.setTheme('dark');
  assert.equal((await new RecoveryStore(directory).init()).settings.theme, 'dark');
  await assert.rejects(() => store.setTheme('blue'), /Unknown theme/);
});

test('invalid recovery records and invalid document patches cannot select disk paths', async t => {
  const directory = await temporary(t);
  const store = await new RecoveryStore(directory).init();
  const entry = await store.create({ id: '../escape', markdown: 'Safe', dirty: true });
  assert.match(entry.id, /^[a-f\d-]{36}$/i);
  await assert.rejects(() => store.update(entry.id, { markdown: null }), /Invalid document state/);
  assert.equal(store.get(entry.id).markdown, 'Safe');
});

test('UTF-8 decoding preserves BOM and line endings and rejects lossy or UTF-16 input', () => {
  const source = '\uFEFF# € café\r\n\r\nA final line.\r\n';
  const bytes = Buffer.from(source, 'utf8');
  const decoded = decodeMarkdown(bytes);
  assert.equal(decoded, source);
  assert.deepEqual(Buffer.from(decoded, 'utf8'), bytes);
  assert.throws(() => decodeMarkdown(Buffer.from([0x66, 0x6f, 0x80, 0x6f])), /not valid UTF-8/);
  assert.throws(() => decodeMarkdown(Buffer.from([0xff, 0xfe, 0x41, 0x00])), /UTF-16/);
  assert.throws(() => decodeMarkdown(Buffer.from('hello', 'utf16le')), /UTF-16/);
});
