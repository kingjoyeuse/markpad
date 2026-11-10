'use strict';

// Isolated renderer fixture: this deliberately does not load desktop/main.cjs,
// install native menus, or touch a user's Markpad recovery directory.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const directory = process.env.MARKPAD_SHEET_FIXTURE;
if (!directory) throw new Error('Run this harness through tests/sheet-smoke.py.');
app.setPath('userData', path.join(directory, 'profile'));
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 900, height: 700, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  return window.loadFile(path.join(directory, 'fixture.html'));
}).catch(error => { console.error(error); app.exit(1); });
