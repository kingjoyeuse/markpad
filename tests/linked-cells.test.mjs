import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbook,setCell} from '../src/core/workbook.js';
import {serializeDocument,parseDocument} from '../src/core/markdown-workbook.js';
import {createLinkedInsertion,findRawCellLinks,linkedDisplay,rawLinkReplacements,replaceSourceRanges} from '../src/core/linked-cells.js';
import {selectAxis,axisIndices} from '../src/core/sheet-selection.js';
import {editWorksheetAxis} from '../src/core/sheet-operations.js';

test('Header Ctrl toggles individuals and Shift extends inclusive spans',()=>{
 let s=selectAxis(null,'row',1);s=selectAxis(s,'row',4,{control:true});assert.deepEqual(axisIndices(s),[1,4]);
 s=selectAxis(s,'row',6,{shift:true});assert.deepEqual(axisIndices(s),[4,5,6]);
 s=selectAxis(s,'row',5,{control:true});assert.deepEqual(axisIndices(s),[4,6]);
 s=selectAxis(s,'column',2,{control:true});assert.deepEqual(axisIndices(s),[2]);
});
test('Sheet-wide defaults and sparse dimensions round-trip without values',()=>{
 const w=createWorkbook();Object.assign(w.sheets[0],{defaultColumnWidth:150,defaultRowHeight:48,columnWidths:{3:180},rowHeights:{10:63}});
 const source=serializeDocument('Note',w),parsed=parseDocument(source);
 assert.match(source,/markpad:workbook:v2:start/);assert.deepEqual(parsed.workbook,w);assert.equal(parsed.body,'Note');assert.deepEqual(parsed.warnings,[]);
});
test('Linked labels round-trip punctuation, HTML-like values, tabs and newlines',()=>{
 const w=createWorkbook(),id=w.sheets[0].id,value='A | [B] <C> & *D*\\ path\nnext\trow';setCell(w,id,'A1',value);
 const spec=createLinkedInsertion(w,id,[0],[0]);w.linkedCells=spec.links;
 const occurrences=findRawCellLinks(spec.markdown);assert.equal(occurrences.length,1);assert.equal(occurrences[0].text,value);
 const parsed=parseDocument(serializeDocument(spec.markdown,w));assert.equal(parsed.body,spec.markdown);assert.deepEqual(parsed.workbook.linkedCells,w.linkedCells);assert.deepEqual(parsed.warnings,[]);
});
test('Scanning leaves inline code, fences, comments and ordinary text untouched',()=>{
 const link='[25](#markpad-cell-example)';const text=`${link}\n\`${link}\`\n\`\`\`md\n${link}\n\`\`\`\n<!-- ${link} -->\n`;
 assert.equal(findRawCellLinks(text).length,1);
 const w=createWorkbook();w.linkedCells={example:{sheetId:w.sheets[0].id,address:'A1',lastText:'25'}};setCell(w,w.sheets[0].id,'A1','42');
 const updated=replaceSourceRanges(text,rawLinkReplacements(text,w));assert.ok(updated.startsWith('[42]'));assert.equal(updated.split(link).length-1,3);
});
test('Live references follow structural edits and become REF on target deletion',()=>{
 const w=createWorkbook(),id=w.sheets[0].id;setCell(w,id,'A2','10');const spec=createLinkedInsertion(w,id,[1],[0]);w.linkedCells=spec.links;const key=Object.keys(spec.links)[0];
 const inserted=editWorksheetAxis(w,id,'row',0,{count:2});assert.equal(inserted.linkedCells[key].address,'A4');assert.equal(linkedDisplay(inserted,inserted.linkedCells[key]),'10');
 const removed=editWorksheetAxis(inserted,id,'column',0,{count:1,remove:true});assert.equal(removed.linkedCells[key].address,null);assert.equal(linkedDisplay(removed,removed.linkedCells[key]),'#REF!');
 const parsed=parseDocument(serializeDocument(spec.markdown,removed));assert.deepEqual(parsed.warnings,[]);assert.equal(parsed.workbook.linkedCells[key].address,null);
});
test('Nonadjacent selections serialize as readable tables with registered cell links',()=>{
 const w=createWorkbook(),id=w.sheets[0].id;setCell(w,id,'A1','25');setCell(w,id,'C1','=A1*2');
 const spec=createLinkedInsertion(w,id,[0],[0,2]);w.linkedCells=spec.links;
 assert.equal(spec.table,true);assert.ok(spec.markdown.startsWith('| A | C |'));assert.equal(findRawCellLinks(spec.markdown).length,2);
 assert.equal(spec.matrix[0][1].text,'50');assert.deepEqual(parseDocument(serializeDocument(spec.markdown,w)).workbook,w);
});
