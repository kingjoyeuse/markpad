/** Deterministic offline fallback using the dependency snapshot shipped with Markpad.
 * App code is always rebuilt from src/, never copied from an old app/main.js. */
import fs from 'node:fs/promises';
import path from 'node:path';
const externals={
 '@tiptap/core':{Editor:'Editor',InputRule:'InputRule',Extension:'Extension',Node:'Node'},
 '@tiptap/starter-kit':{default:'StarterKit'},
 '@tiptap/markdown':{Markdown:'Markdown',MarkdownManager:'MarkdownManager'},
 '@tiptap/extension-table':{TableKit:'TableKit'},
 '@tiptap/extension-task-list':{default:'TaskList'},
 '@tiptap/extension-task-item':{default:'TaskItem'},
 '@tiptap/extension-image':{default:'Image'},
 '@tiptap/extension-placeholder':{default:'Placeholder'},
 '@tiptap/pm/state':{TextSelection:'TextSelection',AllSelection:'AllSelection',Plugin:'Plugin'},
 '@tiptap/pm/history':{closeHistory:'closeHistory'},
 '@tiptap/pm/view':{Decoration:'Decoration',DecorationSet:'DecorationSet'},
};
async function bundle(entry){
 const modules=new Map(),order=[];
 async function visit(file){
  file=path.posix.normalize(file);if(modules.has(file))return;modules.set(file,null);
  let source=await fs.readFile(file,'utf8'),imports=[];
  source=source.replace(/^import\s+(?:(\{[\s\S]*?\}|[\w$]+)\s+from\s+)?['"]([^'"]+)['"];?\s*/gm,(_,binding,spec)=>{imports.push({binding,spec});return '';});
  let head='';
  for(const {binding,spec} of imports){
   if(spec.endsWith('.css'))continue;
   const ext=externals[spec];let ref;
   if(ext)ref='globalThis.MarkpadVendor';else{if(!spec.startsWith('.'))throw Error('Unsupported dependency '+spec);const dep=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));await visit(dep);ref=`modules[${JSON.stringify(dep)}]`;}
   if(!binding)continue;
   if(binding.startsWith('{'))for(const part of binding.slice(1,-1).split(',').map(s=>s.trim()).filter(Boolean)){
    const [name,local=name]=part.split(/\s+as\s+/);const key=ext?ext[name]:name;if(!key)throw Error('Missing offline export '+name);head+=`const ${local}=${ref}.${key};\n`;
   }else head+=`const ${binding}=${ref}.${ext?ext.default:'default'};\n`;
  }
  const names=[];source=source.replace(/^export\s+(?=(?:async\s+)?function\s+|class\s+|const\s+|let\s+|var\s+)/gm,'');
  const original=await fs.readFile(file,'utf8');for(const match of original.matchAll(/^export\s+(?:(?:async\s+)?function|class|const|let|var)\s+([\w$]+)/gm))names.push(match[1]);
  if(/^export\s/m.test(source))throw Error('Unsupported export syntax in '+file);
  modules.set(file,`${head}${source}\nreturn {${names.join(',')}};`);order.push(file);
 }
 await visit(entry);return '(()=>{const modules=Object.create(null);\n'+order.map(f=>`modules[${JSON.stringify(f)}]=(()=>{\n${modules.get(f)}\n})();`).join('\n')+'\n})();\n';
}
await fs.mkdir('app',{recursive:true});
const vendor=await fs.readFile('vendor/editor-runtime.js','utf8');
await fs.writeFile('app/main.js',vendor+'\n'+await bundle('src/main.js'));
await fs.copyFile('src/styles.css','app/main.css');
await fs.copyFile('vendor/editor-runtime.js','app/editor-runtime.js');
for(const f of ['index.html','patch.js','runtime-enhancements.js'])await fs.copyFile('src/'+f,'app/'+f);
await fs.mkdir('app/ui',{recursive:true});
for(const f of ['source-position.js','recent-time.js','code-lexer.js'])await fs.copyFile('src/ui/'+f,'app/ui/'+f);
await fs.writeFile('app/format-worker.js',await bundle('src/format-worker.js'));
await fs.writeFile('app/build-info.json',JSON.stringify({version:'0.1.4',release:'releases-0.1.4',builtAt:new Date().toISOString(),builder:'offline-source',bytes:(await fs.stat('app/main.js')).size},null,2));
console.log('Built complete Markpad app from current source using offline editor dependencies.');
