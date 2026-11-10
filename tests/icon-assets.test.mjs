import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const iconPath = new URL('../assets/markpad.ico', import.meta.url);
const pngPath = new URL('../assets/markpad.png', import.meta.url);

test('native window icon is an actual transparent 256px PNG', async () => {
  const png = await readFile(pngPath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
  assert.equal(png[25], 6, 'RGBA PNG with alpha transparency');
});

test('Windows icon has valid multi-resolution ICO resource entries', async () => {
  const ico = await readFile(iconPath);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 6);
  const sizes = new Set();
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const width = ico[entry] || 256;
    const height = ico[entry + 1] || 256;
    assert.equal(width, height);
    sizes.add(width);
    const size = ico.readUInt32LE(entry + 8);
    const start = ico.readUInt32LE(entry + 12);
    assert.ok(size > 0 && start >= 6 + count * 16 && start + size <= ico.length);
  }
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.has(size), `missing ${size}px icon`);
});

test('native window and Windows packaging both include the branded icon', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const pkg = await readFile(new URL('../scripts/package-win.mjs', import.meta.url), 'utf8');
  const sync = await readFile(new URL('../scripts/sync-portable.mjs', import.meta.url), 'utf8');
  assert.match(main, /icon:\s*APP_ICON/);
  assert.match(main, /assets', 'markpad\.png'/);
  assert.match(pkg, /Apply-Markpad-Icon\.ps1/);
  assert.match(pkg, /appDestination, 'assets'/);
  assert.match(sync, /path\.join\(bin, 'Markpad\.exe'\)/);
  assert.match(sync, /staged, 'assets'/);
});
