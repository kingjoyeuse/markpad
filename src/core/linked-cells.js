import {createEvaluator,cellAddress,columnName} from './workbook.js';
import {formatNumber} from './numbers.js';

export const CELL_LINK_PREFIX='#markpad-cell-';
export function cellLinkId(href){const m=String(href||'').match(/^#markpad-cell-([a-zA-Z0-9_-]{1,80})$/);return m?.[1]||null;}
export function escapeLinkedText(text){
  return String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replace(/[\\`*_{}[\]()|~!]/g,'\\$&').replace(/\r\n|\r|\n/g,'&#10;').replaceAll('\t','&#9;');
}
function decodeLabel(text){
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,'$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
      const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
      if(entity[0]!=='#')return names[entity.toLowerCase()]||_;
      const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'\ufffd';
    });
}
/** Recognize only our exact anchor links, outside fenced/inline code and comments.
 * Other Markdown and unrecognized/malformed link source are never rewritten. */
export function findRawCellLinks(source){
  const found=[];let offset=0,fence=null,inComment=false;
  for(const line of String(source).split(/(?<=\n)/)){
    const match=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(fence){if(match&&match[1][0]===fence[0]&&match[1].length>=fence.length&&line.slice(match[0].length).trim()==='')fence=null;offset+=line.length;continue;}
    if(match){fence=match[1];offset+=line.length;continue;}
    if(/^(?: {4}|\t)/.test(line)){offset+=line.length;continue;}
    let code=0;
    for(let i=0;i<line.length;i++){
      if(inComment){const end=line.indexOf('-->',i);if(end<0)break;inComment=false;i=end+2;continue;}
      if(line.startsWith('<!--',i)){inComment=true;i+=3;continue;}
      if(line[i]==='\\'){i++;continue;}
      if(line[i]==='`'){let n=1;while(line[i+n]==='`')n++;if(!code)code=n;else if(code===n)code=0;i+=n-1;continue;}
      if(code||line[i]!=='['||(i>0&&line[i-1]==='!'))continue;
      let end=i+1;
      for(;end<line.length;end++){if(line[end]==='\\'){end++;continue;}if(line[end]===']')break;}
      const target=line.slice(end).match(/^\]\(#markpad-cell-([a-zA-Z0-9_-]{1,80})\)/);
      if(!target)continue;
      found.push({id:target[1],from:offset+i+1,to:offset+end,text:decodeLabel(line.slice(i+1,end)).replace(/^\u200b$/,'')});i=end+target[0].length-1;
    }
    offset+=line.length;
  }
  return found;
}
export function linkedDisplay(workbook,link,evaluate=createEvaluator(workbook)){
  if(!link||link.address===null||!workbook.sheets.some(s=>s.id===link.sheetId))return '#REF!';
  return formatNumber(evaluate(link.sheetId,link.address));
}
/** Build ordinary Markdown; no HTML, custom syntax or external file is required. */
export function createLinkedInsertion(workbook,sheetId,rows,cols){
  if(!rows.length||!cols.length||rows.length*cols.length>10000)throw Error('Insert up to 10,000 cells at once.');
  if(!workbook.sheets.some(s=>s.id===sheetId))throw Error('Worksheet not found.');
  if(Object.keys(workbook.linkedCells||{}).length+rows.length*cols.length>10000)throw Error('This document has reached its 10,000 cell-link limit.');
  const evaluate=createEvaluator(workbook),links={};
  const matrix=rows.map(row=>cols.map(col=>{
    const id=globalThis.crypto?.randomUUID?.()||`cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const address=cellAddress(row,col),lastText=formatNumber(evaluate(sheetId,address));
    links[id]={sheetId,address,lastText};return {id,text:lastText};
  }));
  const render=cell=>`[${escapeLinkedText(cell.text||'\u200b')}](${CELL_LINK_PREFIX}${cell.id})`;
  const table=rows.length*cols.length>1;
  const markdown=table?`| ${cols.map(columnName).join(' | ')} |\n| ${cols.map(()=>'---').join(' | ')} |\n`+matrix.map(row=>'| '+row.map(render).join(' | ')+' |').join('\n'):render(matrix[0][0]);
  return {links,matrix,markdown,table,columns:cols.map(columnName)};
}

export function rawLinkReplacements(source,workbook){
  const evaluate=createEvaluator(workbook);
  return findRawCellLinks(source).flatMap(occurrence=>{
    const link=workbook.linkedCells?.[occurrence.id];if(!link)return [];
    const display=linkedDisplay(workbook,link,evaluate);
    return occurrence.text===display?[]:[{id:occurrence.id,from:occurrence.from,to:occurrence.to,text:escapeLinkedText(display||'\u200b')}];
  });
}
export function replaceSourceRanges(source,replacements){
  for(const patch of [...replacements].sort((a,b)=>b.from-a.from))source=source.slice(0,patch.from)+patch.text+source.slice(patch.to);
  return source;
}
export function mapSourceOffset(offset,replacements){
  let shift=0;
  for(const patch of [...replacements].sort((a,b)=>a.from-b.from)){
    if(offset<patch.from)break;
    if(offset<=patch.to)return patch.from+shift+Math.min(offset-patch.from,patch.text.length);
    shift+=patch.text.length-(patch.to-patch.from);
  }
  return offset+shift;
}
