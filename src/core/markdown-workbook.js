import {createWorkbook, validateWorkbook, sheetBounds, columnName, createEvaluator} from './workbook.js';
import {formatNumber} from './numbers.js';


export const MAX_EXPORTED_TABLE_CELLS=100000;

function checksum(text) {
  let hash=2166136261;
  for (const character of text.replace(/\r\n/g,'\n')) {
    const code=character.codePointAt(0);
    hash=Math.imul(hash^code,16777619)>>>0;
  }
  return hash.toString(16).padStart(8,'0');
}

function escapeText(text) {
  return String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replace(/[\\`*_{}[\]()|~]/g,'\\$&').replace(/\r\n|\r|\n/g,'<br>');
}
function escapeHeading(text) { return escapeText(text).replaceAll('#','\\#'); }

function visibleTables(workbook) {
  const getValue=createEvaluator(workbook), sections=[];
  if (!Object.keys(workbook.linkedCells||{}).length&&!workbook.sheets.some(sheet=>Object.values(sheet.cells).some(value=>value !== '')||sheet.defaultColumnWidth!==undefined||sheet.defaultRowHeight!==undefined||Object.keys(sheet.columnWidths||{}).length||Object.keys(sheet.rowHeights||{}).length)) return '';
  let exportedCells=0;
  for (const sheet of workbook.sheets) {
    const bounds=sheetBounds(sheet);
    const rows=Math.max(1,bounds.rows), cols=Math.max(1,bounds.cols);
    exportedCells += rows*cols;
    if (exportedCells>MAX_EXPORTED_TABLE_CELLS) throw new Error('The used spreadsheet rectangles exceed 100,000 cells. Move distant cells closer before saving as Markdown.');
    const columns=Array.from({length:cols},(_,col)=>columnName(col));
    const lines=[`## ${escapeHeading(sheet.name)}`,'',`| ${columns.join(' | ')} |`,`| ${columns.map(()=>'---').join(' | ')} |`];
    for (let row=0;row<rows;row++) lines.push(`| ${columns.map(column=>escapeText(formatNumber(getValue(sheet.id,`${column}${row+1}`)))).join(' | ')} |`);
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

/** A plain Markdown body plus optional readable tables and lossless metadata. */
export function serializeDocument(body,workbook) {
  body=String(body ?? '');
  const normalized=validateWorkbook(workbook || createWorkbook());
  const visible=visibleTables(normalized);
  if (!visible) return body;
  const separator=body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  // v2 makes older builds preserve unfamiliar managed data rather than silently
  // saving it back without cell links or sheet-wide default dimensions.
  const version=normalized.linkedCells||normalized.sheets.some(s=>s.defaultColumnWidth!==undefined||s.defaultRowHeight!==undefined)?2:1;
  const metadata={version,separator,visibleHash:checksum(visible),workbook:normalized};
  const START=`<!-- markpad:workbook:v${version}:start -->`,END=`<!-- markpad:workbook:v${version}:end -->`,DATA=`<!-- markpad:workbook:v${version}:data `;
  // URI encoding keeps the comment single-line and ASCII; encoding hyphens too
  // guarantees cell text can never terminate or invalidate the HTML comment.
  const payload=encodeURIComponent(JSON.stringify(metadata)).replaceAll('-','%2D');
  return `${body}${separator}${START}\n${DATA}${payload} -->\n${visible}\n${END}\n`;
}

function isInsideFence(prefix) {
  let fence=null;
  for (const line of prefix.split(/\r?\n/)) {
    if (fence) {
      const closing=line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length>=fence.length) fence=null;
    } else {
      const opening=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) fence=opening[1];
    }
  }
  return Boolean(fence);
}

/**
 * Only the exact, marked trailing workbook is owned by Markpad. If a table was
 * changed by an outside editor, preserve the entire original text and report
 * that conflict instead of silently restoring stale formulas over those edits.
 */
export function parseDocument(input) {
  const text=String(input ?? '');
  const unchanged=(warning)=>({body:text,workbook:createWorkbook(),warnings:warning?[warning]:[]});
  const starts=[...text.matchAll(/^<!-- markpad:workbook:v([12]):start -->\r?$/gm)];
  if (!starts.length) return unchanged();
  const offset=starts.at(-1).index;
  const prefix=text.slice(0,offset);
  if (isInsideFence(prefix)) return unchanged();
  const tail=text.slice(offset).replace(/\r\n/g,'\n');
  const match=tail.match(/^<!-- markpad:workbook:v([12]):start -->\n<!-- markpad:workbook:v\1:data ([^\n]+) -->\n([\s\S]*)\n<!-- markpad:workbook:v\1:end -->(?:\n)?$/);
  if (!match) return unchanged('The Markpad spreadsheet section is incomplete or has text after it. Its original Markdown has been kept in the document.');
  if (match[2].length>30000000) return unchanged('The spreadsheet metadata is too large to import safely. Its original Markdown has been kept.');
  try {
    const metadata=JSON.parse(decodeURIComponent(match[2]));
    if (metadata.version !== Number(match[1]) || !['','\n','\n\n'].includes(metadata.separator) || typeof metadata.visibleHash !== 'string') throw new Error('Unsupported spreadsheet metadata.');
    const workbook=validateWorkbook(metadata.workbook);
    if (checksum(match[3]) !== metadata.visibleHash) return unchanged('The saved spreadsheet tables were edited outside the spreadsheet. Their Markdown has been kept in the document so those edits are not overwritten; the sidebar starts with an empty Data tab.');
    // Validate consistency of metadata and visible values too. Otherwise a
    // hand-edited formula could appear to have an unrelated displayed result.
    if (checksum(visibleTables(workbook)) !== metadata.visibleHash) return unchanged('The spreadsheet metadata and displayed tables disagree. Their original Markdown has been kept in the document.');
    let separator=metadata.separator;
    if (separator && !prefix.endsWith(separator)) {
      const windowsSeparator=separator.replaceAll('\n','\r\n');
      if (prefix.endsWith(windowsSeparator)) separator=windowsSeparator;
      else throw new Error('The spreadsheet separator changed.');
    }
    return {body:separator?prefix.slice(0,-separator.length):prefix,workbook,warnings:[]};
  } catch (error) {
    return unchanged(`The spreadsheet section could not be imported (${error.message}). Its original Markdown has been kept in the document.`);
  }
}
