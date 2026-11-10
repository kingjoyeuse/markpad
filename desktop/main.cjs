'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, session, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { RecoveryStore, atomicWrite, fingerprint, hashText, decodeMarkdown } = require('./recovery.cjs');
const { isReusableBlankDocument } = require('./open-target.cjs');
const { configurePortableProfile } = require('./runtime-profile.cjs');

const APP_HTML = path.join(__dirname, '..', 'app', 'index.html');
const APP_URL = pathToFileURL(APP_HTML).href;
const PRELOAD = path.join(__dirname, 'preload.cjs');
const APP_ICON = process.platform === 'win32' ? path.join(__dirname, '..', 'assets', 'markpad.ico') : path.join(__dirname, '..', 'assets', 'markpad.png');
const MAX_DOCUMENT_CHARS = 64 * 1024 * 1024;
const windows = new Map();
const saves = new Map();
const pendingOpenFiles = [];
let pendingNewWindows = 0;
let store;
let menuTimer;
let quitting = false;

app.setName('Markpad');
app.setAppUserModelId('com.markpad.editor');
try { configurePortableProfile(app); } catch (error) {
  dialog.showErrorBox('Markpad portable could not start', `${error.message}\n\nExtract Markpad to a writable folder. Your existing drafts have not been moved.`);
  app.exit(1);
  throw error;
}

// Each launch must create a NEW document window rather than activating an
// existing window. Retain the shared coordinator so concurrent drafts remain
// safe and multiple windows do not pay for separate Electron instances.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (!store) {
      const files = fileArguments(argv, workingDirectory);
      pendingOpenFiles.push(...files);
      if (!files.length) pendingNewWindows++;
      return;
    }
    // Never route an EXE launch through the Recent-file reuse/focus path.
    guarded(async () => {
      const files = fileArguments(argv, workingDirectory);
      if (files.length) for (const file of files) await openPath(file);
      else await newDocument();
    });
  });
  app.on('open-file', (event, file) => {
    event.preventDefault();
    if (store) guarded(() => openPath(file));
    else pendingOpenFiles.push(file);
  });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('Markpad could not start', error.message);
    app.quit();
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || quitting) app.quit(); });
app.on('activate', () => { if (store && !windows.size) guarded(newDocument); });
app.on('before-quit', () => { quitting = true; });

function guarded(action) {
  Promise.resolve().then(action).catch(error => dialog.showErrorBox('Markpad', error.message || String(error)));
}

function fileArguments(argv, workingDirectory = process.cwd()) {
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter(value => !value.startsWith('-') && /\.(?:md|markdown|txt)$/i.test(value))
    .map(value => path.resolve(workingDirectory, value));
}

function windowFor(contents) {
  const record = windows.get(contents.id);
  if (!record || record.window.isDestroyed()) throw new Error('This document window is no longer available');
  return record;
}

