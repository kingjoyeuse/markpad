import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { isReusableBlankDocument } = require('../desktop/open-target.cjs');

test('File > Open reuses only untouched untitled blank documents', () => {
  const blank = { name:'Untitled', path:null, markdown:'', dirty:false };
  assert.equal(isReusableBlankDocument(blank), true);
  for (const changes of [
    { markdown:' ' }, { markdown:'\n' }, { markdown:'# Draft' },
    { markdown:'<!--markpad:workbook-->\n' }, { dirty:true },
    { path:'C:\\notes\\blank.md' }, { name:'Already named' },
    { markdown:null },
  ]) assert.equal(isReusableBlankDocument({ ...blank, ...changes }), false, JSON.stringify(changes));
  assert.equal(isReusableBlankDocument(null), false);
});

test('native File > Open flushes the renderer and can reload into the same window', () => {
  const main = readFileSync('desktop/main.cjs','utf8');
  const renderer = readFileSync('src/main.js','utf8');
  assert.match(main, /label: '&Open…', accelerator: 'CmdOrCtrl\+O', click: send\('open'\)/);
  assert.match(renderer, /if\(action==='open'\)\{sheet\.commitEditing\(\);await checkpoint\(\);return platform\.open\(\);\}/);
  assert.match(main, /isReusableBlankDocument\(documentState\(reusableRecord\)\)/);
  assert.match(main, /store\.update\(reusableRecord\.id,[\s\S]*?reusableRecord\.window\.loadFile\(APP_HTML\)/);
  assert.match(main, /index === 0 \? record : null/);
});

test('calculator and spreadsheet ribbon icons are distinct and spreadsheet is at bottom', () => {
  const html = readFileSync('src/index.html','utf8');
  const styles = readFileSync('src/styles.css','utf8');
  assert.match(html, /id="calc-tab"[^>]+>\s*<span class="ribbon-icon"[^>]*><svg[^>]+viewBox="0 0 24 24"/);
  assert.match(html, /id="sheet-tab"[^>]+>\s*<span class="ribbon-icon">▦<\/span>/);
  assert.match(styles, /#sheet-tab \{ top: auto; bottom: 0; \}/);
});
