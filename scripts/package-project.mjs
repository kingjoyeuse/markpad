import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const runtime=path.join(root,'dist','Markpad-win32-x64');
const stage=path.join(root,'dist','Markpad-project');
const archive=path.join(root,'dist',`Markpad-${manifest.version}-Windows-Codex.zip`);
function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed with exit code ${result.status}`);
}
await fs.access(path.join(runtime,'Markpad.exe')).catch(()=>{throw new Error('Build the Windows runtime first with npm run package:win.');});
await fs.rm(stage,{recursive:true,force:true});
await fs.mkdir(stage,{recursive:true});
await fs.cp(runtime,path.join(stage,'bin'),{recursive:true});
const sourceFiles=['AGENTS.md','README.md','Build-Markpad.cmd','Apply-Markpad-Icon.cmd','.gitignore','.gitattributes','package.json','package-lock.json','THIRD_PARTY_NOTICES.md'];
for(const name of sourceFiles)await fs.copyFile(path.join(root,name),path.join(stage,name));
for(const name of ['src','desktop','scripts','tests','docs','app','assets','vendor']){
  await fs.cp(path.join(root,name),path.join(stage,name),{recursive:true,filter:source=>{
    const relative=path.relative(root,source).split(path.sep);
    return !relative.includes('__pycache__')&&!(relative[0]==='tests'&&relative[1]==='artifacts')&&!source.endsWith('.pyc');
  }});
}
await fs.writeFile(path.join(stage,'START-HERE.txt'),[
  'MARKPAD — WINDOWS APPLICATION + CODEX PROJECT','',
  'Extract this ZIP directly into C:\\repos\\markpad.',
  'bin\\Markpad.exe is the runnable application; AGENTS.md and src are in the project root.','',
  'RUN: Use the shortcut you made to bin\\Markpad.exe (or open it directly).',
  'Keep all DLLs, locales, and resources under bin\\ beside the EXE.',
  'EDIT: Open this same folder as your Codex project. Read AGENTS.md and README.md.',
  'REBUILD: Close Markpad, then run Build-Markpad.cmd, or npm run build:portable.',
  'ICON: Apply-Markpad-Icon.cmd embeds the branded icon in the EXE and fixes shortcuts.',
  'SOURCE SETUP: npm ci (Node.js 24 LTS recommended). Running the EXE needs no Node.','',
  'A local Git repository is included on main. No remote is configured.',
  'Runtime/dependency/generated files are ignored; source and docs are tracked.','',
  'The Windows binary was packaged but has not been run on Windows here.',
  'See README.md and docs/*VERIFICATION* for the actual checks and limitations.','',
].join('\r\n'));
// A new local source history makes the extracted folder immediately usable as
// a Codex checkout. Never copy a user's existing .git history/credentials into
// a distribution, and never configure or push a remote here.
run('git',['init','--initial-branch=main',stage]);
run('git',['config','core.filemode','false'],{cwd:stage});
run('git',['config','core.ignorecase','true'],{cwd:stage});
run('git',['add','--all'],{cwd:stage});
run('git',['-c','user.name=Markpad','-c','user.email=markpad@local.invalid','commit','-m',`Initial Markpad ${manifest.version} source and verification`],{cwd:stage});
await fs.rm(archive,{force:true});
if(process.platform==='win32'){
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  run('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('+quote(stage)+','+quote(archive)+',[System.IO.Compression.CompressionLevel]::Optimal,$false)']);
}else run('zip',['-q','-r',archive,'.'],{cwd:stage});
console.log(`Combined root-level Windows/Codex project: ${archive}`);
console.log('The ZIP includes a fresh local Git repository, all source, and bin/Markpad.exe.');
