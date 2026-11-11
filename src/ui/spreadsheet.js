import {
  createWorkbook, validateWorkbook, setCell, createEvaluator, sheetBounds,
  parseCellAddress, cellAddress, columnName, shiftFormula, MAX_ROWS, MAX_COLUMNS,
  MAX_STORED_CELLS,
} from '../core/workbook.js';
import {selectAxis,axisContains,axisCount,axisIndices} from '../core/sheet-selection.js';
import {AxisGeometry,editWorksheetAxis,cycleReferenceLocks,referenceAtCaret} from '../core/sheet-operations.js';
import { formatNumber, parseNumberLiteral, inspectNumericSelection, evaluateExpression } from '../core/numbers.js';

const ROW_HEIGHT = 27;
const COL_WIDTH = 108;
const ROW_HEADER = 34;
const COL_HEADER = 27;
const MAX_BATCH = 10000;
const HISTORY_BYTES = 4 * 1024 * 1024;
const CLIPBOARD_TYPE = 'application/x-markpad-cells';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function parseTSV(input) {
  const text = String(input).replace(/\r\n?/g, '\n');
  const rows = [[]];
  let field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' && (quoted || field === '')) {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (character === '\t' || character === '\n')) {
      rows.at(-1).push(field); field = '';
      if (character === '\n') rows.push([]);
    } else field += character;
  }
  rows.at(-1).push(field);
  if (text.endsWith('\n') && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
  return rows.length ? rows : [['']];
}

function quoteTSV(value) {
  const text = String(value ?? '');
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renameReferences(formula, oldName, newName) {
  if (!formula.startsWith('=')) return formula;
  return formula.replace(/"(?:[^"]|"")*"|'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_. ]*)!/g, (match, quoted, plain) => {
    if (match.startsWith('"')) return match;
    const name = quoted === undefined ? plain : quoted.replaceAll("''", "'");
    return name?.toLowerCase() === oldName.toLowerCase() ? `'${newName.replaceAll("'", "''")}'!` : match;
  });
}

