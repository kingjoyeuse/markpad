'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Apply portable storage before Electron's single-instance lock or ready event.
 * A writable folder is required; never silently strand drafts in another profile.
 */
function configurePortableProfile(app, executable = process.execPath) {
  if (!app.isPackaged) return null;
  const directory = path.dirname(executable);
  const marker = path.join(directory, 'markpad-portable.json');
  if (!fs.existsSync(marker)) return null;
  const config = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (config.format !== 1 || config.productId !== 'com.markpad.editor') {
    throw new Error('The portable configuration is invalid. Restore markpad-portable.json from the portable ZIP.');
  }
  const profile = path.join(directory, 'data');
  fs.mkdirSync(profile, { recursive: true });
  fs.accessSync(profile, fs.constants.W_OK);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  fs.mkdirSync(path.join(profile, 'Crashpad'), { recursive: true });
  app.setPath('crashDumps', path.join(profile, 'Crashpad'));
  return profile;
}
module.exports = { configurePortableProfile };
