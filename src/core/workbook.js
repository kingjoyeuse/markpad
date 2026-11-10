import {evaluateExpression, parseNumberLiteral, FormulaError} from './numbers.js';

export const MAX_ROWS = 1048576;
export const MAX_COLUMNS = 16384;
export const MAX_RANGE_CELLS = 100000;
export const MAX_STORED_CELLS = 100000;
const MAX_REFERENCE_DEPTH = 200;

function makeId() { return globalThis.crypto?.randomUUID?.() || `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export function createWorkbook() {
  const sheet = {id:makeId(),name:'Data',cells:{}};
  return {version:1,sheets:[sheet],activeSheetId:sheet.id};
}

export function columnName(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COLUMNS) throw new FormulaError('#REF!', 'Column outside the supported range.');
  let value=index+1, result='';
  while (value > 0) { value--; result=String.fromCharCode(65+value%26)+result; value=Math.floor(value/26); }
  return result;
}

export function parseCellAddress(address) {
  const match = String(address).match(/^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i);
  if (!match) throw new FormulaError('#REF!', `Invalid cell address: ${address}`);
  let col=0;
  for (const character of match[1].toUpperCase()) col=col*26+character.charCodeAt(0)-64;
  const row=Number(match[2])-1; col--;
  if (row >= MAX_ROWS || col >= MAX_COLUMNS || !Number.isSafeInteger(row)) throw new FormulaError('#REF!', `Cell outside the supported range: ${address}`);
  return {row,col};
}

export function cellAddress(row,col) { return `${columnName(col)}${row+1}`; }
function canonicalAddress(address) { const {row,col}=parseCellAddress(address); return cellAddress(row,col); }

export function sheetBounds(sheet) {
  let rows=0,cols=0;
  for (const [address,value] of Object.entries(sheet?.cells || {})) {
    if (value === '') continue;
    try { const point=parseCellAddress(address); rows=Math.max(rows,point.row+1); cols=Math.max(cols,point.col+1); } catch { /* Invalid persisted addresses are rejected by validation; UI can tolerate a partial object. */ }
  }
  return {rows,cols};
}

/** Mutates workbook in place, returning it. Empty strings remove cells. */
export function setCell(workbook,sheetId,address,input) {
  const sheet=workbook.sheets.find(sheet=>sheet.id === sheetId);
  if (!sheet) throw new FormulaError('#REF!', 'Sheet not found.');
  const canonical=canonicalAddress(address), value=String(input ?? '');
  if (value.length > 100000) throw new FormulaError('#VALUE!', 'A cell may contain at most 100,000 characters.');
  if (value === '') delete sheet.cells[canonical];
  else {
    if (!Object.hasOwn(sheet.cells,canonical) && Object.keys(sheet.cells).length >= MAX_STORED_CELLS) throw new FormulaError('#NUM!', 'This sheet has reached its cell limit.');
    sheet.cells[canonical]=value;
  }
  return workbook;
}

function evaluation(workbook) {
  const cache=new Map(), visiting=new Set();
  let remainingRangeCells=MAX_RANGE_CELLS;
  const findSheet=(idOrName,origin)=>idOrName == null ? origin : workbook.sheets.find(sheet=>sheet.id === idOrName || sheet.name.toLowerCase() === String(idOrName).toLowerCase());
  function get(sheet,address,depth=0) {
    if (!sheet) throw new FormulaError('#REF!', 'Sheet not found.');
    if (depth > MAX_REFERENCE_DEPTH) throw new FormulaError('#NUM!', 'The formula reference chain is too long.');
    const canonical=canonicalAddress(address), key=`${sheet.id}!${canonical}`;
    if (visiting.has(key)) throw new FormulaError('#CYCLE!', 'Circular reference.');
    if (cache.has(key)) return cache.get(key);
    const input=sheet.cells[canonical] ?? '';
    if (!input.startsWith('=')) {
      const value=input.startsWith("'") ? input.slice(1) : /^(?:TRUE|FALSE)$/i.test(input) ? input.toUpperCase() === 'TRUE' : parseNumberLiteral(input) ?? input;
      cache.set(key,value); return value;
    }
    visiting.add(key);
    try {
      const value=evaluateExpression(input,{
        resolveReference:(reference,sheetName)=>get(findSheet(sheetName,sheet),reference,depth+1),
        resolveRange:(start,end,sheetName)=>{
          const target=findSheet(sheetName,sheet);
          if (!target) throw new FormulaError('#REF!');
          const a=parseCellAddress(start), b=parseCellAddress(end);
          const rowStart=Math.min(a.row,b.row), rowEnd=Math.max(a.row,b.row);
          const colStart=Math.min(a.col,b.col), colEnd=Math.max(a.col,b.col);
          remainingRangeCells -= (rowEnd-rowStart+1)*(colEnd-colStart+1);
          if (remainingRangeCells<0) throw new FormulaError('#NUM!', 'The selected ranges are too large.');
          const values=[];
          for (let row=rowStart;row<=rowEnd;row++) for (let col=colStart;col<=colEnd;col++) values.push(get(target,cellAddress(row,col),depth+1));
          return values;
        }
      });
      if (Array.isArray(value)) throw new FormulaError('#VALUE!', 'A cell formula must produce one value.');
      cache.set(key,value); return value;
    } finally { visiting.delete(key); }
  }
  return (sheetId,address)=>{ remainingRangeCells=MAX_RANGE_CELLS; return get(findSheet(sheetId,null),address); };
}

export function getCellValue(workbook,sheetId,address) {
  try { return evaluation(workbook)(sheetId,address); }
  catch (error) { return error instanceof FormulaError ? error.code : '#ERROR!'; }
}

/** One evaluator per render/export reuses dependency results. Recreate after edits. */
export function createEvaluator(workbook) {
  const get=evaluation(workbook);
  return (sheetId,address)=>{ try { return get(sheetId,address); } catch (error) { return error instanceof FormulaError ? error.code : '#ERROR!'; } };
}

export function validateWorkbook(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.sheets) || !value.sheets.length || value.sheets.length > 128) throw new Error('Invalid or unsupported workbook.');
  const names=new Set(),ids=new Set(); let count=0;
  const sheets=value.sheets.map(sheet=>{
    if (!sheet || typeof sheet.id !== 'string' || !sheet.id || sheet.id.length > 128 || ids.has(sheet.id)) throw new Error('Invalid sheet identifier.');
    if (typeof sheet.name !== 'string' || !sheet.name.trim() || sheet.name.length > 100 || /[\r\n\u0000]/.test(sheet.name) || names.has(sheet.name.toLowerCase())) throw new Error('Invalid or duplicate sheet name.');
    if (!sheet.cells || typeof sheet.cells !== 'object' || Array.isArray(sheet.cells)) throw new Error('Invalid cells.');
    ids.add(sheet.id); names.add(sheet.name.toLowerCase());
    const cells={};
    for (const [address,input] of Object.entries(sheet.cells)) {
      if (++count > MAX_STORED_CELLS) throw new Error('Too many stored cells.');
      if (typeof input !== 'string' || input.length > 100000) throw new Error('Invalid cell input.');
      const canonical=canonicalAddress(address);
      if (Object.hasOwn(cells,canonical)) throw new Error('Duplicate cell address.');
      if (input !== '') cells[canonical]=input;
    }
    const dimensions={};
    for(const [key,limit,min,max] of [['columnWidths',MAX_COLUMNS,36,10000],['rowHeights',MAX_ROWS,18,10000]]){
      if(sheet[key]===undefined)continue;
      if(!sheet[key]||typeof sheet[key]!=='object'||Array.isArray(sheet[key]))throw new Error('Invalid worksheet dimensions.');
      const sizes={};const entries=Object.entries(sheet[key]);if(entries.length>100000)throw new Error('Too many worksheet dimensions.');
      for(const [index,size] of entries){if(!/^\d+$/.test(index)||Number(index)>=limit||!Number.isFinite(size)||size<min||size>max)throw new Error('Invalid worksheet size.');sizes[Number(index)]=size;}
      dimensions[key]=sizes;
    }
    for(const [key,min] of [['defaultColumnWidth',36],['defaultRowHeight',18]]){
      if(sheet[key]!==undefined){if(!Number.isFinite(sheet[key])||sheet[key]<min||sheet[key]>10000)throw Error('Invalid default worksheet size.');dimensions[key]=sheet[key];}
    }
    return {id:sheet.id,name:sheet.name,cells,...dimensions};
  });
  const linked={};
  if(value.linkedCells!==undefined){
    if(!value.linkedCells||typeof value.linkedCells!=='object'||Array.isArray(value.linkedCells))throw Error('Invalid linked cells.');
    const entries=Object.entries(value.linkedCells);if(entries.length>10000)throw Error('Too many document cell links.');
    for(const [id,link] of entries){
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!link||typeof link.sheetId!=='string'||link.sheetId.length>128||typeof link.lastText!=='string'||link.lastText.length>100000)throw Error('Invalid document cell link.');
      linked[id]={sheetId:link.sheetId,address:link.address===null?null:canonicalAddress(link.address),lastText:link.lastText};
    }
  }
  return {version:1,sheets,activeSheetId:ids.has(value.activeSheetId) ? value.activeSheetId : sheets[0].id,...(Object.keys(linked).length?{linkedCells:linked}:{})};
}

/** Shift relative references when filling/copying, without touching quoted strings. */
export function shiftFormula(formula,rowDelta,colDelta) {
  if (!String(formula).startsWith('=')) return String(formula);
  if (!Number.isInteger(rowDelta) || !Number.isInteger(colDelta)) throw new Error('Formula shifts must be integers.');
  return String(formula).replace(/"(?:[^"]|"")*"|(?:'(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)?\$?[A-Z]{1,3}\$?[1-9]\d*/gi,(match,offset,whole)=>{
    if (match.startsWith('"')) return match;
    // Avoid matching a reference-looking suffix inside a name, or LOG10(...).
    if (offset>0 && /[A-Za-z0-9_.]/.test(whole[offset-1])) return match;
    if (/^[A-Za-z_]/.test(whole[offset+match.length] || '') || /^\s*\(/.test(whole.slice(offset+match.length))) return match;
    const parts=match.match(/^(.*?)(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)$/i);
    if (!parts) return match;
    let point;
    try { point=parseCellAddress(`${parts[3]}${parts[5]}`); } catch { return match; }
    const row=point.row+(parts[4]?0:rowDelta), col=point.col+(parts[2]?0:colDelta);
    if (row<0 || col<0 || row>=MAX_ROWS || col>=MAX_COLUMNS) return '#REF!';
    return `${parts[1]}${parts[2]}${columnName(col)}${parts[4]}${row+1}`;
  });
}