function assertSender(event) {
  const record = windowFor(event.sender);
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split(/[?#]/)[0] !== APP_URL) {
    throw new Error('This request did not come from the Markpad editor');
  }
  return record;
}

function markdownPayload(payload) {
  if (!payload || typeof payload.markdown !== 'string' || payload.markdown.length > MAX_DOCUMENT_CHARS) {
    throw new Error('The document is missing or exceeds the 64 MB text limit');
  }
  return payload.markdown;
}

function documentState(record) {
  return { ...store.get(record.id), ...record.identity };
}

function title(record, state) {
  const name = String(state.name || 'Untitled').replace(/[\r\n]/g, ' ').slice(0, 180);
  record.window.setTitle(`${state.dirty ? '* ' : ''}${name} — Markpad`);
}

function command(record, name) {
  if (record && !record.window.isDestroyed()) record.window.webContents.send('markpad:command', name);
}

function activeRecord() {
  const focused = BrowserWindow.getFocusedWindow();
  return focused ? windows.get(focused.webContents.id) : [...windows.values()].at(-1);
}

function scheduleMenu() {
  if (menuTimer) return;
  menuTimer = setTimeout(() => { menuTimer = null; buildMenu(); }, 400);
  menuTimer.unref?.();
}

function buildMenu() {
  const send = name => () => command(activeRecord(), name);
  const recentItems = store.list().slice(0, 15).map(entry => ({
    label: `${entry.dirty || !entry.path ? '● ' : ''}${entry.name.replace(/&/g, '&&')}${entry.path ? `  —  ${path.dirname(entry.path).replace(/&/g, '&&')}` : '  (unsaved draft)'}`,
    click: () => guarded(() => reopen(entry.id)),
  }));
  const templates = [
    {
      label: '&File', submenu: [
        { label: '&New Window', accelerator: 'CmdOrCtrl+N', click: () => guarded(newDocument) },
        { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Recent Files && Drafts', submenu: [
          ...recentItems,
          ...(recentItems.length ? [{ type: 'separator' }] : []),
          { label: 'All Recent Files && Drafts…', click: send('recent') },
        ] },
        { type: 'separator' },
        { label: '&Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save &As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { type: 'separator' },
        { label: '&Close Window (keep draft)', accelerator: 'CmdOrCtrl+W', click: () => activeRecord()?.window.close() },
        { label: 'E&xit', click: () => {
          quitting = true;
          for (const record of windows.values()) record.window.close();
          if (!windows.size) app.quit();
        } },
      ],
    },
    {
      label: '&Edit', submenu: [
        { label: '&Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: '&Redo', accelerator: 'CmdOrCtrl+Y', click: send('redo') }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }, { type: 'separator' },
        { label: '&Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: '&Replace…', accelerator: 'CmdOrCtrl+H', click: send('replace') },
        { type: 'separator' },
        // The renderer owns transfer shortcuts so NumpadEnter remains distinct
        // and the current editor/sheet selection is preserved. These menu labels
        // document them without registering a second accelerator handler.
        { label: 'Send Selection to Calculator  (Alt+Shift+Right)', click: send('send-to-calculator') },
        { label: 'Insert Calculator Result  (Alt+Shift+Left)', click: send('insert-calculator') },
        { label: 'Evaluate Selection Inline  (Ctrl+Alt+Shift+Right)', click: send('evaluate-inline') },
        { label: 'Send Selection to Spreadsheet  (Ctrl+Alt+Right)', click: send('send-to-spreadsheet') },
        { label: 'Insert Spreadsheet Cell  (Ctrl+Alt+Left)', click: send('insert-spreadsheet') },
      ],
    },
    {
      label: '&View', submenu: [
        { label: 'Formatted / Raw', accelerator: 'Ctrl+Tab', click: send('toggle-mode') },
        { label: 'Word Wrap', type: 'checkbox', checked: activeRecord()?.wordWrap ?? true, click: send('word-wrap-toggle') },
        { type: 'separator' },
        { label: 'Show Calculator', accelerator: 'Alt+Shift+Up', click: send('calculator-show') },
        { label: 'Hide Calculator', accelerator: 'Alt+Shift+Down', click: send('calculator-hide') },
        { label: 'Show Spreadsheet', accelerator: 'Ctrl+Alt+Up', click: send('spreadsheet-show') },
        { label: 'Hide Spreadsheet', accelerator: 'Ctrl+Alt+Down', click: send('spreadsheet-hide') },
        { type: 'separator' },
        { label: 'Appearance', submenu: ['system', 'light', 'dark'].map(theme => ({
          label: theme === 'system' ? 'System (default)' : theme[0].toUpperCase() + theme.slice(1),
          type: 'radio', checked: store.settings.theme === theme,
          click: () => guarded(() => applyTheme(theme)),
        })) },
        { type: 'separator' },
        { label: 'Reset Zoom (100%)', accelerator: 'CmdOrCtrl+0', click: send('zoom-reset') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
      ],
    },
    { label: '&Help', submenu: [
      { label: 'Keyboard Shortcuts', accelerator: 'F1', click: send('help') },
      { label: 'About Markpad', click: () => dialog.showMessageBox(activeRecord()?.window, {
        type: 'info', title: 'About Markpad', message: `Markpad ${app.getVersion()}`,
        detail: 'A local Markdown notepad with a calculator, spreadsheet, and recoverable drafts.\n\nClosing a window preserves its document in Recent Files & Drafts. Saving writes a plain Markdown file.',
      }) },
    ] },
  ];
  if (process.platform === 'darwin') templates.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(templates));
}

async function applyTheme(theme) {
  if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Unknown appearance');
  await store.setTheme(theme);
  nativeTheme.themeSource = theme;
  for (const record of windows.values()) record.window.webContents.send('markpad:theme', theme);
  buildMenu();
  return theme;
}

async function start() {
  store = await new RecoveryStore(path.join(app.getPath('userData'), 'recovery-v1')).init();
  nativeTheme.themeSource = store.settings.theme;
  // This is an offline application. Markdown cannot load remote frames, images,
  // scripts, or trackers; copied links remain ordinary document data.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|blob|devtools):/.test(details.url) });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIPC();
  buildMenu();
  const files = [...new Set([...fileArguments(process.argv), ...pendingOpenFiles])];
  if (files.length) {
    for (const file of files) {
      try { await openPath(file); }
      catch (error) { dialog.showErrorBox('Could not open file', `${file}\n\n${error.message}`); }
    }
  }
  if (!windows.size) await newDocument();
  for (let index = 0; index < pendingNewWindows; index++) await newDocument();
  if (store.warnings.length) {
    await dialog.showMessageBox(activeRecord().window, {
      type: 'warning', title: 'Recovery notice', message: 'Some recovery records needed attention.',
      detail: store.warnings.join('\n\n'),
    });
  }
}

async function createWindow(entry, recovered = false) {
  const window = new BrowserWindow({
    width: 1120, height: 790, minWidth: 600, minHeight: 420,
    show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#18191c' : '#ffffff',
    title: `${entry.name} — Markpad`, autoHideMenuBar: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, spellcheck: true,
      backgroundThrottling: true, devTools: !app.isPackaged,
    },
  });
  const record = {
    id: entry.id, window, recovered, wordWrap: true, closeAllowed: false, closePending: false,
    checkpointGeneration: 0, checkpointRequested: 0, closeGeneration: 0,
    closeTimer: null, identity: {}, saveQueue: Promise.resolve(),
  };
  const contentsId = window.webContents.id;
  windows.set(contentsId, record);
  title(record, entry);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input) => {
    // Ctrl+Tab is not a browser-tab action in Markpad. Handle it before Chromium
    // can consume it; preventing the event also suppresses the menu accelerator,
    // so one keypress always produces exactly one mode change.
    if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && input.key === 'Tab') {
      event.preventDefault();
      command(record, 'toggle-mode');
    }
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => {
    if (record.closeAllowed) return;
    event.preventDefault();
    if (record.closePending) return;
    record.closePending = true;
    record.closeGeneration = record.checkpointGeneration;
    command(record, 'prepare-close');
    armCloseTimeout(record);
  });
  window.on('closed', () => {
    clearTimeout(record.closeTimer);
    windows.delete(contentsId);
    scheduleMenu();
  });
  window.on('focus', scheduleMenu);
  window.webContents.on('render-process-gone', (_event, details) => {
    if (record.closeAllowed || window.isDestroyed()) return;
    guarded(async () => {
      record.closePending = false;
      clearTimeout(record.closeTimer);
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: 'Editor interrupted', message: 'The editor process stopped.',
        detail: `Your last completed recovery checkpoint is still available. Any typing after it may not have been saved.\n\nReason: ${details.reason}`,
        buttons: ['Restore last checkpoint', 'Keep window open'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) { record.recovered = true; await window.loadFile(APP_HTML); }
    });
  });
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    // The shell can briefly activate the previous process on Windows.
    // Focus the newly created document after its renderer is ready.
    window.show();
    window.focus();
  });
  try { await window.loadFile(APP_HTML); }
  catch (error) { record.closeAllowed = true; window.destroy(); throw error; }
  return { id: entry.id };
}

