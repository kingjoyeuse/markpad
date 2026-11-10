import {validateWorkbook,parseCellAddress,cellAddress,columnName,MAX_ROWS,MAX_COLUMNS} from './workbook.js';

/** Sparse size index; a million default-height rows don't allocate a million DOM nodes or entries. */
export class AxisGeometry{
  constructor(defaultSize,limit,overrides={}){this.defaultSize=defaultSize;this.limit=limit;this.overrides=overrides;this.keys=Object.keys(overrides).map(Number).sort((a,b)=>a-b);this.sums=[0];for(const key of this.keys)this.sums.push(this.sums.at(-1)+overrides[key]-defaultSize);}
  size(index){return this.overrides[index]??this.defaultSize;}
  offset(index){let lo=0,hi=this.keys.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.keys[mid]<index)lo=mid+1;else hi=mid;}return index*this.defaultSize+this.sums[lo];}
  indexAt(pixel){let lo=0,hi=this.limit-1;pixel=Math.max(0,pixel);while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(this.offset(mid)<=pixel)lo=mid;else hi=mid-1;}return lo;}
}

// Quoted text is skipped. Sheet-qualified and unqualified A1 references, plus ranges.
const refs= /"(?:[^"]|"")*"|(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Z]{1,3}\$?[1-9]\d*)(?:\s*:\s*(\$?[A-Z]{1,3}\$?[1-9]\d*))?/gi;
function parts(ref){const m=ref.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i);return {colLock:m[1],rowLock:m[3],...parseCellAddress(ref)};}
function formatRef(ref){return `${ref.colLock}${columnName(ref.col)}${ref.rowLock}${ref.row+1}`;}
function editedIndex(value,index,count,remove){return remove?value<index?value:value>=index+count?value-count:null:value>=index?value+count:value;}
function rewrite(formula,origin,target,axis,index,count,remove){
 if(!formula.startsWith('='))return formula;
 return formula.replace(refs,(match,quoted,plain,first,last,offset,whole)=>{
  if(match[0]==='"'||(offset>0&&/[\w.]/.test(whole[offset-1]))||/[\w.]/.test(whole[offset+match.length]||'')||/^\s*\(/.test(whole.slice(offset+match.length)))return match;
  const sheetName=quoted!==undefined?quoted.replaceAll("''","'"):plain;
  if(sheetName!==undefined?sheetName.toLowerCase()!==target.name.toLowerCase():origin.id!==target.id)return match;
  let a,b;try{a=parts(first);b=last?parts(last):null;}catch{return match;}
  const field=axis==='row'?'row':'col',limit=axis==='row'?MAX_ROWS:MAX_COLUMNS;
  if(b&&remove){
    const reverse=a[field]>b[field],low=Math.min(a[field],b[field]),high=Math.max(a[field],b[field]);
    const left=low<index?low:low>=index+count?low-count:high>=index+count?index:null;
    const right=high>=index+count?high-count:high<index?high:low<index?index-1:null;
    if(left===null||right===null||left>right)return '#REF!';
    a[field]=reverse?right:left;b[field]=reverse?left:right;
  }else{a[field]=editedIndex(a[field],index,count,remove);if(b)b[field]=editedIndex(b[field],index,count,remove);}
  if(a[field]===null||a[field]>=limit||(b&&(b[field]===null||b[field]>=limit)))return '#REF!';
  const qualifier=sheetName===undefined?'':match.slice(0,match.indexOf('!')+1);
  return qualifier+formatRef(a)+(b?':'+formatRef(b):'');
 });
}

/** Transactional structural edits. Dollar locks affect copying, not inserted/deleted coordinates. */
export function editWorksheetAxis(workbook,sheetId,axis,index,{remove=false,count=1}={}){
 if(!['row','column'].includes(axis))throw Error('Invalid worksheet axis.');
 const limit=axis==='row'?MAX_ROWS:MAX_COLUMNS;
 if(!Number.isInteger(index)||index<0||index>=limit||!Number.isInteger(count)||count<1||index+count>limit)throw Error('Invalid worksheet range.');
 const next=validateWorkbook(workbook),target=next.sheets.find(s=>s.id===sheetId);
 if(!target)throw Error('Worksheet not found.');
 const moved={};
 for(const [address,input] of Object.entries(target.cells)){
   const pos=parseCellAddress(address),field=axis==='row'?'row':'col',value=editedIndex(pos[field],index,count,remove);
   if(value===null)continue;if(value>=limit)throw Error('Inserting here would push nonempty cells beyond the worksheet limit.');pos[field]=value;moved[cellAddress(pos.row,pos.col)]=input;
 }
 target.cells=moved;
 // Document links follow the same logical cells. Removed targets stay explicit
 // broken links rather than silently retargeting to their former neighbours.
 for(const link of Object.values(next.linkedCells||{})){
   if(link.sheetId!==sheetId||link.address===null)continue;
   const pos=parseCellAddress(link.address),field=axis==='row'?'row':'col';
   const value=editedIndex(pos[field],index,count,remove);
   if(value===null||value>=limit)link.address=null;
   else{pos[field]=value;link.address=cellAddress(pos.row,pos.col);}
 }
 const key=axis==='row'?'rowHeights':'columnWidths';
 if(target[key]){const sizes={};for(const [at,value] of Object.entries(target[key])){const after=editedIndex(Number(at),index,count,remove);if(after!==null&&after<limit)sizes[after]=value;}target[key]=sizes;}
 for(const sheet of next.sheets)for(const address of Object.keys(sheet.cells))sheet.cells[address]=rewrite(sheet.cells[address],sheet,target,axis,index,count,remove);
 return next;
}

/** Excel reference-lock cycle: A1 -> $A$1 -> A$1 -> $A1 -> A1. */
export function cycleReferenceLocks(ref){
 const p=parts(ref);if(!p.colLock&&!p.rowLock){p.colLock='$';p.rowLock='$';}
 else if(p.colLock&&p.rowLock)p.colLock='';else if(p.rowLock){p.colLock='$';p.rowLock='';}else p.colLock='';
 return formatRef(p);
}
export function referenceAtCaret(formula,caret){
 let result=null;
 for(const m of formula.matchAll(/"(?:[^"]|"")*"|'(?:[^']|'')*'(?=!)|\$?[A-Z]{1,3}\$?[1-9]\d*/gi)){
  if(m[0][0]==='"'||m[0][0]==="'"||formula[m.index+m[0].length]==='!'||(m.index>0&&/[\w.]/.test(formula[m.index-1]))||/[\w.]/.test(formula[m.index+m[0].length]||'')||/^\s*\(/.test(formula.slice(m.index+m[0].length)))continue;
  if(caret>=m.index&&caret<=m.index+m[0].length)result={start:m.index,end:m.index+m[0].length,text:m[0]};
 }
 return result;
}
