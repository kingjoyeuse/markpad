import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExpression, inspectNumericSelection, parseNumberLiteral, formatNumber, FormulaError} from '../src/core/numbers.js';
import {createWorkbook, setCell, getCellValue, createEvaluator, shiftFormula, columnName, parseCellAddress, sheetBounds, validateWorkbook} from '../src/core/workbook.js';
import {serializeDocument, parseDocument} from '../src/core/markdown-workbook.js';

test('numeric selections accept currency, valid separators and scientific notation',()=>{
  for (const [text,value] of [['$1,234.56',1234.56],['€1.234,56',1234.56],['1.234.567',1234567],['£12.50',12.5],['1 234.50',1234.5],['1\u202f234,50',1234.5],['12,50',12.5],['1,234',1234],['.5',0.5],['-$1,234',-1234],['($1,234.50)',-1234.5],['1.2e3',1200]]) {
    const result=inspectNumericSelection(text); assert.equal(result.valid,true,text); assert.equal(result.value,value,text); assert.equal(result.isEquation,false,text);
  }
});
test('malformed grouping and textual currency do not silently turn into numbers',()=>{
  for (const text of ['1,23,456','12.34.56','1$2','hello','12 monkeys','1 23','Infinity','NaN','1e999']) assert.equal(inspectNumericSelection(text).valid,false,text);
});
test('arithmetic implements precedence, parentheses, percentages and unary minus',()=>{
  for (const [text,value] of [['2 + 3 * 4',14],['(2 + 3) * 4',20],['2^3^2',512],['-2^2',-4],['2^-2',0.25],['(2)',2],['(2)+(3)',5],['25% * 80',20],['=1,234.50 + $10.50',1245],['€1.234,56 + 1',1235.56],['4 × 2 ÷ 2',4]]) assert.equal(evaluateExpression(text),value,text);
  assert.equal(inspectNumericSelection('2 + 3').isEquation,true);
  assert.equal(inspectNumericSelection('=42').isEquation,true);
  assert.equal(inspectNumericSelection('"text"').valid,false);
});
test('functions parse comma separated arguments and IF only evaluates selected branch',()=>{
  assert.equal(evaluateExpression('SUM(100,200,3)'),303);
  assert.equal(evaluateExpression('SUM($1,000;200)'),1200);
  assert.equal(evaluateExpression('AVERAGE(2,4,6)'),4);
  assert.equal(evaluateExpression('IF(2>1,4,1/0)'),4);
  assert.equal(evaluateExpression('IF(FALSE,1/0,7)'),7);
  assert.equal(evaluateExpression('IFERROR(1/0,8)'),8);
  assert.equal(evaluateExpression('ROUND(-1.25,1)'),-1.3);
  assert.equal(evaluateExpression('ROUND(1.005,2)'),1.01);
  assert.equal(evaluateExpression('MOD(-3,2)'),1);
  assert.equal(evaluateExpression('AND(1<2,2<3)'),true);
  assert.equal(evaluateExpression('IF(1=1,"yes","no")'),'yes');
});
test('untrusted expressions are never executable JavaScript',()=>{
  for (const text of ['process.exit()','globalThis.pwned=1','constructor.constructor("return 1")()','[1,2]','Math.max(1,2)','(()=>42)()','1;2','fetch("https://example.com")','1/**/+2']) assert.throws(()=>evaluateExpression(text),text);
  assert.equal(globalThis.pwned,undefined);
  assert.throws(()=>evaluateExpression('('.repeat(300)+'1'+')'.repeat(300)),FormulaError);
  assert.throws(()=>evaluateExpression('1/0'),error=>error.code === '#DIV/0!');
  assert.throws(()=>evaluateExpression('SQRT(-1)'),error=>error.code === '#NUM!');
});
test('formatting removes floating point noise while preserving ordinary magnitude',()=>{
  assert.equal(formatNumber(0.1+0.2),'0.3');
  assert.equal(formatNumber(-0),'0');
  assert.equal(formatNumber(1200),'1200');
  assert.equal(formatNumber(true),'TRUE');
});
test('addresses, bounds and literal input retain types',()=>{
  assert.equal(columnName(0),'A'); assert.equal(columnName(26),'AA'); assert.equal(columnName(16383),'XFD');
  assert.deepEqual(parseCellAddress('$AB$12'),{row:11,col:27});
  assert.throws(()=>parseCellAddress('A0')); assert.throws(()=>parseCellAddress('XFE1'));
  const workbook=createWorkbook(), id=workbook.activeSheetId;
  assert.deepEqual(sheetBounds(workbook.sheets[0]),{rows:0,cols:0});
  setCell(workbook,id,'B3','$12.50'); setCell(workbook,id,'A1',"'00123");
  assert.equal(getCellValue(workbook,id,'B3'),12.5); assert.equal(getCellValue(workbook,id,'A1'),'00123');
  assert.equal(getCellValue(workbook,id,'A2'),''); assert.deepEqual(sheetBounds(workbook.sheets[0]),{rows:3,cols:2});
  setCell(workbook,id,'B3',''); assert.deepEqual(sheetBounds(workbook.sheets[0]),{rows:1,cols:1});
});
test('spreadsheet ranges, dependencies and cross-sheet names evaluate',()=>{
  const workbook=createWorkbook(), id=workbook.activeSheetId;
  setCell(workbook,id,'A1','2'); setCell(workbook,id,'A2','3'); setCell(workbook,id,'A3','text'); setCell(workbook,id,'B1','=SUM(A1:A3)*2'); setCell(workbook,id,'B2','=AVERAGE(A1:A3)');
  assert.equal(getCellValue(workbook,id,'B1'),10); assert.equal(getCellValue(workbook,id,'B2'),2.5);
  workbook.sheets.push({id:'other',name:'Second tab',cells:{A1:"='Data'!B1+1",A2:"=SUM(Data!A1:A2)",A3:'=COUNT(Data!A1:A3)',A4:'=COUNTA(Data!A1:A3)'}});
  const get=createEvaluator(workbook);
  assert.equal(get('other','A1'),11); assert.equal(get('other','A2'),5); assert.equal(get('other','A3'),2); assert.equal(get('other','A4'),3);
  setCell(workbook,id,'A1','10'); assert.equal(getCellValue(workbook,'other','A1'),27);
});
test('circular, missing, enormous and invalid references have clear errors',()=>{
  const workbook=createWorkbook(), id=workbook.activeSheetId;
  setCell(workbook,id,'A1','=B1+1'); setCell(workbook,id,'B1','=A1+1'); assert.equal(getCellValue(workbook,id,'A1'),'#CYCLE!');
  setCell(workbook,id,'C1','=Missing!A1'); assert.equal(getCellValue(workbook,id,'C1'),'#REF!');
  setCell(workbook,id,'D1','=1/0'); assert.equal(getCellValue(workbook,id,'D1'),'#DIV/0!');
  setCell(workbook,id,'E1','=SUM(A1:XFD1048576)'); assert.equal(getCellValue(workbook,id,'E1'),'#NUM!');
  setCell(workbook,id,'F1','=NOPE(1)'); assert.equal(getCellValue(workbook,id,'F1'),'#NAME?');
  setCell(workbook,id,'G1','=#REF!'); assert.equal(getCellValue(workbook,id,'G1'),'#REF!');
  setCell(workbook,id,'H1','=2+#REF!'); assert.equal(getCellValue(workbook,id,'H1'),'#REF!');
});
test('fill adjusts relative references and preserves dollars and text',()=>{
  assert.equal(shiftFormula('=A1+$B$2+C$3+$D4',1,2),'=C2+$B$2+E$3+$D5');
  assert.equal(shiftFormula('=SUM(A1:B2)+\'Other tab\'!A1',2,1),"=SUM(B3:C4)+'Other tab'!B3");
  assert.equal(shiftFormula('=IF(A1="A1",LOG10(A1),$B$2)',1,1),'=IF(B2="A1",LOG10(B2),$B$2)');
  assert.equal(shiftFormula('=A1',-1,0),'=#REF!');
  assert.equal(shiftFormula('A1',1,1),'A1');
});
test('empty workbook does not add sections and ordinary tables are not imported',()=>{
  const body='## Data\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  assert.equal(serializeDocument(body,createWorkbook()),body);
  const parsed=parseDocument(body); assert.equal(parsed.body,body); assert.deepEqual(parsed.workbook.sheets[0].cells,{});
});
test('populated worksheets save readable values and preserve formulas, exact inputs and body',()=>{
  const workbook=createWorkbook(), id=workbook.activeSheetId;
  setCell(workbook,id,'A1','1.25'); setCell(workbook,id,'A2','=A1*2'); setCell(workbook,id,'B1','a|b\n**hello** <!-- -- >');
  workbook.sheets.push({id:'next',name:'Budget [draft]',cells:{A1:'€1.234,56',B1:'=SUM(Data!A1:A2)'}});
  workbook.activeSheetId='next';
  for (const body of ['', 'hello', 'hello\n', 'hello\n\n', 'hello\n\n\n', 'hello\r\n']) {
    const markdown=serializeDocument(body,workbook);
    assert.match(markdown,/## Data/); assert.match(markdown,/\| 2\.5 \|/); assert.match(markdown,/## Budget \\\[draft\\\]/);
    assert.ok(markdown.includes('a\\|b<br>\\*\\*hello\\*\\*'));
    assert.equal((markdown.match(/<!--/g)||[]).length,3,'Only the trusted three markers contain comment openers.');
    const parsed=parseDocument(markdown);
    assert.equal(parsed.body,body); assert.deepEqual(parsed.workbook,workbook); assert.deepEqual(parsed.warnings,[]);
    assert.equal(serializeDocument(parsed.body,parsed.workbook),markdown);
  }
});
test('empty named tabs generate a minimal table once any workbook tab has values',()=>{
  const workbook=createWorkbook(); workbook.sheets[0].name='Empty tab'; workbook.sheets.push({id:'full',name:'Filled',cells:{A1:'5'}});
  const markdown=serializeDocument('note',workbook); assert.ok(markdown.includes('## Empty tab')); assert.ok(markdown.includes('## Filled'));
  assert.equal(parseDocument(markdown).workbook.sheets[0].name,'Empty tab');
});
test('editing generated table values never silently restores stale formula metadata',()=>{
  const workbook=createWorkbook(); setCell(workbook,workbook.activeSheetId,'A1','=2+3');
  const edited=serializeDocument('note',workbook).replace('| 5 |','| 9 |');
  const parsed=parseDocument(edited); assert.equal(parsed.body,edited); assert.equal(parsed.warnings.length,1); assert.deepEqual(parsed.workbook.sheets[0].cells,{});
});
test('truncated or corrupt metadata stays intact in the main document',()=>{
  const workbook=createWorkbook(); setCell(workbook,workbook.activeSheetId,'A1','2');
  const markdown=serializeDocument('note',workbook);
  for (const damaged of [markdown.slice(0,-20),markdown.replace('%7B','%ZZ'),markdown+'extra text']) {
    const parsed=parseDocument(damaged); assert.equal(parsed.body,damaged); assert.equal(parsed.warnings.length,1);
  }
});
test('a quoted example workbook inside a fenced block stays ordinary text',()=>{
  const workbook=createWorkbook(); setCell(workbook,workbook.activeSheetId,'A1','2');
  const example='```markdown\n'+serializeDocument('',workbook);
  assert.equal(parseDocument(example).body,example);
});
test('CRLF conversion retains spreadsheet data',()=>{
  const workbook=createWorkbook(); setCell(workbook,workbook.activeSheetId,'A1','2');
  const markdown=serializeDocument('hello',workbook).replaceAll('\n','\r\n');
  const parsed=parseDocument(markdown); assert.equal(parsed.body,'hello'); assert.deepEqual(parsed.workbook,workbook); assert.deepEqual(parsed.warnings,[]);
});
test('unsafe or duplicate metadata is rejected and sparse export is bounded',()=>{
  const workbook=createWorkbook(); assert.throws(()=>validateWorkbook({...workbook,sheets:[workbook.sheets[0],workbook.sheets[0]]}));
  setCell(workbook,workbook.activeSheetId,'XFD1048576','1'); assert.throws(()=>serializeDocument('',workbook),/100,000/);
});