function armCloseTimeout(record) {
  clearTimeout(record.closeTimer);
  record.closeTimer = setTimeout(() => guarded(async () => {
    if (!record.closePending || record.window.isDestroyed()) return;
    const entry = documentState(record);
    const { response } = await dialog.showMessageBox(record.window, {
      type: 'warning', title: 'Waiting to preserve this document',
      message: 'Markpad has not finished writing this window’s recovery draft.',
      detail: `Keep the window open to protect the latest edits. Closing with the last checkpoint may lose more recent typing.\n\nLast checkpoint: ${entry.updatedAt}`,
      buttons: ['Keep waiting', 'Keep window open', 'Close with last checkpoint'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) armCloseTimeout(record);
    else if (response === 1) record.closePending = false;
    else {
      await store.close(record.id);
      record.closeAllowed = true;
      record.window.close();
    }
  }), 15000);
  record.closeTimer.unref?.();
}

async function newDocument() {
  const entry = await store.create();
  return createWindow(entry);
}

async function canonicalPath(file) {
  const absolute = path.resolve(file);
  try { return await fs.realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute));
  }
}

async function openPath(file, reusableRecord = null) {
  file = await canonicalPath(file);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose a regular text file');
  if (stat.size > MAX_DOCUMENT_CHARS) throw new Error('This file exceeds the 64 MB text limit');
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_DOCUMENT_CHARS) throw new Error('This file exceeds the 64 MB text limit');
  const markdown = decodeMarkdown(bytes);
  const identity = {
    path: file, name: path.basename(file),
    diskFingerprint: { hash: hashText(markdown), size: bytes.length, mtimeMs: stat.mtimeMs },
  };
  // File > Open reuses an *untouched, untitled* editor. Explicit launches,
  // file associations, and additional files still open independent windows.
  // The renderer flushes its current document before invoking this dialog,
  // so the persisted record reflects typing even within the debounce period.
  if (reusableRecord && !reusableRecord.window.isDestroyed() &&
      isReusableBlankDocument(documentState(reusableRecord))) {
    await store.update(reusableRecord.id, {
      ...identity, markdown, dirty: false, mode: 'formatted', closed: false,
    });
    reusableRecord.identity = identity;
    reusableRecord.recovered = false;
    title(reusableRecord, { name: identity.name, dirty: false });
    await reusableRecord.window.loadFile(APP_HTML);
    if (!reusableRecord.window.isDestroyed()) reusableRecord.window.focus();
    scheduleMenu();
    return { id: reusableRecord.id, reused: true };
  }
  const entry = await store.create({ ...identity, markdown, dirty: false });
  return createWindow(entry);
}

