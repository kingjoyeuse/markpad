'use strict';

// Test entry point only. The production app never imports this file.
// A supplied isolated profile is mandatory: tests must not touch real drafts.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

if (!process.env.MARKPAD_SMOKE_PROFILE) throw new Error('MARKPAD_SMOKE_PROFILE must name an isolated test profile');
app.setPath('userData', process.env.MARKPAD_SMOKE_PROFILE);

// Some cloud containers deny Unix-domain sockets. In that environment only,
// explicitly opt out of the OS singleton check so real renderer/IPC/file tests
// can run. This means OS-level second-launch routing is NOT tested in that run.
if (process.env.MARKPAD_SMOKE_SKIP_SINGLETON === '1') app.requestSingleInstanceLock = () => true;

let firstWindow = true;
app.on('browser-window-created', (_event, window) => {
  if (!firstWindow) return;
  firstWindow = false;
  window.webContents.once('did-finish-load', async () => {
    const rendererMs = await window.webContents.executeJavaScript(`new Promise(resolve => {
      const probe = () => {
        if (document.querySelector('#document-name')?.textContent === 'opened.md' && document.querySelector('.tiptap h1')) resolve(performance.now());
        else requestAnimationFrame(probe);
      };
      probe();
    })`);
    console.log('MARKPAD_STARTUP ' + JSON.stringify({ processElapsedMs: process.uptime() * 1000, rendererMs }));
  });
});

require(path.join(__dirname, '..', 'desktop', 'main.cjs'));

let samples = 0;
const timer = setInterval(async () => {
  if (!app.isReady() || BrowserWindow.getAllWindows().length !== 6) return;
  const metrics = app.getAppMetrics();
  let pssKb = 0;
  let privateKb = 0;
  let memoryReadable = true;
  for (const metric of metrics) {
    try {
      const text = await fs.readFile(`/proc/${metric.pid}/smaps_rollup`, 'utf8');
      pssKb += Number(/^Pss:\s+(\d+)/m.exec(text)?.[1] || 0);
      privateKb += Number(/^Private_Clean:\s+(\d+)/m.exec(text)?.[1] || 0) + Number(/^Private_Dirty:\s+(\d+)/m.exec(text)?.[1] || 0);
    } catch { memoryReadable = false; }
  }
  console.log('MARKPAD_METRICS ' + JSON.stringify({
    at: new Date().toISOString(), windows: 6, processes: metrics.length,
    rssKb: metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0),
    pssKb: memoryReadable ? pssKb : null,
    privateKb: memoryReadable ? privateKb : null,
    memoryReadable,
    cpuPercent: metrics.reduce((sum, metric) => sum + (metric.cpu?.percentCPUUsage || 0), 0),
    details: metrics.map(metric => ({ type: metric.type, pid: metric.pid, rssKb: metric.memory?.workingSetSize, cpu: metric.cpu?.percentCPUUsage })),
  }));
  if (++samples >= 5) clearInterval(timer);
}, 3000);
timer.unref();
