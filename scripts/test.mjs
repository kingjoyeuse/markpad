import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=readdirSync('tests').filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
if(!files.length)throw new Error('No core regression tests found');
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
