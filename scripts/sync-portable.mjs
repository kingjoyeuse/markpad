import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let destination = projectRoot;
if (!args.length) {
  // Current layout keeps the portable executable/runtime together under bin/.
  // Old projects with the executable at the root are still supported.
  const bin = path.join(projectRoot, 'bin');
  if (await fs.stat(path.join(bin, 'Markpad.exe')).then(stat => stat.isFile()).catch(() => false)) {
    destination = bin;
  }
}
if (args.length) {
  if (args.length !== 2 || args[0] !== '--destination') {
    console.error('Usage: node scripts/sync-portable.mjs [--destination PATH]');
    process.exit(1);
  }
  destination = path.resolve(args[1]);
}

const resources = path.join(destination, 'resources');
const deployed = path.join(resources, 'app');
const suffix = randomUUID();
const staged = path.join(resources, `.markpad-app-update-${suffix}`);
const previous = path.join(resources, `.markpad-app-previous-${suffix}`);

async function requireFile(file, message) {
  try {
    if (!(await fs.stat(file)).isFile()) throw new Error('Not a regular file');
  } catch {
    throw new Error(message);
  }
}

try {
  await requireFile(path.join(destination, 'Markpad.exe'),
    `No Markpad.exe was found in ${destination}. Markpad.exe and its support files should be together under bin/ (older builds used the project root). To create a runtime from source, run npm run package:win, then use --destination dist/Markpad-win32-x64.`);
  for (const relative of ['app/index.html', 'app/main.js', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/recovery.cjs']) {
    await requireFile(path.join(projectRoot, relative),
      `Missing ${relative}. Run npm run build from the source project, then run npm run build:portable again.`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  await fs.mkdir(resources, { recursive: true });
  await fs.mkdir(staged);
  await fs.cp(path.join(projectRoot, 'app'), path.join(staged, 'app'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'desktop'), path.join(staged, 'desktop'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'assets'), path.join(staged, 'assets'), { recursive: true });
  await fs.writeFile(path.join(staged, 'package.json'), JSON.stringify({
    name: manifest.name, productName: manifest.productName, version: manifest.version,
    description: manifest.description, private: true, type: 'module', main: 'desktop/main.cjs',
  }, null, 2) + '\n');

  let movedPrevious = false;
  try {
    try {
      await fs.rename(deployed, previous);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(staged, deployed);
    } catch (error) {
      if (movedPrevious) {
        try { await fs.rename(previous, deployed); }
        catch (rollbackError) {
          throw new Error(`The update failed and automatic restoration also failed. The previous application is preserved at ${previous}; move it back to ${deployed} after closing Markpad. Update error: ${error.message}. Restore error: ${rollbackError.message}`);
        }
      }
      throw error;
    }
  } catch (error) {
    throw new Error(`Could not replace the portable application's resources. Close all Markpad windows and rerun npm run build:portable. ${error.message}`);
  }

  if (movedPrevious) {
    try { await fs.rm(previous, { recursive: true }); }
    catch {
      console.warn(`The new application is installed. An old resource backup remains at ${previous}; close Markpad and remove that backup when convenient.`);
    }
  }
  console.log(`Updated the application launched by ${path.join(destination, 'Markpad.exe')}`);
  console.log('Restart Markpad to load this build. Your saved Markdown files and recovery drafts are unchanged.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
}
