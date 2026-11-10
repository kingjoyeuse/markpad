import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const css=readFileSync('src/styles.css','utf8');
const html=readFileSync('src/index.html','utf8');

test('sidebar tabs no longer have a shared movable ribbon ancestor',()=>{
  assert.doesNotMatch(html, /id="ribbon"/);
  assert.match(html, /id="workspace" data-tab-layout="independent-v2" data-panels="none"/);
  for (const id of ['calc-tab','sheet-tab']) {
    assert.match(html, new RegExp(`id="${id}" class="sidebar-tab"[^>]*aria-expanded="false"`));
  }
  assert.doesNotMatch(css, /#ribbon/);
});

test('each tool has its own expanded offset and fixed vertical anchor',()=>{
  assert.match(css, /#workspace > \.sidebar-tab \{[^}]*right: var\(--editor-scrollbar-width, 0px\)/s);
  assert.match(css, /#workspace > \.sidebar-tab\[aria-expanded="true"\] \{[^}]*right: calc\(min\(var\(--sidebar-width\)/s);
  assert.match(css, /#workspace > #calc-tab \{ top: 0; bottom: auto; \}/);
  assert.match(css, /#workspace > #sheet-tab \{ top: auto; bottom: 0; \}/);
});

test('source, preview, bin and legacy runtime HTML/styles are byte-identical',()=>{
  for(const directory of ['app',...['bin/resources/app/app','resources/app/app'].filter(directory=>existsSync(directory))]) {
    assert.equal(readFileSync(`${directory}/main.css`,'utf8'),css,`${directory}: CSS`);
    assert.equal(readFileSync(`${directory}/index.html`,'utf8'),html,`${directory}: HTML`);
  }
});
