import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Use the downloader shipped with this exact Electron package. This keeps proxy
// handling and runtime checksum behaviour aligned with Electron's own installer.
const electronRequire = createRequire(require.resolve('electron/package.json'));
const { downloadArtifact } = electronRequire('@electron/get');
const { extract } = await import('@electron-internal/extract-zip');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const runtime = require('electron/package.json');
const checksums = require('electron/checksums.json');
const destination = path.join(root, 'dist', 'Markpad-win32-x64');
const appDestination = path.join(destination, 'resources', 'app');

await fs.access(path.join(root, 'app', 'index.html'));
console.log(`Downloading/verifying Electron ${runtime.version} for Windows x64…`);
const archive = await downloadArtifact({
  version: runtime.version, artifactName: 'electron', platform: 'win32', arch: 'x64', checksums,
});
// This is generated output: start fresh so a later distribution cannot inherit stale files.
await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(destination, { recursive: true });
await extract(archive, { dir: destination });
await fs.rm(appDestination, { recursive: true, force: true });
await fs.mkdir(appDestination, { recursive: true });
await fs.cp(path.join(root, 'app'), path.join(appDestination, 'app'), { recursive: true });
await fs.cp(path.join(root, 'desktop'), path.join(appDestination, 'desktop'), { recursive: true });
await fs.cp(path.join(root, 'assets'), path.join(appDestination, 'assets'), { recursive: true });
const packagedManifest = {
  name: manifest.name, productName: manifest.productName, version: manifest.version,
  description: manifest.description, private: true, type: 'module', main: 'desktop/main.cjs',
};
await fs.writeFile(path.join(appDestination, 'package.json'), JSON.stringify(packagedManifest, null, 2) + '\n');
// The app imports no Node packages at runtime. Editor dependencies are already
// bundled into app/, so the development node_modules tree is not shipped.
await fs.rm(path.join(destination, 'resources', 'default_app.asar'), { force: true });
await fs.rm(path.join(destination, 'Markpad.exe'), { force: true });
await fs.rename(path.join(destination, 'electron.exe'), path.join(destination, 'Markpad.exe'));
// Windows icon resources must be embedded in the PE executable. BrowserWindow's
// PNG icon alone is not enough for Explorer, .exe, and pinned shortcuts.
if (process.platform === 'win32') {
  const { spawnSync } = await import('node:child_process');
  const script = path.join(root, 'scripts', 'Apply-Markpad-Icon.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Exe', path.join(destination, 'Markpad.exe'), '-IconOnly',
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not embed the Markpad icon into the Windows executable.');
} else {
  console.warn('The Windows EXE was assembled on a non-Windows host. Run Apply-Markpad-Icon.cmd on Windows to embed the branded EXE icon.');
}

for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  try {
    await fs.copyFile(path.join(root, name), path.join(destination, name === 'LICENSE' ? 'MARKPAD-LICENSE' : name));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Keep Electron's LICENSE, LICENSES.chromium.html, locales, and all DLL/resource
// files. They are required runtime/legal files, not disposable build debris.
await fs.writeFile(path.join(destination, 'START-HERE.txt'), [
  'Markpad — Windows x64 portable build', '',
  'Extract the whole folder before launching Markpad.exe.',
  'No Node.js installation is required to run this package.',
  'Keep Markpad.exe beside the DLLs, resources folder, and other bundled files.',
  'Launching Markpad again opens another independent document window.',
  'Closed documents and unsaved edits remain in File > Recent Files & Drafts.',
  '',
  'This development build is not code signed. Its Windows runtime has been',
  'packaged from the official Electron distribution with checksum verification.',
  'For current verification results and known limitations, see README.md.',
  '',
].join('\r\n'));
console.log(`Windows portable application: ${destination}`);