async function chooseOpen(record) {
  const { canceled, filePaths } = await dialog.showOpenDialog(record?.window, {
    title: 'Open Markdown', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown and text', extensions: ['md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled) return { canceled: true };
  // Reuse the current window for at most one file. Other selections always
  // get separate windows, keeping the chosen files independent.
  let reused = false;
  for (const [index, file] of filePaths.entries()) {
    const opened = await openPath(file, index === 0 ? record : null);
    reused ||= Boolean(opened.reused);
  }
  return { opened: filePaths.length, reused };
}

async function reopen(id) {
  if (typeof id !== 'string') throw new Error('Invalid recent document');
  const existing = [...windows.values()].find(record => record.id === id);
  if (existing) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.focus();
    return { id, focused: true };
  }
  let entry = store.get(id);
  if (!entry) throw new Error('This recent document no longer exists');
  if (entry.path && !entry.dirty) {
    try {
      const stat = await fs.stat(entry.path);
      if (!stat.isFile()) throw new Error('The recent path is no longer a regular text file');
      if (stat.size > MAX_DOCUMENT_CHARS) throw new Error('This file exceeds the 64 MB text limit');
      const bytes = await fs.readFile(entry.path);
      if (bytes.length > MAX_DOCUMENT_CHARS) throw new Error('This file exceeds the 64 MB text limit');
      const markdown = decodeMarkdown(bytes);
      // Fingerprint the exact bytes represented in this window, not a second
      // read that could see a different external version in the meantime.
      entry = await store.update(id, {
        markdown, closed: false,
        diskFingerprint: { hash: hashText(markdown), size: Buffer.byteLength(markdown, 'utf8') },
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // The file vanished, but its last content is still recoverable. Do not
      // silently create/overwrite the original path on Save.
      entry = await store.update(id, { path: null, dirty: true, closed: false, diskFingerprint: null });
    }
  } else entry = await store.update(id, { closed: false });
  return createWindow(entry, true);
}

function serializeFile(file, operation) {
  const key = process.platform === 'win32' ? file.toLowerCase() : file;
  const before = saves.get(key) || Promise.resolve();
  const next = before.catch(() => {}).then(operation);
  saves.set(key, next);
  return next.finally(() => { if (saves.get(key) === next) saves.delete(key); });
}

async function chooseSave(record, entry) {
  const proposedName = entry.name === 'Untitled' ? 'Untitled.md' :
    path.extname(entry.name) ? entry.name : `${entry.name}.md`;
  const choice = await dialog.showSaveDialog(record.window, {
    title: 'Save Markdown', defaultPath: entry.path || proposedName,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (choice.canceled || !choice.filePath) return null;
  return canonicalPath(path.extname(choice.filePath) ? choice.filePath : choice.filePath + '.md');
}

async function save(record, payload, generationAtRequest) {
  const markdown = markdownPayload(payload);
  let entry = documentState(record);
  let file = payload.saveAs || !entry.path ? await chooseSave(record, entry) : entry.path;
  if (!file) return { canceled: true, saved: false };
  let acceptedFingerprint = file === entry.path ? entry.diskFingerprint : await fingerprint(file);
  for (;;) {
    const result = await serializeFile(file, async () => {
      const current = await fingerprint(file);
      if ((current?.hash || null) !== (acceptedFingerprint?.hash || null)) {
        const { response } = await dialog.showMessageBox(record.window, {
          type: 'warning', title: 'File changed outside this window',
          message: `“${path.basename(file)}” has changed since this window last read or saved it.`,
          detail: 'Save a copy to keep both versions, or explicitly replace the file with this window’s contents.',
          buttons: ['Save a copy…', 'Replace file', 'Cancel'], defaultId: 0, cancelId: 2,
        });
        if (response === 0) return { copy: true };
        if (response === 2) return { canceled: true, saved: false };
      }
      await atomicWrite(file, markdown);
      // The saved snapshot is the baseline even if another application edits
      // the file immediately after our atomic rename. The next Save then detects it.
      const diskFingerprint = { hash: hashText(markdown), size: Buffer.byteLength(markdown, 'utf8') };
      const identity = { path: file, name: path.basename(file), diskFingerprint };
      record.identity = identity;
      let recoveryError = null;
      let recoveryEntry;
      try {
        recoveryEntry = await store.update(record.id, currentEntry => {
          // A newer checkpoint may have completed while the native save dialog
          // or disk write was pending. Save only its identity/baseline; keep its
          // newer text as a dirty recovery draft instead of replacing it.
          const latestMarkdown = record.checkpointRequested > generationAtRequest ? currentEntry.markdown : markdown;
          return {
            ...identity, markdown: latestMarkdown,
            dirty: hashText(latestMarkdown) !== diskFingerprint.hash, closed: false,
          };
        });
      }
      catch (error) {
        recoveryError = error.message;
        dialog.showErrorBox('File saved; recovery needs attention', `The Markdown file was saved successfully to:\n${file}\n\nThe recovery record could not be updated. Keep the window open until a later checkpoint succeeds.\n\n${error.message}`);
      }
      title(record, recoveryEntry || { ...identity, dirty: true });
      scheduleMenu();
      return { saved: true, path: file, name: identity.name, recoveryError, dirty: recoveryEntry?.dirty ?? true };
    });
    if (!result.copy) return result;
    entry = documentState(record);
    file = await chooseSave(record, { ...entry, path: null, name: `${path.parse(entry.name).name}-copy` });
    if (!file) return { canceled: true, saved: false };
    acceptedFingerprint = await fingerprint(file);
  }
}

function registerIPC() {
  const handle = (name, callback) => ipcMain.handle(`markpad:${name}`, (event, value) => callback(assertSender(event), value));
  handle('bootstrap', record => {
    const entry = documentState(record);
    return {
      id: entry.id, name: entry.name, path: entry.path, markdown: entry.markdown,
      savedBytes: entry.diskFingerprint?.size ?? 0, dirty: entry.dirty, theme: store.settings.theme, recovered: record.recovered, mode: entry.mode || 'formatted',
    };
  });
  handle('checkpoint', async (record, payload) => {
    const markdown = markdownPayload(payload);
    record.checkpointRequested++;
    const patch = currentEntry => {
      // Resolve identity when this queued write actually executes. A Save As
      // may have changed the path since the checkpoint was requested.
      const previous = { ...currentEntry, ...record.identity };
      const dirty = previous.path ? hashText(markdown) !== previous.diskFingerprint?.hash : markdown.length > 0;
      return {
        ...record.identity, markdown, dirty, closed: false,
        mode: payload.mode === 'raw' ? 'raw' : 'formatted',
        name: previous.path ? path.basename(previous.path) : String(payload.name || previous.name || 'Untitled').slice(0, 180),
      };
    };
    let entry;
    try { entry = await store.update(record.id, patch); }
    catch (error) {
      // The renderer displays the write error. A later close attempt must be
      // allowed to retry the checkpoint instead of leaving close permanently pending.
      if (record.closePending) {
        record.closePending = false;
        clearTimeout(record.closeTimer);
      }
      throw error;
    }
    record.checkpointGeneration++;
    title(record, entry);
    scheduleMenu();
    return { updatedAt: entry.updatedAt, dirty: entry.dirty };
  });
  handle('save', (record, payload) => {
    markdownPayload(payload);
    const generationAtRequest = record.checkpointRequested;
    const next = record.saveQueue.catch(() => {}).then(() => save(record, payload, generationAtRequest));
    record.saveQueue = next;
    return next;
  });
  handle('open', chooseOpen);
  handle('new-window', () => newDocument());
  handle('recents', () => store.list());
  handle('open-recent', (_record, id) => reopen(id));
  handle('remove-recent', async (record, id) => {
    if (typeof id !== 'string') throw new Error('Invalid recent document');
    const entry = store.get(id);
    if (!entry) return { removed: false };
    if ([...windows.values()].some(item => item.id === id)) throw new Error('Close this document before removing it from Recent Files & Drafts');
    const { response } = await dialog.showMessageBox(record.window, {
      type: 'warning', title: 'Remove recovery draft?',
      message: `Remove “${entry.name}” from Recent Files & Drafts?`,
      detail: entry.dirty || !entry.path ? 'Its stored unsaved edits will be deleted. This cannot be undone. Any saved Markdown file is left unchanged.' : 'The recovery copy will be removed. The saved Markdown file is left unchanged.',
      buttons: ['Cancel', 'Remove'], defaultId: 0, cancelId: 0,
    });
    if (response !== 1) return { removed: false };
    await store.forget(id);
    buildMenu();
    return { removed: true };
  });
  handle('theme', (_record, theme) => applyTheme(theme));
  handle('zoom', (record, percent) => {
    if (!Number.isInteger(percent) || percent < 50 || percent > 300 || percent % 10 !== 0) {
      throw new Error('Unsupported zoom level');
    }
    record.window.webContents.setZoomFactor(percent / 100);
    return { percent };
  });
  handle('word-wrap', (record, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid word wrap preference');
    record.wordWrap = enabled;
    scheduleMenu();
    return { enabled };
  });
  handle('title', (record, state) => {
    if (!state || typeof state.name !== 'string') throw new Error('Invalid title');
    title(record, { name: state.name, dirty: !!state.dirty });
  });
  handle('read-clipboard', () => clipboard.readText());
  handle('write-clipboard', (_record, text) => {
    if (typeof text !== 'string' || text.length > MAX_DOCUMENT_CHARS) throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
    return { written: true };
  });
  handle('close', record => { record.window.close(); return { requested: true }; });
  handle('ready-to-close', async record => {
    if (!record.closePending) return { closed: false };
    if (record.checkpointGeneration <= record.closeGeneration) throw new Error('Write the latest recovery checkpoint before closing');
    try {
      await record.saveQueue.catch(() => {});
      await store.close(record.id);
    }
    catch (error) {
      record.closePending = false;
      clearTimeout(record.closeTimer);
      throw error;
    }
    clearTimeout(record.closeTimer);
    record.closeAllowed = true;
    record.window.close();
    return { closed: true };
  });
}
