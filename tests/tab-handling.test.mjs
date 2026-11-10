import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('portable runtime captures Tab in both document modes before focus navigation',()=>{
  const script=readFileSync('src/runtime-enhancements.js','utf8');
  assert.match(script,/document\.addEventListener\('keydown',[\s\S]*?\},true\);/);
  assert.match(script,/event\.key!=='Tab'/);
  assert.match(script,/event\.preventDefault\(\);event\.stopImmediatePropagation\(\);/);
  assert.match(script,/edit\.handleDocumentKeyDown\(view,event\)/);
  assert.match(script,/edit\.rawTab\(event\.shiftKey\)/);
  assert.match(script,/state\.tr\.insertText\('\\t'\)/);
});
test('editor code block Tab inserts indentation instead of moving focus',()=>{
  const script=readFileSync('src/ui/editor.js','utf8');
  assert.match(script,/handleKeyDown:\(view,event\)=>this\.handleDocumentKeyDown\(view,event\)/);
  assert.match(script,/if\(block\)[\s\S]*?state\.tr\.insertText\('\\t'\)/);
  assert.match(script,/else if\(event\.key==='Tab'/);
});
