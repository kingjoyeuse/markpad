import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {configurePortableProfile}=require('../desktop/runtime-profile.cjs');
test('installed/development launches retain their existing recovery profile',()=>{
 const app={isPackaged:false,setPath(){throw Error('profile changed')}};
 assert.equal(configurePortableProfile(app),null);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'markpad-installed-'));
 try{app.isPackaged=true;assert.equal(configurePortableProfile(app,path.join(dir,'Markpad.exe')),null);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('portable launch stores recovery, session data, and crashes beside the executable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'markpad-portable-'));
 try{
  fs.writeFileSync(path.join(dir,'markpad-portable.json'),JSON.stringify({format:1,productId:'com.markpad.editor'}));
  const paths={};const app={isPackaged:true,setPath(name,value){paths[name]=value;}};
  assert.equal(configurePortableProfile(app,path.join(dir,'Markpad.exe')),path.join(dir,'data'));
  assert.equal(paths.userData,path.join(dir,'data'));assert.equal(paths.sessionData,paths.userData);
  assert.ok(fs.statSync(paths.crashDumps).isDirectory());
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('an invalid portable marker fails without silently relocating recovery data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'markpad-profile-invalid-'));
 try{
  fs.writeFileSync(path.join(dir,'markpad-portable.json'),'{}');
  assert.throws(()=>configurePortableProfile({isPackaged:true},path.join(dir,'Markpad.exe')),/invalid/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