/** A small virtual grid. Only cells intersecting the viewport have DOM nodes. */
export class SpreadsheetView {
  constructor({ element, workbook, onChange, onInsert, onNotice }) {
    this.element = element;
    this.onChange = onChange || (() => {});
    this.onInsert = onInsert || (() => {});
    this.onNotice = onNotice || (() => {});
    this.workbook = validateWorkbook(workbook || createWorkbook());
    this.anchor = { row: 0, col: 0 };
    this.point = { row: 0, col: 0 };
    this.axisSelection = null;
    this.views = new Map();
    this.editing = null;
    this.undoStack = [];
    this.redoStack = [];
    this.historyBytes = 0;
    this.frame = null;
    this.drag = null;

    this.formulaRow = node('div', 'sheet-formula-row');
    this.address = node('span', 'sheet-address', 'A1');
    this.address.setAttribute('aria-live', 'polite');
    this.formula = node('input', 'sheet-formula');
    this.formula.setAttribute('aria-label', 'Active cell input or formula');
    this.formula.setAttribute('placeholder', 'Value or =formula');
    this.formula.spellcheck = false;
    this.formula.autocomplete = 'off';
    this.formulaRow.append(this.address, node('span', 'sheet-fx', 'ƒx'), this.formula);

    this.grid = node('div', 'sheet-grid');
    this.grid.tabIndex = 0;
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Worksheet cells');
    this.grid.setAttribute('aria-multiselectable', 'true');
    this.canvas = node('div', 'sheet-canvas');
    this.layer = node('div');
    this.canvas.append(this.layer);
    this.grid.append(this.canvas);
    this.tabs = node('div', 'sheet-tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Worksheets');
    this.info = node('div', 'sheet-selection-info');
    this.insertButton=node('button','insert-button sheet-insert');
    this.insertButton.type='button';this.insertButton.id='sheet-insert';
    this.insertButton.append(node('strong','','← Insert cell(s)'),node('span','','Linked'));
    this.insertButton.title='Insert the selected cells in the document, linked in both directions (Alt+Ctrl+Left)';
    this.insertButton.addEventListener('pointerdown',event=>event.preventDefault());
    this.insertButton.addEventListener('click',()=>{if(this.commitEditing())this.onInsert();});
    this.element.replaceChildren(this.formulaRow, this.grid, this.tabs, this.info, this.insertButton);

    this.grid.addEventListener('scroll', () => this.scheduleRender(), { passive: true });
    this.grid.addEventListener('pointerdown', event => this.pointerDown(event));
    this.grid.addEventListener('pointermove', event => this.pointerMove(event));
    this.grid.addEventListener('pointerup', event => this.pointerUp(event));
    this.grid.addEventListener('pointercancel', event => this.pointerUp(event));
    this.grid.addEventListener('contextmenu',event=>this.headerMenu(event));
    this.grid.addEventListener('dblclick', event => {
      if (event.target.closest('.sheet-cell')) { event.preventDefault(); this.startEditing(); }
    });
    this.element.addEventListener('keydown', event => this.keyDown(event));
    this.element.addEventListener('copy', event => this.copy(event, false));
    this.element.addEventListener('cut', event => this.copy(event, true));
    this.element.addEventListener('paste', event => this.paste(event));
    this.formula.addEventListener('focus', () => this.startFormulaEditing());
    this.formula.addEventListener('blur', () => { if (this.editing?.source === 'formula') this.commitEditing(); });
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.grid);
    this.refresh();
  }

  get activeCell() { return cellAddress(this.anchor.row, this.anchor.col); }
  set activeCell(address) { this.select(parseCellAddress(address)); }
  get sheet() { return this.workbook.sheets.find(sheet => sheet.id === this.workbook.activeSheetId) || this.workbook.sheets[0]; }
  get activeSheetId() { return this.sheet.id; }
  getWorkbook() { this.commitEditing(); return this.workbook; }
  getActiveValue() { this.commitEditing(); return this.evaluate(this.sheet.id, this.activeCell); }
  focus() { this.grid.focus({ preventScroll: true }); this.ensureVisible(); }

  setWorkbook(workbook) {
    this.cancelEditing();
    this.workbook = validateWorkbook(workbook || createWorkbook());
    this.anchor = { row: 0, col: 0 }; this.point = { ...this.anchor };this.axisSelection=null;
    this.views.clear(); this.undoStack = []; this.redoStack = []; this.historyBytes = 0;
    this.grid.scrollTop = 0; this.grid.scrollLeft = 0;
    this.refresh();
  }

  receiveText(text) {
    this.commitEditing();
    const raw = String(text ?? '');
    const trimmed = raw.trim();
    const number = parseNumberLiteral(trimmed);
    const numeric = inspectNumericSelection(trimmed);
    let input = raw;
    if (number !== null) input = formatNumber(number);
    else if (trimmed.startsWith('=')) input = trimmed;
    else if (numeric.valid && numeric.isEquation) input = `=${trimmed}`;
    else if (/[+*/^%=×÷]|\d\s*-|[A-Za-z_]+\s*\(/.test(trimmed)) {
      // Validate a reference-bearing expression with harmless placeholder cell
      // values. The real workbook evaluator supplies its actual dependencies.
      try { evaluateExpression(trimmed, { resolveReference: () => 1, resolveRange: () => [1] }); input = `=${trimmed}`; }
      catch (error) {
        // An evaluable expression can legitimately produce a cell error. Keep
        // that formula editable instead of changing "1/0" into ordinary text.
        if (['#DIV/0!', '#REF!', '#CYCLE!', '#NUM!'].includes(error.code)) input = `=${trimmed}`;
      }
    }
    this.applyCells([{ sheetId: this.sheet.id, address: this.activeCell, after: input }]);
    this.ensureVisible();this.focus();
    return input;
  }

  range() {
    if(this.axisSelection){
      const sel=this.axisSelection,bounds=sheetBounds(this.sheet),first=sel.spans[0][0],last=sel.spans.at(-1)[1];
      return sel.axis==='row'?{top:first,bottom:last,left:0,right:Math.max(0,bounds.cols-1)}:{top:0,bottom:Math.max(0,bounds.rows-1),left:first,right:last};
    }
    return { top: Math.min(this.anchor.row, this.point.row), bottom: Math.max(this.anchor.row, this.point.row),
      left: Math.min(this.anchor.col, this.point.col), right: Math.max(this.anchor.col, this.point.col) };
  }

  select(point, extend = false, scroll = true) {
    this.axisSelection=null;
    point = { row: clamp(point.row, 0, MAX_ROWS - 1), col: clamp(point.col, 0, MAX_COLUMNS - 1) };
    if (!extend) this.anchor = { ...point };
    this.point = { ...point };
    this.rows = Math.max(this.rows || 1000, point.row + 30);
    this.cols = Math.max(this.cols || 52, point.col + 4);
    this.resizeCanvas();
    if (scroll) this.ensureVisible(point);
    this.render();
  }

  isSelected(row,col){
    if(this.axisSelection)return axisContains(this.axisSelection,this.axisSelection.axis==='row'?row:col);
    const r=this.range();return row>=r.top&&row<=r.bottom&&col>=r.left&&col<=r.right;
  }
  selectHeader(axis,index,event={}){
    this.axisSelection=selectAxis(this.axisSelection,axis,index,{control:event.ctrlKey||event.metaKey,shift:event.shiftKey});
    this.anchor=axis==='row'?{row:index,col:0}:{row:0,col:index};this.point={...this.anchor};
    this.lastCellClick=null;this.render();
  }
  selectedMatrix(limit=MAX_BATCH){
    const r=this.range(),sel=this.axisSelection;
    const rowCount=sel?.axis==='row'?axisCount(sel):r.bottom-r.top+1;
    const colCount=sel?.axis==='column'?axisCount(sel):r.right-r.left+1;
    if(rowCount*colCount>limit)throw Error(`Select up to ${limit.toLocaleString()} cells for this operation. Whole headers use the worksheet's used extent.`);
    const rows=sel?.axis==='row'?axisIndices(sel,limit):Array.from({length:rowCount},(_,i)=>r.top+i);
    const cols=sel?.axis==='column'?axisIndices(sel,limit):Array.from({length:colCount},(_,i)=>r.left+i);
    return {rows,cols};
  }
  updateGeometry(){this.rowGeometry=new AxisGeometry(this.sheet.defaultRowHeight??ROW_HEIGHT,MAX_ROWS,this.sheet.rowHeights||{});this.colGeometry=new AxisGeometry(this.sheet.defaultColumnWidth??COL_WIDTH,MAX_COLUMNS,this.sheet.columnWidths||{});}

  resizeCanvas() {
    if(!this.rowGeometry)this.updateGeometry();
    this.rows = Math.min(MAX_ROWS, this.rows); this.cols = Math.min(MAX_COLUMNS, this.cols);
    this.canvas.style.width = `${ROW_HEADER + this.colGeometry.offset(this.cols)}px`;
    this.canvas.style.height = `${COL_HEADER + this.rowGeometry.offset(this.rows)}px`;
    this.grid.setAttribute('aria-rowcount', this.rows);
    this.grid.setAttribute('aria-colcount', this.cols);
  }

  ensureVisible(point = this.point) {
    const width = this.grid.clientWidth || 320, height = this.grid.clientHeight || 170;
    const x=ROW_HEADER+this.colGeometry.offset(point.col),y=COL_HEADER+this.rowGeometry.offset(point.row),cw=this.colGeometry.size(point.col),rh=this.rowGeometry.size(point.row);
    if (x < this.grid.scrollLeft + ROW_HEADER) this.grid.scrollLeft = x - ROW_HEADER;
    else if (x + cw > this.grid.scrollLeft + width) this.grid.scrollLeft = x + cw - width;
    if (y < this.grid.scrollTop + COL_HEADER) this.grid.scrollTop = y - COL_HEADER;
    else if (y + rh > this.grid.scrollTop + height) this.grid.scrollTop = y + rh - height;
  }

  refresh() {
    this.updateGeometry();
    const bounds = sheetBounds(this.sheet);
    this.rows = Math.max(1000, bounds.rows + 50, this.point.row + 30);
    this.cols = Math.max(52, bounds.cols + 4, this.point.col + 4);
    this.resizeCanvas();
    this.evaluate = createEvaluator(this.workbook);
    this.renderTabs(); this.render();
  }

  scheduleRender() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
  }

  render() {
    const width = this.grid.clientWidth || 320, height = this.grid.clientHeight || 170;
    const scrollX = this.grid.scrollLeft, scrollY = this.grid.scrollTop;
    const firstCol = Math.max(0, this.colGeometry.indexAt(scrollX-ROW_HEADER) - 1);
    const lastCol = Math.min(this.cols - 1, this.colGeometry.indexAt(scrollX+width-ROW_HEADER)+1);
    const firstRow = Math.max(0, this.rowGeometry.indexAt(scrollY-COL_HEADER) - 1);
    const lastRow = Math.min(this.rows - 1, this.rowGeometry.indexAt(scrollY+height-COL_HEADER)+1);
    const range = this.range(), fragment = document.createDocumentFragment();
    const place = (element, x, y, w, h=COL_HEADER) => { element.style.height=`${h}px`; element.style.left = `${x}px`; element.style.top = `${y}px`; element.style.width = `${w}px`; return element; };
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        const address = cellAddress(row, col), value = this.evaluate(this.sheet.id, address);
        const selected = this.isSelected(row,col);
        const active = row === this.anchor.row && col === this.anchor.col;
        const reference=this.editing?.reference;const referenced=reference&&row>=Math.min(reference.row,reference.baseRow??reference.row)&&row<=Math.max(reference.row,reference.baseRow??reference.row)&&col>=Math.min(reference.col,reference.baseCol??reference.col)&&col<=Math.max(reference.col,reference.baseCol??reference.col);
        const cell = node('div', `sheet-cell${referenced?' referenced':''}${selected ? ' selected' : ''}${active ? ' active' : ''}${typeof value === 'number' ? ' numeric' : ''}${/^#(?:REF|VALUE|DIV|NUM|NAME|N\/A|CYCLE|ERROR)/.test(String(value)) ? ' error' : ''}`);
        cell.append(node('span','sheet-cell-value',formatNumber(value)));
        cell.dataset.row = row; cell.dataset.col = col;
        cell.id = `sheet-cell-${row}-${col}`;
        cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-rowindex', row + 1); cell.setAttribute('aria-colindex', col + 1);
        cell.setAttribute('aria-selected', String(selected)); cell.setAttribute('aria-label', `${address}: ${formatNumber(value)}`);
        cell.title = `${address}${this.sheet.cells[address] ? `: ${this.sheet.cells[address]}` : ''}`;
        fragment.append(place(cell, ROW_HEADER+this.colGeometry.offset(col),COL_HEADER+this.rowGeometry.offset(row),this.colGeometry.size(col),this.rowGeometry.size(row)));
      }
      const header = node('div', `sheet-row${(this.axisSelection?this.axisSelection.axis==='row'&&axisContains(this.axisSelection,row):row>=range.top&&row<=range.bottom)?' selected':''}`, String(row + 1));
      header.dataset.row = row; header.setAttribute('role', 'rowheader');
      header.append(this.resizeHandle('row',row,'start'),this.resizeHandle('row',row,'end'));
      fragment.append(place(header,scrollX,COL_HEADER+this.rowGeometry.offset(row),ROW_HEADER,this.rowGeometry.size(row)));
    }
    for (let col = firstCol; col <= lastCol; col++) {
      const header = node('div', `sheet-col${(this.axisSelection?this.axisSelection.axis==='column'&&axisContains(this.axisSelection,col):col>=range.left&&col<=range.right)?' selected':''}`, columnName(col));
      header.dataset.col = col; header.setAttribute('role', 'columnheader');
      header.append(this.resizeHandle('column',col,'start'),this.resizeHandle('column',col,'end'));
      fragment.append(place(header,ROW_HEADER+this.colGeometry.offset(col),scrollY,this.colGeometry.size(col)));
    }
    fragment.append(place(node('div', 'sheet-corner'), scrollX, scrollY, ROW_HEADER));
    this.layer.replaceChildren(fragment);
    this.grid.setAttribute('aria-activedescendant', `sheet-cell-${this.anchor.row}-${this.anchor.col}`);
    this.address.textContent = this.activeCell;
    if(this.editing?.source==='cell')this.formula.value=this.editing.input.value;else if(!this.editing)this.formula.value=this.sheet.cells[this.activeCell]||'';
    let count = 0, sum = 0, numericCount = 0;
    if (this.axisSelection || range.top !== range.bottom || range.left !== range.right) {
      for (const address of Object.keys(this.sheet.cells)) {
        const point = parseCellAddress(address);
        if (!this.isSelected(point.row,point.col)) continue;
        count++;
        const value = this.evaluate(this.sheet.id, address);
        if (typeof value === 'number') { sum += value; numericCount++; }
      }
      const description=this.axisSelection?`${axisCount(this.axisSelection)} ${this.axisSelection.axis==='row'?'rows':'columns'}`:`${cellAddress(range.top,range.left)}:${cellAddress(range.bottom,range.right)}`;
      this.info.textContent = `${description}  ·  Count ${count}${numericCount ? `  ·  Sum ${formatNumber(sum)}` : ''}`;
    } else this.info.textContent=this.editing?.reference?`Point: ${cellAddress(this.editing.reference.row,this.editing.reference.col)} · Editing ${this.editing.address} · F4 locks reference`:'F2 to edit · Right-click headers to insert/delete';
  }

  pointerDown(event) {
    if (event.button !== 0 || event.target === this.editing?.input) return;
    const handle=event.target.closest('.sheet-resize-handle');if(handle){this.beginResize(event,handle);return;}
    const cell = event.target.closest('.sheet-cell'), row = event.target.closest('.sheet-row'), col = event.target.closest('.sheet-col');
    if (!cell && !row && !col && !event.target.closest('.sheet-corner')) return;
    if(cell&&this.editing&&this.editing.input.value.startsWith('=')&&this.editing.pointMode!==false){event.preventDefault();this.pointFormula({row:Number(cell.dataset.row),col:Number(cell.dataset.col)},event.shiftKey,true);return;}
    if (!this.commitEditing()) return;
    event.preventDefault(); this.grid.focus({ preventScroll: true });
    const bounds = sheetBounds(this.sheet);
    if (cell) {
      const point = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
      const address = cellAddress(point.row, point.col), now = performance.now();
      const doubleClick = !event.shiftKey && this.lastCellClick?.address === address && now - this.lastCellClick.time < 400;
      this.lastCellClick = { address, time: now };
      this.select(point, event.shiftKey, false);
      // Virtual rendering replaces cell nodes, so native dblclick targeting is
      // not reliable. Track consecutive presses on the same logical cell.
      if (doubleClick) { this.lastCellClick = null; this.startEditing(); return; }
      this.drag = { id: event.pointerId };
      this.grid.setPointerCapture(event.pointerId);
    } else if (row) {
      this.selectHeader('row',Number(row.dataset.row),event);
    } else if (col) {
      this.selectHeader('column',Number(col.dataset.col),event);
    } else this.selectUsed();
  }

  pointerMove(event) {
    if(this.resizeDrag?.id===event.pointerId){this.moveResize(event);return;}
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const rect = this.grid.getBoundingClientRect();
    if (event.clientY < rect.top + COL_HEADER) this.grid.scrollTop -= ROW_HEIGHT;
    else if (event.clientY > rect.bottom - 12) this.grid.scrollTop += ROW_HEIGHT;
    if (event.clientX < rect.left + ROW_HEADER) this.grid.scrollLeft -= COL_WIDTH / 2;
    else if (event.clientX > rect.right - 12) this.grid.scrollLeft += COL_WIDTH / 2;
    const point = { row:this.rowGeometry.indexAt(event.clientY-rect.top+this.grid.scrollTop-COL_HEADER),col:this.colGeometry.indexAt(event.clientX-rect.left+this.grid.scrollLeft-ROW_HEADER) };
    this.select(point, true, false);
  }

  pointerUp(event) {
    if(this.resizeDrag?.id===event.pointerId){this.finishResize(event);return;}
    if (this.drag?.id !== event.pointerId) return;
    if (this.grid.hasPointerCapture(event.pointerId)) this.grid.releasePointerCapture(event.pointerId);
    this.drag = null;
  }

  selectUsed() {
    this.axisSelection=null;
    const bounds = sheetBounds(this.sheet);
    this.anchor = { row: 0, col: 0 }; this.point = { row: Math.max(0, bounds.rows - 1), col: Math.max(0, bounds.cols - 1) };
    this.render();
  }

  startFormulaEditing() {
    if (this.editing?.source === 'formula') return;
    if (!this.commitEditing()) return;
    this.editing = { source: 'formula', input: this.formula, sheetId: this.sheet.id, address: this.activeCell, original: this.sheet.cells[this.activeCell] || '',pointMode:true };
    this.formula.oninput=()=>this.formulaInput();
  }

  startEditing(initial, pointMode = true) {
    if (this.editing?.source === 'cell') return;
    if (!this.commitEditing()) return;
    this.ensureVisible(this.anchor);
    const input = node('input', 'sheet-edit');
    input.setAttribute('aria-label', `Edit cell ${this.activeCell}`); input.autocomplete = 'off'; input.spellcheck = false;
    input.value = initial === undefined ? this.sheet.cells[this.activeCell] || '' : initial;
    input.style.left = `${ROW_HEADER+this.colGeometry.offset(this.anchor.col)}px`;
    input.style.top = `${COL_HEADER+this.rowGeometry.offset(this.anchor.row)}px`;
    input.style.width=`${this.colGeometry.size(this.anchor.col)}px`;input.style.height=`${this.rowGeometry.size(this.anchor.row)}px`;
    this.editing = { source: 'cell', input, sheetId: this.sheet.id, address: this.activeCell, original: this.sheet.cells[this.activeCell] || '', pointMode };
    input.addEventListener('input',()=>this.formulaInput());
    this.canvas.append(input);
    input.addEventListener('blur', () => { if (this.editing?.input === input) this.commitEditing(); });
    input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length);this.formula.value=input.value;
  }

  formulaInput(){
    if(!this.editing)return;
    this.editing.reference=null;
    if(this.editing.source==='cell')this.formula.value=this.editing.input.value;
    this.scheduleRender();
  }

  pointFormula(point,extend=false,byMouse=false){
    const editing=this.editing;if(!editing)return false;
    const input=editing.input,caret=input.selectionStart;
    let ref=editing.reference;
    if(!ref){
      const token=referenceAtCaret(input.value,caret);
      const before=input.value.slice(0,caret);
      if(!byMouse&&!token&&!/[=+\-*/^(,:&<>]\s*$/.test(before))return false;
      // Don't turn arrow navigation inside a quoted string into a reference.
      if((before.match(/"/g)||[]).length%2)return false;
      ref={start:token?.start??caret,end:token?.end??input.selectionEnd,row:this.anchor.row,col:this.anchor.col,colLock:'',rowLock:''};
    }
    point={row:clamp(point.row,0,MAX_ROWS-1),col:clamp(point.col,0,MAX_COLUMNS-1)};
    if(extend&&ref.baseRow===undefined){ref.baseRow=ref.row;ref.baseCol=ref.col;}
    if(!extend){delete ref.baseRow;delete ref.baseCol;}
    ref.row=point.row;ref.col=point.col;
    const address=`${ref.colLock||''}${columnName(point.col)}${ref.rowLock||''}${point.row+1}`;
    const text=ref.baseRow===undefined?address:cellAddress(ref.baseRow,ref.baseCol)+':'+address;
    input.setRangeText(text,ref.start,ref.end,'end');ref.end=ref.start+text.length;editing.reference=ref;
    if(editing.source==='cell')this.formula.value=input.value;
    editing.hasPointed = true;
    this.rows=Math.max(this.rows,point.row+30);this.cols=Math.max(this.cols,point.col+4);this.resizeCanvas();this.ensureVisible(point);this.render();input.focus({preventScroll:true});return true;
  }

  lockReference(){
    const edit=this.editing,input=edit?.input;if(!input)return;
    const token=referenceAtCaret(input.value,input.selectionStart);if(!token)return;
    const text=cycleReferenceLocks(token.text);input.setRangeText(text,token.start,token.end,'end');
    if(edit.reference){edit.reference.end+=text.length-token.text.length;const m=text.match(/^(\$?)[A-Z]+(\$?)/);edit.reference.colLock=m[1];edit.reference.rowLock=m[2];}
    if(edit.source==='cell')this.formula.value=input.value;this.render();
  }

  resizeHandle(axis,index,edge='end'){
    const handle=node('span',`sheet-resize-handle ${axis} ${edge}`);handle.dataset.axis=axis;handle.dataset.index=index;handle.dataset.edge=edge;
    handle.title=index===0&&edge==='start'?`Drag to resize ALL ${axis==='row'?'rows':'columns'}; double-click to auto-fit this ${axis}`:`Drag to resize; double-click to auto-fit ${axis}${this.axisSelection?.axis===axis?' selection':''}`;
    return handle;
  }
  resizeTargets(axis,index){
    return this.axisSelection?.axis===axis&&axisContains(this.axisSelection,index)?axisIndices(this.axisSelection,100000):[index];
  }
  beginResize(event,handle){
    if(!this.commitEditing())return;
    event.preventDefault();event.stopPropagation();
    const axis=handle.dataset.axis,index=Number(handle.dataset.index),edge=handle.dataset.edge;
    const now=performance.now(),signature=`${axis}:${index}:${edge}`;
    if(this.lastResizeClick?.signature===signature&&now-this.lastResizeClick.time<500){
      this.lastResizeClick=null;try{this.autoFit(axis,index);}catch(error){this.onNotice(error.message);}return;
    }
    const all=index===0&&edge==='start';
    let indices;try{indices=all?null:this.resizeTargets(axis,index);}catch(error){this.onNotice(error.message);return;}
    this.resizeDrag={id:event.pointerId,axis,index,edge,all,indices,signature,start:axis==='row'?event.clientY:event.clientX,size:(axis==='row'?this.rowGeometry:this.colGeometry).size(index),before:JSON.stringify(this.workbook),moved:false};
    this.grid.focus({preventScroll:true});this.grid.setPointerCapture(event.pointerId);
  }
  setAxisSize(axis,indices,size,{all=false}={}){
    const key=axis==='row'?'rowHeights':'columnWidths',defaultKey=axis==='row'?'defaultRowHeight':'defaultColumnWidth';
    if(all){this.sheet[defaultKey]=size;delete this.sheet[key];return;}
    this.sheet[key]??={};for(const index of indices)this.sheet[key][index]=size;
  }
  moveResize(event){
    const d=this.resizeDrag,current=d.axis==='row'?event.clientY:event.clientX;
    if(!d.moved&&Math.abs(current-d.start)<3)return;
    d.moved=true;this.lastResizeClick=null;
    const scale=this.grid.getBoundingClientRect().width/(this.grid.offsetWidth||1)||1;
    // Both sides belong to the header under the pointer. The two global seams
    // use positive drags to enlarge the sheet-wide defaults.
    const direction=d.edge==='start'&&!d.all?-1:1;
    const size=Math.round(clamp(d.size+direction*(current-d.start)/scale,d.axis==='row'?18:36,10000));
    this.setAxisSize(d.axis,d.indices,size,{all:d.all});this.updateGeometry();this.resizeCanvas();this.render();
  }
  finishResize(event){
    const d=this.resizeDrag;this.resizeDrag=null;
    if(this.grid.hasPointerCapture(event.pointerId))this.grid.releasePointerCapture(event.pointerId);
    if(event.type==='pointercancel'){
      this.workbook=validateWorkbook(JSON.parse(d.before));this.refresh();this.lastResizeClick=null;return;
    }
    if(!d.moved)this.lastResizeClick={signature:d.signature,time:performance.now()};
    const after=JSON.stringify(this.workbook);if(after!==d.before){this.pushHistory({type:'structure',before:d.before,after});this.changed();}
  }
  autoFit(axis,index){
    const indices=this.resizeTargets(axis,index),selected=new Set(indices);
    const sample=this.layer.querySelector('.sheet-cell'),style=getComputedStyle(sample||this.grid);
    const font=style.font||'12px "Segoe UI",sans-serif',canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=font;
    let size=axis==='column'?36:27,probe;
    if(axis==='row'){
      probe=node('div','sheet-autofit-probe');Object.assign(probe.style,{position:'fixed',left:'-20000px',top:'0',visibility:'hidden',font,whiteSpace:'pre-wrap',overflowWrap:'anywhere',wordBreak:'normal',lineHeight:'17px',padding:'4px 7px',border:'0',boxSizing:'border-box',height:'auto'});document.body.append(probe);
    }
    try{
      const cache=new Map();
      // Stored cells, not the virtual viewport, determine the fit. Formula
      // results are measured rather than the formula's source text.
      for(const [address] of Object.entries(this.sheet.cells)){
        const point=parseCellAddress(address);if(!selected.has(axis==='row'?point.row:point.col))continue;
        const text=formatNumber(this.evaluate(this.sheet.id,address));
        if(axis==='column'){
          for(const line of String(text).split(/\r\n|\r|\n/))size=Math.max(size,context.measureText(line.replaceAll('\t','    ')).width+18);
        }else{
          const width=this.colGeometry.size(point.col),key=width+'\0'+text;
          let measured=cache.get(key);
          if(measured===undefined){probe.style.width=width+'px';probe.textContent=text||' ';measured=probe.scrollHeight+1;cache.set(key,measured);}
          size=Math.max(size,measured);
        }
      }
    }finally{probe?.remove();}
    size=Math.ceil(clamp(size,axis==='row'?18:36,10000));
    this.structuralChange(()=>this.setAxisSize(axis,indices,size));this.grid.focus({preventScroll:true});
  }
  headerMenu(event){
    const header=event.target.closest('.sheet-row,.sheet-col');if(!header)return;
    event.preventDefault();event.stopPropagation();if(!this.commitEditing())return;
    this.closeHeaderMenu?.();
    const axis=header.classList.contains('sheet-row')?'row':'column',index=Number(header.dataset[axis==='row'?'row':'col']);
    if(this.axisSelection?.axis!==axis||!axisContains(this.axisSelection,index))this.selectHeader(axis,index);
    const selection=structuredClone(this.axisSelection),count=axisCount(selection),plural=count>1?'s':'';
    const menu=node('div','popup sheet-header-menu');menu.setAttribute('role','menu');
    const remove=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);this.closeHeaderMenu=null;};
    const outside=e=>{if(!menu.contains(e.target))remove();};const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();remove();this.focus();}};
    this.closeHeaderMenu=remove;
    const choices=axis==='row'?[[`Insert row${plural} above`,'before'],[`Insert row${plural} below`,'after'],[`Delete row${plural}`,'delete']]:[[`Insert column${plural} left`,'before'],[`Insert column${plural} right`,'after'],[`Delete column${plural}`,'delete']];
    choices.push([`Auto-fit ${count>1?'selected '+axis+plural:axis}`,'fit']);
    for(const [label,action] of choices){const button=node('button','',label);button.setAttribute('role','menuitem');button.addEventListener('click',()=>{
      remove();try{
        if(action==='fit'){this.autoFit(axis,index);return;}
        this.structuralChange(()=>{
          let next=this.workbook;const id=this.sheet.id;
          for(const [first,last] of [...selection.spans].reverse())next=editWorksheetAxis(next,id,axis,action==='after'?last+1:first,{remove:action==='delete',count:last-first+1});
          this.workbook=next;const at=selection.spans[0][0];this.anchor={row:axis==='row'?Math.min(at,MAX_ROWS-1):this.anchor.row,col:axis==='column'?Math.min(at,MAX_COLUMNS-1):this.anchor.col};this.point={...this.anchor};this.axisSelection=null;
        });this.focus();
      }catch(error){this.onNotice(error.message);}
    });menu.append(button);}
    document.body.append(menu);menu.style.left=Math.max(0,Math.min(event.clientX,innerWidth-menu.offsetWidth-6))+'px';menu.style.top=Math.max(0,Math.min(event.clientY,innerHeight-menu.offsetHeight-6))+'px';
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);menu.firstChild.focus();
  }

  commitEditing() {
    if (!this.editing) return true;
    const editing = this.editing, value = editing.input.value;
    try {
      if (value.length > 100000) throw new Error('A cell may contain at most 100,000 characters.');
      this.editing = null;
      if (editing.source === 'cell') editing.input.remove();
      if (value !== editing.original) this.applyCells([{ sheetId: editing.sheetId, address: editing.address, after: value }]);
      else this.render();
      if (editing.hasPointed) this.ensureVisible(parseCellAddress(editing.address));
      return true;
    } catch (error) {
      this.editing = editing;
      if (editing.source === 'cell' && !editing.input.isConnected) this.canvas.append(editing.input);
      this.onNotice(error.message); editing.input.focus({ preventScroll: true });
      return false;
    }
  }

  cancelEditing() {
    if (!this.editing) return;
    const editing = this.editing; this.editing = null;
    if (editing.source === 'cell') editing.input.remove();
    else editing.input.value = editing.original;
    if (editing.hasPointed) this.ensureVisible(parseCellAddress(editing.address));
    this.render();
  }

  applyCells(inputs, record = true) {
    if (inputs.length > MAX_BATCH) throw new Error(`Use up to ${MAX_BATCH.toLocaleString()} cells in one edit.`);
    const changes = [];
    let count = this.workbook.sheets.reduce((total, sheet) => total + Object.keys(sheet.cells).length, 0);
    const seen = new Set();
    for (const item of inputs) {
      const sheet = this.workbook.sheets.find(sheet => sheet.id === item.sheetId);
      if (!sheet) throw new Error('That worksheet no longer exists.');
      const point = parseCellAddress(item.address), address = cellAddress(point.row, point.col), after = String(item.after ?? '');
      if (after.length > 100000) throw new Error('A cell may contain at most 100,000 characters.');
      const key = `${sheet.id}:${address}`;
      if (seen.has(key)) throw new Error('A cell cannot be changed twice in one edit.');
      seen.add(key);
      const before = sheet.cells[address] || '';
      if (before === after) continue;
      if (!before && after) count++; else if (before && !after) count--;
      changes.push({ sheetId: sheet.id, address, before, after });
    }
    if (count > MAX_STORED_CELLS) throw new Error('This workbook has reached its stored-cell limit.');
    if (!changes.length) return false;
    for (const change of changes) setCell(this.workbook, change.sheetId, change.address, change.after);
    if (record) this.pushHistory({ type: 'cells', changes, activeSheetId: this.sheet.id, anchor: { ...this.anchor }, point: { ...this.point } });
    this.changed();
    return true;
  }

  changed() { this.refresh(); this.onChange(this.workbook); }

  pushHistory(entry) {
    entry.bytes = JSON.stringify(entry).length * 2;
    this.redoStack = [];
    if (entry.bytes > HISTORY_BYTES) { this.undoStack = []; this.historyBytes = 0; this.onNotice('This large change exceeds the undo-history memory budget.'); return; }
    this.undoStack.push(entry); this.historyBytes += entry.bytes;
    while (this.undoStack.length > 80 || this.historyBytes > HISTORY_BYTES) this.historyBytes -= this.undoStack.shift().bytes;
  }

  history(direction) {
    if (this.editing) { document.execCommand(direction); return; }
    const source = direction === 'undo' ? this.undoStack : this.redoStack;
    const target = direction === 'undo' ? this.redoStack : this.undoStack;
    const entry = source.pop();
    if (!entry) return false;
    this.axisSelection=null;
    if (entry.type === 'cells') {
      for (const change of entry.changes) setCell(this.workbook, change.sheetId, change.address, direction === 'undo' ? change.before : change.after);
      this.workbook.activeSheetId = entry.activeSheetId;
      this.anchor = { ...entry.anchor }; this.point = { ...entry.point };
    } else this.workbook = validateWorkbook(JSON.parse(direction === 'undo' ? entry.before : entry.after));
    target.push(entry);
    this.historyBytes += direction === 'undo' ? -entry.bytes : entry.bytes;
    this.changed(); this.ensureVisible(); this.focus();
    return true;
  }

  undo() { return this.history('undo'); }
  redo() { return this.history('redo'); }

  clearSelection() {
    const range = this.range(), changes = [];
    for (const address of Object.keys(this.sheet.cells)) {
      const point = parseCellAddress(address);
      if (this.isSelected(point.row,point.col)) changes.push({ sheetId: this.sheet.id, address, after: '' });
    }
    this.applyCells(changes);
  }

  fill(direction) {
    const {rows,cols}=this.selectedMatrix(),changes=[];
    for(const row of rows)for(const col of cols){
      if(direction==='down'?row===rows[0]:col===cols[0])continue;
      const sourceRow=direction==='down'?rows[0]:row,sourceCol=direction==='down'?col:cols[0];
      const raw=this.sheet.cells[cellAddress(sourceRow,sourceCol)]||'';
      changes.push({sheetId:this.sheet.id,address:cellAddress(row,col),after:shiftFormula(raw,row-sourceRow,col-sourceCol)});
    }
    this.applyCells(changes);
  }

  boundary(rowStep, colStep) {
    let point = { ...this.point };
    const occupied = value => !!this.sheet.cells[cellAddress(value.row, value.col)];
    const inBounds = value => value.row >= 0 && value.row < this.rows && value.col >= 0 && value.col < this.cols;
    let next = { row: point.row + rowStep, col: point.col + colStep };
    if (!inBounds(next)) return point;
    if (occupied(point) && occupied(next)) {
      while (inBounds(next) && occupied(next)) { point = next; next = { row: point.row + rowStep, col: point.col + colStep }; }
    } else {
      point = next;
      while (!occupied(point)) {
        next = { row: point.row + rowStep, col: point.col + colStep };
        if (!inBounds(next)) break;
        point = next;
      }
    }
    return point;
  }

  keyDown(event) {
    if (event.altKey || event.isComposing) return;
    if (event.target.closest('.sheet-tab input, .sheet-tab-rename')) return;
    const control = event.ctrlKey || event.metaKey;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    try {
      if (this.editing && event.target === this.editing.input) {
        if(event.key==='F4'&&this.editing.input.value.startsWith('=')){stop();this.lockReference();return;}
        if(event.key==='F2'){stop();this.editing.pointMode=!this.editing.pointMode;this.editing.reference=null;this.render();return;}
        const edit = this.editing;
        const origin = parseCellAddress(edit.address);
        const formula = edit.input.value.startsWith('=');
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          const rowStep = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
          const colStep = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (formula) {
            const from = edit.reference || origin;
            if (!control && edit.pointMode && this.pointFormula({ row: from.row + rowStep, col: from.col + colStep }, event.shiftKey)) stop();
          } else {
            stop();
            if (this.commitEditing()) {
              this.select(control ? this.boundary(rowStep, colStep) : { row: origin.row + rowStep, col: origin.col + colStep }, event.shiftKey);
              this.focus();
            }
          }
          return;
        }
        if (event.key === 'Escape') { stop(); this.cancelEditing(); this.focus(); }
        else if (event.key === 'Enter' || event.key === 'Tab') {
          stop();
          if (this.commitEditing()) {
            const step = event.shiftKey ? -1 : 1;
            this.select({
              row: origin.row + (event.key === 'Enter' && !control ? step : 0),
              col: origin.col + (event.key === 'Tab' && !formula ? step : 0),
            });
            this.focus();
          }
        }
        return;
      }
      if (event.target !== this.grid && !event.target.closest('.sheet-cell')) return;
      if (control && ['c', 'x', 'v'].includes(event.key.toLowerCase())) return;
      if (control && event.key.toLowerCase() === 'z') { stop(); event.shiftKey ? this.redo() : this.undo(); return; }
      if (control && event.key.toLowerCase() === 'y') { stop(); this.redo(); return; }
      if (control && event.key.toLowerCase() === 'a') { stop(); this.selectUsed(); return; }
      if (event.key === ' ' && (control || event.shiftKey)) {
        stop(); const bounds = sheetBounds(this.sheet);
        if (control && event.shiftKey) this.selectUsed();
        else if (control) this.selectHeader('column',this.anchor.col);
        else this.selectHeader('row',this.anchor.row);
        return;
      }
      if (control && ['d', 'r'].includes(event.key.toLowerCase())) { stop(); this.fill(event.key.toLowerCase() === 'd' ? 'down' : 'right'); return; }
      if (control && ['PageUp', 'PageDown'].includes(event.key)) {
        stop(); const index = this.workbook.sheets.findIndex(sheet => sheet.id === this.sheet.id);
        this.switchSheet(this.workbook.sheets[clamp(index + (event.key === 'PageUp' ? -1 : 1), 0, this.workbook.sheets.length - 1)].id); return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { stop(); this.clearSelection(); return; }
      if (event.key === 'F2') { stop(); this.startEditing(undefined, false); return; }
      if (event.key === 'Enter' || event.key === 'Tab') {
        stop(); this.select({ row: this.anchor.row + (event.key === 'Enter' ? (event.shiftKey ? -1 : 1) : 0), col: this.anchor.col + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0) }); return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        stop(); const bounds = sheetBounds(this.sheet);
        this.select(event.key === 'Home' ? { row: control ? 0 : this.point.row, col: 0 } : { row: control ? Math.max(0, bounds.rows - 1) : this.point.row, col: Math.max(0, bounds.cols - 1) }, event.shiftKey); return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
        stop();
        const step = Math.max(1, Math.floor((this.grid.clientHeight - COL_HEADER) / ROW_HEIGHT));
        const rowStep = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'PageUp' ? -step : event.key === 'PageDown' ? step : 0;
        const colStep = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        const next = control && !event.key.startsWith('Page') ? this.boundary(rowStep, colStep) : { row: this.point.row + rowStep, col: this.point.col + colStep };
        this.select(next, event.shiftKey); return;
      }
      if (!control && event.key.length === 1) { stop(); this.startEditing(event.key); }
    } catch (error) { stop(); this.onNotice(error.message); }
  }

  copy(event, cut) {
    if (this.editing || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!this.grid.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation();
    let matrix;try{matrix=this.selectedMatrix();}catch(error){this.onNotice(error.message);return;}
    const {rows,cols}=matrix,raw=[],values=[];
    for(const row of rows){
      const rawRow=[],valueRow=[];
      for(const col of cols){const address=cellAddress(row,col);rawRow.push(this.sheet.cells[address]||'');valueRow.push(quoteTSV(formatNumber(this.evaluate(this.sheet.id,address))));}
      raw.push(rawRow);values.push(valueRow.join('\t'));
    }
    event.clipboardData.setData('text/plain',values.join('\n'));
    event.clipboardData.setData(CLIPBOARD_TYPE,JSON.stringify({version:1,row:rows[0],col:cols[0],rowIndices:rows,colIndices:cols,cut,cells:raw}));
    if (cut) { try { this.clearSelection(); } catch (error) { this.onNotice(error.message); } }
  }

  paste(event) {
    if (this.editing || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!this.grid.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation();
    try {
      let internal = null;
      try {
        const value = JSON.parse(event.clipboardData.getData(CLIPBOARD_TYPE));
        if (value.version === 1 && Array.isArray(value.cells) && Number.isInteger(value.row) && Number.isInteger(value.col)) internal = value;
      } catch { /* Ordinary external clipboard data. */ }
      const rows = internal ? internal.cells : parseTSV(event.clipboardData.getData('text/plain'));
      if (!rows.length || rows.some(row => !Array.isArray(row))) throw new Error('Invalid cell clipboard data.');
      const columns = Math.max(...rows.map(row => row.length));
      if (!columns || rows.length * columns > MAX_BATCH) throw new Error(`Paste up to ${MAX_BATCH.toLocaleString()} cells at once.`);
      const start = { ...this.anchor };
      if (start.row + rows.length > MAX_ROWS || start.col + columns > MAX_COLUMNS) throw new Error('The pasted range would extend beyond the worksheet.');
      const changes = [];
      for (let row = 0; row < rows.length; row++) for (let col = 0; col < columns; col++) {
        let input = String(rows[row][col] ?? '');
        if (internal && !internal.cut) input = shiftFormula(input, start.row+row-(internal.rowIndices?.[row]??internal.row+row), start.col+col-(internal.colIndices?.[col]??internal.col+col));
        changes.push({ sheetId: this.sheet.id, address: cellAddress(start.row + row, start.col + col), after: input });
      }
      this.applyCells(changes);
      this.select({ row: start.row + rows.length - 1, col: start.col + columns - 1 }, true);
    } catch (error) { this.onNotice(error.message); }
  }

  renderTabs() {
    const fragment = document.createDocumentFragment();
    for (const sheet of this.workbook.sheets) {
      const tab = node('button', `sheet-tab${sheet.id === this.sheet.id ? ' active' : ''}`, sheet.name);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(sheet.id === this.sheet.id));
      tab.title = `${sheet.name} — double-click to rename; right-click for worksheet actions`;
      tab.addEventListener('click', () => this.switchSheet(sheet.id));
      tab.addEventListener('dblclick', event => { event.preventDefault(); this.renameTab(sheet.id); });
      tab.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); this.sheetDialog(sheet.id); });
      fragment.append(tab);
    }
    const add = node('button', 'sheet-add', '+');
    add.setAttribute('aria-label', 'Add worksheet'); add.title = 'Add worksheet';
    add.addEventListener('click', () => this.addSheet()); fragment.append(add);
    this.tabs.replaceChildren(fragment);
  }

  switchSheet(id) {
    if (!this.commitEditing()) return;
    if (!this.workbook.sheets.some(sheet => sheet.id === id)) return;
    if (id === this.sheet.id) { this.focus(); return; }
    this.views.set(this.sheet.id, { axisSelection:structuredClone(this.axisSelection),anchor: { ...this.anchor }, point: { ...this.point }, x: this.grid.scrollLeft, y: this.grid.scrollTop });
    this.workbook.activeSheetId = id;
    const saved = this.views.get(id);
    this.anchor = saved?.anchor || { row: 0, col: 0 }; this.point = saved?.point || { ...this.anchor };this.axisSelection=saved?.axisSelection||null;
    this.refresh(); this.grid.scrollLeft = saved?.x || 0; this.grid.scrollTop = saved?.y || 0;
    this.focus();
  }

  structuralChange(operation) {
    if (!this.commitEditing()) return;
    const before = JSON.stringify(this.workbook);
    operation();
    const after = JSON.stringify(this.workbook);
    if (before !== after) { this.pushHistory({ type: 'structure', before, after }); this.changed(); }
  }

  addSheet() {
    try {
      if (this.workbook.sheets.length >= 128) throw new Error('A workbook supports up to 128 worksheets.');
      let index = 2, name = 'Data 2';
      while (this.workbook.sheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) name = `Data ${++index}`;
      const id = crypto.randomUUID();
      this.structuralChange(() => { this.workbook.sheets.push({ id, name, cells: {} }); });
      this.switchSheet(id); this.renameTab(id);
    } catch (error) { this.onNotice(error.message); }
  }

  renameTab(id) {
    if (!this.commitEditing()) return;
    const sheet = this.workbook.sheets.find(sheet => sheet.id === id);
    const index = this.workbook.sheets.indexOf(sheet), tab = this.tabs.children[index];
    if (!sheet || !tab) return;
    const input = node('input', 'sheet-tab-rename');
    input.value = sheet.name; input.setAttribute('aria-label', 'Worksheet name'); input.maxLength = 100;
    input.style.width = `${clamp(sheet.name.length + 3, 8, 22)}ch`; input.style.height = '25px'; input.style.fontSize = '11px';
    let done = false;
    const finish = apply => {
      if (done) return true;
      const value = input.value.trim();
      if (apply && (!value || /[\r\n\u0000]/.test(value) || this.workbook.sheets.some(other => other.id !== id && other.name.toLowerCase() === value.toLowerCase()))) {
        this.onNotice('Choose a nonempty worksheet name that is not already in use.'); input.focus(); return false;
      }
      done = true;
      if (apply && value !== sheet.name) {
        this.structuralChange(() => {
          const previous = sheet.name; sheet.name = value;
          for (const worksheet of this.workbook.sheets) for (const address of Object.keys(worksheet.cells)) worksheet.cells[address] = renameReferences(worksheet.cells[address], previous, value);
        });
      } else this.renderTabs();
      return true;
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); if (finish(true)) this.focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); this.focus(); }
    });
    input.addEventListener('blur', () => finish(true));
    tab.replaceWith(input); input.focus(); input.select();
  }

  sheetDialog(id) {
    const sheet = this.workbook.sheets.find(sheet => sheet.id === id);
    if (!sheet) return;
    const dialog = node('dialog'); dialog.style.maxWidth = '410px';
    const header = node('div', 'modal-header'); header.append(node('h2', '', sheet.name));
    const body = node('div', 'modal-body'); body.append(node('p', '', 'Rename this worksheet, or delete it and its cells. Deleting can be undone while this document is open. Formulas referencing a deleted worksheet will show an error.'));
    const footer = node('div', 'modal-footer');
    const cancel = node('button', '', 'Cancel'), rename = node('button', '', 'Rename'), remove = node('button', '', 'Delete worksheet');
    remove.style.color = 'var(--danger)';
    cancel.addEventListener('click', () => dialog.close());
    rename.addEventListener('click', () => { dialog.close(); this.renameTab(id); });
    remove.addEventListener('click', () => {
      dialog.close();
      this.structuralChange(() => {
        this.workbook.sheets = this.workbook.sheets.filter(sheet => sheet.id !== id);
        if (!this.workbook.sheets.length) this.workbook = createWorkbook();
        else if (this.workbook.activeSheetId === id) this.workbook.activeSheetId = this.workbook.sheets[0].id;
        this.anchor = { row: 0, col: 0 }; this.point = { ...this.anchor };
      });
      this.focus();
    });
    footer.append(cancel, rename, remove); dialog.append(header, body, footer);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  }

  destroy() { this.resizeObserver.disconnect(); if (this.frame !== null) cancelAnimationFrame(this.frame); }
}
