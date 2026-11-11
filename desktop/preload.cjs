'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, value) => ipcRenderer.invoke(`markpad:${name}`, value);
contextBridge.exposeInMainWorld('markpad', Object.freeze({
  bootstrap: () => invoke('bootstrap'),
  checkpoint: state => invoke('checkpoint', state),
  save: state => invoke('save', state),
  open: () => invoke('open'),
  newDocument: () => invoke('new-document'),
  newWindow: () => invoke('new-window'),
  setPanes: state => invoke('panes', state),
  listRecents: () => invoke('recents'),
  openRecent: id => invoke('open-recent', id),
  removeRecent: id => invoke('remove-recent', id),
  setTheme: theme => invoke('theme', theme),
  setZoom: percent => invoke('zoom', percent),
  setWordWrap: enabled => invoke('word-wrap', enabled),
  setTitle: state => invoke('title', state),
  close: () => invoke('close'),
  readyToClose: () => invoke('ready-to-close'),
  readClipboard: () => invoke('read-clipboard'),
  writeClipboard: text => invoke('write-clipboard', text),
  onCommand: callback => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('markpad:command', handler);
    return () => ipcRenderer.removeListener('markpad:command', handler);
  },
  onTheme: callback => {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on('markpad:theme', handler);
    return () => ipcRenderer.removeListener('markpad:theme', handler);
  },
}));
