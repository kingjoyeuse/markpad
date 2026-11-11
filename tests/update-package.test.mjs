import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {referenceAtCaret} from '../src/core/sheet-operations.js';

test('F4 skips reference-looking sheet names and quoted sheet qualifiers',()=>{
 assert.equal(referenceAtCaret('=A1!B2',3),null);
 assert.equal(referenceAtCaret("='A1 data'!B2",4),null);
 assert.equal(referenceAtCaret("='A1 data'!B2",12)?.text,'B2');
});
test('Complete-update source and both application runtimes contain identical deployed bytes',()=>{
 const roots=['bin/resources/app','resources/app'].filter(root=>fs.existsSync(root));
 for(const folder of ['app','desktop'])for(const entry of fs.readdirSync(folder,{recursive:true})){
  const source=path.join(folder,entry);if(!fs.statSync(source).isFile())continue;
  for(const root of roots)assert.deepEqual(fs.readFileSync(path.join(root,source)),fs.readFileSync(source),path.join(root,source));
 }
 for(const asset of ['markpad.ico','markpad.png'])for(const root of roots)assert.deepEqual(fs.readFileSync(path.join(root,'assets',asset)),fs.readFileSync(path.join('assets',asset)));
 assert.equal(JSON.parse(fs.readFileSync('app/build-info.json')).release,'releases-0.1.4');
});
test('Small Windows icon frames contain valid 32-bit DIBs with matching transparency masks',()=>{
 const ico=fs.readFileSync('assets/markpad.ico');let checked=0;
 for(let i=0;i<ico.readUInt16LE(4);i++){
  const at=6+i*16,size=ico[at]||256,offset=ico.readUInt32LE(at+12),length=ico.readUInt32LE(at+8);if(size>64)continue;
  const frame=ico.subarray(offset,offset+length),stride=Math.ceil(size/32)*4;
  assert.equal(frame.readUInt32LE(0),40);assert.equal(frame.readInt32LE(4),size);assert.equal(frame.readInt32LE(8),size*2);assert.equal(frame.readUInt16LE(14),32);
  assert.equal(frame.length,40+size*size*4+stride*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const alpha=frame[40+(y*size+x)*4+3],masked=(frame[40+size*size*4+y*stride+(x>>3)]>>(7-(x%8)))&1;
   assert.equal(masked,alpha===0?1:0,`Transparency mismatch at ${size}px ${x},${y}`);
  }checked++;
 }
 assert.equal(checked,7);
});
