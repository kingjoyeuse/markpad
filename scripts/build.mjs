let build;
try { ({build}=await import('esbuild')); } catch(error) {
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  await import('./build-offline.mjs');process.exit(0);
}
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('app', {recursive:true});
const result = await build({entryPoints:['src/main.js'],bundle:true,outfile:'app/main.js',format:'iife',target:'chrome140',minify:true,sourcemap:false,legalComments:'linked',metafile:true,loader:{'.svg':'dataurl'}});
await copyFile('src/index.html','app/index.html');
await copyFile('src/patch.js','app/patch.js');
await copyFile('src/runtime-enhancements.js','app/runtime-enhancements.js');
await copyFile('src/format-worker.js','app/format-worker.js');
await copyFile('vendor/editor-runtime.js','app/editor-runtime.js');
await mkdir('app/ui',{recursive:true});
for(const name of ['source-position.js','recent-time.js','code-lexer.js'])await copyFile(`src/ui/${name}`,`app/ui/${name}`);
await writeFile('app/build-info.json',JSON.stringify({version:'0.1.4',release:'releases-0.1.4',builtAt:new Date().toISOString(),bytes:Object.values(result.metafile.outputs).reduce((n,o)=>n+o.bytes,0)},null,2));
console.log('Built Markpad:', Object.values(result.metafile.outputs).reduce((n,o)=>n+o.bytes,0).toLocaleString(), 'bytes of bundled assets.');
