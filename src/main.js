import './styles.css';
import {DocumentEditor,needsRawPreservation} from './ui/editor.js';
import {SpreadsheetView} from './ui/spreadsheet.js';
import {browserPlatform} from './ui/browser-platform.js';
import {createWorkbook,createEvaluator} from './core/workbook.js';
import {createLinkedInsertion,linkedDisplay,rawLinkReplacements,replaceSourceRanges,mapSourceOffset} from './core/linked-cells.js';
import {serializeDocument,parseDocument} from './core/markdown-workbook.js';
import {inspectNumericSelection,formatNumber} from './core/numbers.js';
import {formatBytes,utf8Bytes} from './core/file-size.js';
import {formatRecentTime} from './ui/recent-time.js';

const $=selector=>document.querySelector(selector);
let toastTimer;
function notice(message,duration=4500){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,duration);}
const native=Boolean(window.markpad);
const platform=window.markpad||browserPlatform(notice);
let editor,sheet,session,workbook=createWorkbook(),savedSource='',dirty=false,checkpointTimer,checkpointMaxTimer,statusTimer,closing=false,saving=false;
let calcShown=false,sheetShown=false,theme='system',calcValue=0,calcValid=true,calcAfterEquals=false;
let checkpointQueue=Promise.resolve(),lastFocus='document',loaded=false,rawChangedSinceSync=false;
let savedBytes=0,sizeTimer,formatWorker=null,formatGeneration=0,formatTimer,formatPending=false,lastEditAt=0,composing=false;
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(value){theme=['system','dark','light'].includes(value)?value:'system';document.documentElement.dataset.theme=theme==='system'?(systemTheme.matches?'dark':'light'):theme;$('#theme-button').textContent='◐ '+theme[0].toUpperCase()+theme.slice(1);$('#theme-button').title='Theme: '+theme[0].toUpperCase()+theme.slice(1);}
systemTheme.addEventListener('change',()=>{if(theme==='system')applyTheme('system');});
async function chooseTheme(value){await platform.setTheme(value);applyTheme(value);}
function getSource(){return editor.mode==='raw'?editor.getRaw():serializeDocument(editor.getBody(),workbook);}
function refreshTitle(){if(!session)return;$('#document-name').textContent=session.name||'Untitled';$('#web-title').textContent=(dirty?'● ':'')+(session.name||'Untitled');platform.setTitle({name:session.name,dirty}).catch(error=>notice(error.message));}
function status(){clearTimeout(statusTimer);statusTimer=setTimeout(()=>{if(!editor)return;for(const button of document.querySelectorAll('[data-format]'))button.setAttribute('aria-pressed',String(editor.active(button.dataset.format)));$('#block-style').value=editor.activeBlock();},90);}
function sizeStatus(){clearTimeout(sizeTimer);sizeTimer=setTimeout(()=>{
  if(!editor)return;
  try{const source=getSource(),bytes=utf8Bytes(source),changed=savedSource===null||source!==savedSource;
    $('#file-size').textContent=session.path?`Size: ${formatBytes(savedBytes)}${changed?' → '+formatBytes(bytes):''}`:`Size: ${formatBytes(bytes)} (unsaved)`;
    $('#file-size').title=`${session.path?'Last saved: '+savedBytes.toLocaleString()+' bytes. ':''}Current UTF-8 save size: ${bytes.toLocaleString()} bytes${changed?' (unsaved changes)':''}. Includes worksheet tables and metadata.`;
  }catch(error){$('#file-size').textContent='Size: unavailable';$('#file-size').title=error.message;}
},160);}
function updateModeLabel(){
  $('#mode-label').textContent=formatPending?'Fast text':editor.mode==='raw'?'Raw':'Formatted';
  $('#mode-icon').textContent=editor.mode==='raw'?'</>':'¶';
  $('#mode-toggle').setAttribute('aria-pressed',String(editor.mode==='raw'));
}
function cancelFormatting(){
  formatGeneration++;clearTimeout(formatTimer);formatWorker?.terminate();formatWorker=null;formatPending=false;
  $('#format-state').hidden=true;updateModeLabel();
}
function queueFormatting(delay=100){
  formatGeneration++;clearTimeout(formatTimer);formatWorker?.terminate();formatWorker=null;
  if(!formatPending)return;
  $('#format-state').hidden=false;$('#format-state').textContent='Formatting…';
  formatTimer=setTimeout(()=>{
    if(!formatPending||composing){if(formatPending)queueFormatting(300);return;}
    const fullSource=editor.getRaw(),parsed=parseDocument(fullSource),id=formatGeneration;
    if(needsRawPreservation(parsed.body)){cancelFormatting();showDocumentWarnings([...parsed.warnings,'Raw mode preserves unsupported source exactly.']);return;}
    try{
      const worker=new Worker('format-worker.js');formatWorker=worker;
      worker.onerror=()=>{if(id!==formatGeneration)return;cancelFormatting();notice('Formatting could not complete; the full document remains editable in Raw mode.',6500);};
      worker.onmessage=({data})=>{
        if(id!==formatGeneration||!formatPending||editor.getRaw()!==fullSource)return;
        worker.terminate();formatWorker=null;
        if(data.error){cancelFormatting();notice('Formatting could not complete; the original text is preserved. '+data.error,6500);return;}
        const promote=()=>{
          if(id!==formatGeneration||!formatPending||editor.getRaw()!==fullSource)return;
          if(composing||performance.now()-lastEditAt<350){formatTimer=setTimeout(promote,180);return;}
          try{
            const start=performance.now();
            editor.switchMode('formatted',{body:parsed.body,json:data.doc,preserveFocus:true});
            formatPending=false;$('#format-state').hidden=true;updateModeLabel();status();sizeStatus();requestAnimationFrame(updateSidebarPlacement);
            window.markpadLoadTiming={...(window.markpadLoadTiming||{}),parseMs:data.parseMs,hydrateMs:performance.now()-start,formattedMs:performance.now()};
          }catch(error){cancelFormatting();notice('Keeping the original text in Raw mode: '+error.message,6500);}
        };requestAnimationFrame(promote);
      };
      worker.postMessage({id,source:parsed.body});
    }catch(error){cancelFormatting();notice('Background formatting is unavailable; the document remains editable in Raw mode.',6500);}
  },delay);
}
function beginFormatting(source,{keepSelection=false}={}){
  formatPending=true;editor.showFastText(source,{keepSelection});updateModeLabel();queueFormatting();
}
function editChanged(){syncDocumentCellEdits();lastEditAt=performance.now();if(formatPending)queueFormatting(500);sizeStatus();requestAnimationFrame(updateSidebarPlacement);if(!loaded)return;dirty=true;refreshTitle();$('#document-state').textContent='Saving draft…';clearTimeout(checkpointTimer);checkpointTimer=setTimeout(()=>checkpoint().catch(reportCheckpointFailure),350);if(!checkpointMaxTimer)checkpointMaxTimer=setTimeout(()=>checkpoint().catch(reportCheckpointFailure),2000);status();}
function reportCheckpointFailure(error){$('#document-state').textContent='Draft not backed up';notice('Could not preserve this draft: '+error.message,9000);}
// A link is an ordinary editable Markdown label; the workbook owns its target.
// Only explicit registered IDs synchronize. No regex replacement of arbitrary
// matching numbers is used, and calculator inserts remain ordinary text.
let syncingLinks=false;
function refreshCellLinks(preserveIds=new Set()){
  const links=workbook.linkedCells;if(!links||!editor)return;
  const evaluate=createEvaluator(workbook);
  if(editor.mode==='raw'){
    const parsed=parseDocument(editor.getRaw());if(parsed.warnings.length)return;
    const replacements=rawLinkReplacements(parsed.body,workbook).filter(patch=>!preserveIds.has(patch.id));
    const start=editor.raw.selectionStart,end=editor.raw.selectionEnd,scroll=editor.raw.scrollTop;
    const body=replaceSourceRanges(parsed.body,replacements);
    for(const [id,link] of Object.entries(links))if(!preserveIds.has(id))link.lastText=linkedDisplay(workbook,link,evaluate);
    editor.setRaw(serializeDocument(body,workbook));
    editor.raw.setSelectionRange(mapSourceOffset(start,replacements),mapSourceOffset(end,replacements));editor.raw.scrollTop=scroll;
    rawChangedSinceSync=false;
  }else{
    editor.refreshLinkedValues(workbook,preserveIds);
    for(const [id,link] of Object.entries(links))if(!preserveIds.has(id))link.lastText=linkedDisplay(workbook,link,evaluate);
  }
}
function syncDocumentCellEdits(){
  if(syncingLinks||!editor||!sheet||!workbook.linkedCells||editor.editor.view.composing)return;
  syncingLinks=true;
  try{
    let source;
    if(editor.mode==='raw'){
      const parsed=parseDocument(editor.getRaw());if(parsed.warnings.length)return;
      source=parsed.body;
      // If metadata itself was deliberately edited, use the same conservative
      // import path as mode switching before considering link-label changes.
      if(JSON.stringify(parsed.workbook)!==JSON.stringify(workbook)){
        workbook=parsed.workbook;sheet.setWorkbook(workbook);workbook=sheet.workbook;
      }
    }
    const pending=new Map(),preserve=new Set();
    for(const item of editor.linkedOccurrences(source)){
      const link=workbook.linkedCells?.[item.id];
      if(!link||link.address===null||!workbook.sheets.some(s=>s.id===link.sheetId)||item.text===link.lastText)continue;
      pending.set(link.sheetId+'!'+link.address,{sheetId:link.sheetId,address:link.address,after:item.text});
      preserve.add(item.id);link.lastText=item.text;
    }
    if(!pending.size)return;
    sheet.applyCells([...pending.values()]);workbook=sheet.workbook;
    refreshCellLinks(preserve);
  }catch(error){notice('Cell link could not be updated: '+error.message);}
  finally{syncingLinks=false;}
}
function worksheetChanged(next){
  workbook=next;if(syncingLinks)return;
  syncingLinks=true;
  try{
    if(workbook.linkedCells)refreshCellLinks();
    else if(editor.mode==='raw'){
      const selection=editor.selection(),body=parseDocument(editor.getRaw()).body;
      editor.setRaw(serializeDocument(body,workbook),{history:true});
      editor.raw.setSelectionRange(Math.min(selection.from,editor.raw.value.length),Math.min(selection.to,editor.raw.value.length));rawChangedSinceSync=false;
    }
  }finally{syncingLinks=false;}
  editChanged();
}

function parseCurrentSource(source){
  const parsed=parseDocument(source);
  // Empty worksheets are session UI state until they contain data. Switching
  // editor mode must not reset their names or the selected cell.
  if(parsed.body===source&&!parsed.warnings.length&&workbook.sheets.every(s=>!Object.keys(s.cells).length))parsed.workbook=workbook;
  return parsed;
}
function syncRawWorkbook(){
  if(editor.mode!=='raw'||!rawChangedSinceSync)return true;
  const parsed=parseCurrentSource(editor.getRaw());showDocumentWarnings(parsed.warnings);
  if(parsed.warnings.length){notice('The raw spreadsheet section has changed. Restore its marked section before editing the sidebar, or keep working in raw mode.',6500);return false;}
  if(JSON.stringify(parsed.workbook)!==JSON.stringify(workbook)){workbook=parsed.workbook;sheet.setWorkbook(workbook);workbook=sheet.workbook;}
  rawChangedSinceSync=false;return true;
}
function showDocumentWarnings(warnings){const panel=$('#document-alert');panel.textContent=warnings.join(' ');panel.hidden=!warnings.length;}
async function checkpoint(){
  clearTimeout(checkpointTimer);clearTimeout(checkpointMaxTimer);checkpointMaxTimer=null;
  const markdown=getSource();dirty=savedSource===null||markdown!==savedSource;refreshTitle();
  const payload={markdown,dirty,name:session.name,mode:editor.mode};
  const operation=checkpointQueue.catch(()=>{}).then(()=>platform.checkpoint(payload));
  checkpointQueue=operation;
  return operation.then(result=>{$('#document-state').textContent=dirty?'Draft preserved':session.path?'Saved':'New note';return result;});
}
async function save(saveAs=false){
  if(saving)return;saving=true;
  try{
    sheet.commitEditing();const markdown=getSource();const result=await platform.save({markdown,saveAs});
    if(result?.canceled)return;if(!result?.saved)throw new Error('The save operation did not complete.');
    session.name=result.name||session.name;session.path=result.path||session.path;savedSource=markdown;savedBytes=utf8Bytes(markdown);sizeStatus();
    dirty=getSource()!==savedSource;refreshTitle();await checkpoint();notice('Saved '+session.name,2200);
  }catch(error){notice('Could not save: '+error.message,9000);}finally{saving=false;}
}
function toggleMode(){
  sheet.commitEditing();
  if(formatPending){cancelFormatting();return;}
  if(editor.mode==='raw'&&editor.getRaw().length>65536&&!needsRawPreservation(parseDocument(editor.getRaw()).body)){beginFormatting(editor.getRaw(),{keepSelection:true});return;}
  if(editor.mode==='formatted'){editor.switchMode('raw',{fullSource:getSource()});rawChangedSinceSync=false;showDocumentWarnings([]);}
  else{
    const parsed=parseCurrentSource(editor.getRaw());
    if(needsRawPreservation(parsed.body)){showDocumentWarnings([...parsed.warnings,'Raw mode preserves extended source (such as HTML, front matter, or an edited spreadsheet section) exactly.']);notice('Keeping raw mode to preserve this document’s source.');return;}
    if(JSON.stringify(workbook)!==JSON.stringify(parsed.workbook)){workbook=parsed.workbook;sheet.setWorkbook(workbook);workbook=sheet.workbook;}rawChangedSinceSync=false;editor.switchMode('formatted',{body:parsed.body});showDocumentWarnings(parsed.warnings);
  }
  $('#mode-label').textContent=editor.mode==='raw'?'Raw':'Formatted';$('#mode-icon').textContent=editor.mode==='raw'?'</>':'¶';
  $('#mode-toggle').setAttribute('aria-pressed',String(editor.mode==='raw'));requestAnimationFrame(updateSidebarPlacement);checkpoint().catch(reportCheckpointFailure);status();
}
function updateSidebarPlacement(){
  if(!editor)return;
  const surface=editor.mode==='raw'?editor.raw:editor.richElement;
  const showingScrollbar=surface.scrollHeight>surface.clientHeight+1;
  const width=showingScrollbar?Math.max(0,surface.offsetWidth-surface.clientWidth):0;
  document.documentElement.style.setProperty('--editor-scrollbar-width',`${width}px`);
}
function setPane(which,shown){
  if(which==='calculator')calcShown=shown;else{if(shown&&!syncRawWorkbook())return false;if(!shown)sheet.commitEditing();sheetShown=shown;}
  $('#calculator').hidden=!calcShown;$('#spreadsheet').hidden=!sheetShown;$('#calc-reserve').hidden=calcShown||!sheetShown;
  $('#sidebar').hidden=!(calcShown||sheetShown);$('#sidebar-resizer').hidden=!(calcShown||sheetShown);
  $('#workspace').dataset.panels=calcShown?(sheetShown?'both':'calculator'):(sheetShown?'spreadsheet':'none');
  $('#calc-tab').setAttribute('aria-expanded',String(calcShown));$('#sheet-tab').setAttribute('aria-expanded',String(sheetShown));
  requestAnimationFrame(()=>{updateSidebarPlacement();if(sheetShown)sheet.refresh();});return true;
}
function updateCalculator(expression,{equal=false}={}){
  $('#calc-expression').value=expression;const result=inspectNumericSelection(expression||'0');calcValid=result.valid;
  $('#calc-error').textContent=result.valid?'':result.error||'Enter a valid number or expression.';
  $('#calc-insert').disabled=!result.valid;
  if(result.valid){calcValue=result.value;$('#calc-result').textContent=formatNumber(result.value);if(equal)calcAfterEquals=true;}
  return result;
}
function sendToCalculator(){const sel=editor.selection();const result=inspectNumericSelection(sel.text);if(!result.valid){notice('Select a number or a valid numeric equation first.');return;}updateCalculator(sel.text);setPane('calculator',true);const input=$('#calc-expression');input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}
function insertCalculator(){if(!calcValid){notice('Finish the calculator expression before inserting its result.');return;}editor.insertText(formatNumber(calcValue));setPane('calculator',true);}
function evaluateInline(){const sel=editor.selection();const result=inspectNumericSelection(sel.text);if(!result.valid||!result.isEquation){notice('Select a numeric equation to append its result.');return;}editor.insertText(' = '+formatNumber(result.value),{append:true});}
function sendToSpreadsheet(){const sel=editor.selection();if(!sel.text){notice('Select text or an equation to send to the active cell.');return;}if(!setPane('spreadsheet',true))return;sheet.receiveText(sel.text);sheet.focus();}
function insertSpreadsheet(){
  if(!syncRawWorkbook()||!sheet.commitEditing())return;
  try{
    const {rows,cols}=sheet.selectedMatrix();const spec=createLinkedInsertion(workbook,sheet.activeSheetId,rows,cols);
    workbook.linkedCells={...workbook.linkedCells,...spec.links};sheet.workbook=workbook;
    // Raw text must already contain the new registrations when its input event
    // runs; otherwise the conservative importer could read stale metadata.
    if(editor.mode==='raw'){
      const selection=editor.selection(),body=parseDocument(editor.getRaw()).body;
      editor.setRaw(serializeDocument(body,workbook));editor.raw.setSelectionRange(Math.min(selection.from,body.length),Math.min(selection.to,body.length));
    }
    editor.insertLinkedCells(spec);setPane('spreadsheet',true);editChanged();
  }catch(error){notice(error.message);}
}

async function clipboardEdit(action){
  const selection=editor.selection(),mode=editor.mode,source=getSource();
  let text='';
  if(action==='cut'){if(platform.writeClipboard)await platform.writeClipboard(selection.text);else await navigator.clipboard.writeText(selection.text);}
  else text=await(platform.readClipboard?platform.readClipboard():navigator.clipboard.readText());
  if(editor.mode!==mode||getSource()!==source){notice('The document changed while the clipboard was working. Please try again.');return;}
  editor.selectRange(selection.from,selection.to);editor.insertText(text);
}
function openPopup(items,x,y){
  const popup=$('#popup-menu');popup.replaceChildren();
  for(const item of items){if(item.separator){popup.append(document.createElement('hr'));continue;}const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.disabled=Boolean(item.disabled);const label=document.createElement('span');label.textContent=item.label;button.append(label);if(item.shortcut){const key=document.createElement('kbd');key.textContent=item.shortcut;button.append(key);}button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{closePopup();Promise.resolve().then(item.action).catch(error=>notice(error.message));});popup.append(button);}
  popup.hidden=false;popup.style.left=Math.min(x,innerWidth-popup.offsetWidth-6)+'px';popup.style.top=Math.min(y,innerHeight-popup.offsetHeight-6)+'px';
}
function closePopup(){$('#popup-menu').hidden=true;}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#popup-menu,[data-menu],#theme-button'))closePopup();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closePopup();});
function themeMenu(event){const rect=event.currentTarget.getBoundingClientRect();openPopup(['system','light','dark'].map(value=>({label:(theme===value?'✓ ':'')+value[0].toUpperCase()+value.slice(1)+(value==='system'?' (default)':''),action:()=>chooseTheme(value)})),rect.left,rect.top-115);}

function modal(title,buildBody,actions=[]){
  const dialog=$('#modal'),container=$('#modal-content');container.replaceChildren();const header=document.createElement('div');header.className='modal-header';const heading=document.createElement('h2');heading.textContent=title;const close=document.createElement('button');close.textContent='×';close.ariaLabel='Close dialog';close.onclick=()=>dialog.close();header.append(heading,close);const body=document.createElement('div');body.className='modal-body';buildBody(body);container.append(header,body);
  if(actions.length){const footer=document.createElement('div');footer.className='modal-footer';for(const action of actions){const button=document.createElement('button');button.textContent=action.label;if(action.primary)button.className='primary';button.onclick=()=>action.run(dialog);footer.append(button);}container.append(footer);}
  if(!dialog.open)dialog.showModal();return dialog;
}
function confirmAction(title,message,action){modal(title,body=>{body.textContent=message;},[{label:'Cancel',run:dialog=>dialog.close()},{label:'Forget draft',primary:true,run:async dialog=>{try{await action();dialog.close();showRecents();}catch(error){notice(error.message);}}}]);}
function linkDialog(){
  const selection=editor.selection();
  const current=editor.mode==='formatted'?editor.editor.getAttributes('link').href||'':'';
  let addressInput,textInput;
  modal('Insert link',body=>{
    const textLabel=document.createElement('label');textLabel.textContent='Link text';
    textInput=document.createElement('input');textInput.value=selection.text;textInput.placeholder='Text to display';textInput.setAttribute('aria-label','Link text');textLabel.append(textInput);
    const addressLabel=document.createElement('label');addressLabel.textContent='Link address';
    addressInput=document.createElement('input');addressInput.value=current;addressInput.placeholder='https://example.com';addressInput.type='url';addressInput.setAttribute('aria-label','Link address');addressLabel.append(addressInput);
    body.append(textLabel,addressLabel);const note=document.createElement('p');note.className='help-note';note.textContent='Use https://, http://, mailto:, or a document anchor (#heading). Blank link text uses the address.';body.append(note);
  },[{label:'Cancel',run:dialog=>dialog.close()},{label:'Apply',primary:true,run:dialog=>{
    const value=addressInput.value.trim();
    if(value&&!/^(https?:\/\/|mailto:|#)/i.test(value)){notice('Use a web address, mailto: link, or #anchor.');addressInput.focus();return;}
    const label=textInput.value||value;dialog.close();
    if(value&&label!==selection.text){editor.selectRange(selection.from,selection.to);editor.insertText(label);const end=editor.selection().to;editor.selectRange(end-label.length,end);}
    editor.format('link',value);
  }}]);(selection.text?addressInput:textInput).focus();
}
async function showRecents(){
  const entries=await platform.listRecents();
  modal('Recent files & drafts',body=>{
    const intro=document.createElement('p');intro.className='help-note';
    intro.textContent='Closing a window keeps its draft here. Saved files are only changed when you choose Save.';
    body.append(intro);
    if(!entries.length){
      const empty=document.createElement('p');empty.className='empty-recents';
      empty.textContent='Your recent notes will appear here.';body.append(empty);
    }
    for(const entry of entries){
      const row=document.createElement('div');row.className='recent-row';
      const button=document.createElement('button');button.className='recent-main';
      const header=document.createElement('span');header.className='recent-main-header';
      const name=document.createElement('strong');name.textContent=(entry.dirty||!entry.path?'● ':'')+entry.name;
      const time=document.createElement('span');time.className='recent-time';
      time.textContent=formatRecentTime(entry.updatedAt);time.title=new Date(entry.updatedAt).toLocaleString();
      header.append(name,time);
      const detail=document.createElement('span');detail.textContent=entry.path||'Unsaved draft';
      const excerpt=document.createElement('span');excerpt.textContent=entry.excerpt||'';
      button.append(header,detail,excerpt);
      button.onclick=async()=>{await platform.openRecent(entry.id);$('#modal').close();};
      const forget=document.createElement('button');forget.className='recent-remove';
      forget.textContent='Forget';forget.title='Remove recovery copy; keep saved file';
      forget.disabled=entry.id===session.id;
      forget.onclick=()=>native?platform.removeRecent(entry.id).then(showRecents).catch(error=>notice(error.message)):confirmAction(
        'Forget this draft?','This removes the recoverable copy of “'+entry.name+'”. Its saved file, if any, stays on disk. Unsaved edits in this draft will be lost.',()=>platform.removeRecent(entry.id));
      row.append(button,forget);body.append(row);
    }
  });
}
function help(){modal('Markpad · tables-links-logo-2026-11-09',body=>{
  const headings=[['Editor',[['Ctrl+Tab','Switch formatted / raw'],['Ctrl+N / O','New window / Open file'],['Ctrl+S / Ctrl+Shift+S','Save / Save As'],['Ctrl+B / I / U / K','Bold / Italic / Underline / Link'],['Ctrl+E / Ctrl+Shift+C','Inline code / Code block'],['Ctrl+Shift+7 / 8 / 9','Numbered list / Bulleted list / Quote'],['Ctrl+Alt+1 / 2 / 3','Heading 1 / 2 / 3'],['Ctrl+Shift+X','Strikethrough'],['Ctrl+mouse wheel','Zoom in / out'],['Ctrl+F / H','Find / Replace']]],['Calculator · Alt+Shift',[['Alt+Shift+Right','Send selected number or equation to calculator'],['Alt+Shift+Left / keypad Enter','Insert calculator result in document'],['Alt+Shift+Up / Down','Show / Hide calculator']]],['Spreadsheet · Alt+Ctrl',[['Alt+Ctrl+Right','Send selection to active cell'],['Alt+Ctrl+Left / keypad Enter','Insert selected cells as linked text / a linked table'],['Alt+Ctrl+Up / Down','Show / Hide spreadsheet'],['F2 / Escape','Edit cell / Cancel edit'],['Ctrl+D / R','Fill down / right'],['Ctrl+PageUp / PageDown','Switch worksheet'],['Ctrl / Shift + header click','Toggle individual / select consecutive rows or columns'],['Double-click a header edge','Auto-fit that row/column or the selected headers'],['Drag left of A / above 1','Set all column widths / all row heights']]],['Inline calculation',[['Alt+Ctrl+Shift+Right','Append “ = result” after selected equation']]]];
  for(const [title,rows] of headings){const h=document.createElement('h3');h.textContent=title;const table=document.createElement('table');for(const [key,action] of rows){const row=table.insertRow();const cell=row.insertCell();const k=document.createElement('kbd');k.textContent=key;cell.append(k);row.insertCell().textContent=action;}body.append(h,table);}
  const p=document.createElement('p');p.className='help-note';p.textContent='Use the Alt modifier with every calculator or spreadsheet transfer. The Enter shortcuts use the numeric keypad. Calculator state is temporary. Worksheets are saved as readable Markdown tables, with hidden formula metadata. Percent is arithmetic: 10% = 0.1. Currency symbols are ignored; amounts are not converted.';body.append(p);
});}

let matches=[],matchIndex=-1;
function findOpen(replace=false){$('#find-bar').hidden=false;$('#replace-input').hidden=!replace;$('#replace-one').hidden=!replace;$('#replace-all').hidden=!replace;$('#find-input').focus();$('#find-input').select();refreshFind();}
function refreshFind(){matches=editor.findMatches($('#find-input').value);matchIndex=-1;$('#find-count').textContent=matches.length+' found';}
function findNext(direction=1){refreshFindIfNeeded();if(!matches.length)return;matchIndex=(matchIndex+direction+matches.length)%matches.length;const m=matches[matchIndex];editor.selectRange(m.from,m.to);$('#find-count').textContent=(matchIndex+1)+' / '+matches.length;}
function refreshFindIfNeeded(){const next=editor.findMatches($('#find-input').value);if(JSON.stringify(next)!==JSON.stringify(matches)){matches=next;matchIndex=-1;}}
function replaceOne(){if(matchIndex<0)findNext();if(matchIndex>=0&&matches[matchIndex]){editor.selectRange(matches[matchIndex].from,matches[matchIndex].to);editor.insertText($('#replace-input').value);refreshFind();findNext();}}
function focusIsSheet(){return lastFocus==='spreadsheet';}
async function command(action){
  if(action==='save')return save();if(action==='save-as')return save(true);if(action==='toggle-mode')return toggleMode();
  if(action==='open'){sheet.commitEditing();await checkpoint();return platform.open();}
  if(action==='calculator-show')return setPane('calculator',true);if(action==='calculator-hide')return setPane('calculator',false);
  if(action==='spreadsheet-show')return setPane('spreadsheet',true);if(action==='spreadsheet-hide')return setPane('spreadsheet',false);
  if(action==='send-to-calculator')return sendToCalculator();if(action==='insert-calculator')return insertCalculator();if(action==='evaluate-inline')return evaluateInline();
  if(action==='send-to-spreadsheet')return sendToSpreadsheet();if(action==='insert-spreadsheet')return insertSpreadsheet();
  if(action==='recent')return showRecents();if(action==='help')return help();if(action==='find')return findOpen();if(action==='replace')return findOpen(true);
  if(action==='undo'||action==='redo'){
    const active=document.activeElement;
    if(active?.matches('input,textarea')&&active!==editor.raw){document.execCommand(action);return;}
    return focusIsSheet()?sheet[action]():editor[action]();
  }
  if(action==='prepare-close'){
    if(closing)return;closing=true;
    try{sheet.commitEditing();$('#document-state').textContent='Preserving draft…';await checkpoint();await platform.readyToClose();}
    catch(error){reportCheckpointFailure(error);notice('This window is staying open because its latest draft could not be preserved. Try Save As, then close again.',12000);}
    finally{closing=false;}
  }
}

function wireUI(){
  $('#mode-toggle').onclick=toggleMode;$('#theme-button').onclick=themeMenu;
  for(const button of document.querySelectorAll('[data-format]')){button.onmousedown=event=>event.preventDefault();button.onclick=()=>button.dataset.format==='link'?linkDialog():editor.format(button.dataset.format);}
  $('#block-style').onchange=event=>editor.format(event.target.value);
  $('#calc-tab').onclick=()=>setPane('calculator',!calcShown);$('#sheet-tab').onclick=()=>setPane('spreadsheet',!sheetShown);
  $('#calc-insert').onclick=insertCalculator;
  $('#calc-expression').oninput=event=>{calcAfterEquals=false;updateCalculator(event.target.value);};
  $('#calc-expression').onkeydown=event=>{if(!event.altKey&&event.key==='Enter'){event.preventDefault();updateCalculator(event.target.value,{equal:true});}if(!event.altKey&&event.key==='Escape'){event.preventDefault();updateCalculator('');}};
  const keys=['C','%','⌫','÷','7','8','9','×','4','5','6','−','1','2','3','+','±','0','.','='];
  for(const key of keys){const button=document.createElement('button');button.textContent=key;button.ariaLabel=key==='⌫'?'Backspace':key==='C'?'Clear':key;button.className=key==='='?'equals':/[^0-9.]/.test(key)?'operator':'';button.onmousedown=event=>event.preventDefault();button.onclick=()=>{let text=$('#calc-expression').value;if(key==='C')text='';else if(key==='⌫')text=text.slice(0,-1);else if(key==='='){updateCalculator(text,{equal:true});return;}else if(key==='±')text=text.startsWith('-(')&&text.endsWith(')')?text.slice(2,-1):'-('+(text||'0')+')';else{if(calcAfterEquals)text=/^[0-9.]$/.test(key)?'':formatNumber(calcValue);text+=key;}calcAfterEquals=false;updateCalculator(text);};$('#calc-keys').append(button);}
  $('#document-pane').addEventListener('contextmenu',event=>{event.preventDefault();const selection=editor.selection();const numeric=inspectNumericSelection(selection.text);openPopup([
    {label:'Send to calc',shortcut:'Alt+Shift+→',disabled:!numeric.valid,action:sendToCalculator},
    {label:'Append equation result',shortcut:'Alt+Ctrl+Shift+→',disabled:!numeric.valid||!numeric.isEquation,action:evaluateInline},
    {label:'Send to spreadsheet',shortcut:'Alt+Ctrl+→',disabled:!selection.text,action:sendToSpreadsheet},
    {separator:true},{label:'Copy',shortcut:'Ctrl+C',disabled:!selection.text,action:()=>platform.writeClipboard?platform.writeClipboard(selection.text):navigator.clipboard.writeText(selection.text)},
    {label:'Cut',shortcut:'Ctrl+X',disabled:!selection.text,action:()=>clipboardEdit('cut')},
    {label:'Paste',shortcut:'Ctrl+V',action:()=>clipboardEdit('paste')},
    {label:'Select all',shortcut:'Ctrl+A',action:()=>editor.selectAll()}
  ],event.clientX,event.clientY);});
  document.addEventListener('pointerdown',event=>{if(event.target.closest('#sheet-content')&&!syncRawWorkbook()){event.preventDefault();event.stopImmediatePropagation();}},true);
  $('#document-pane').addEventListener('focusout',event=>{
    if(event.relatedTarget&&event.currentTarget.contains(event.relatedTarget))return;
    if(workbook.linkedCells&&!syncingLinks){syncDocumentCellEdits();refreshCellLinks();}
  });
  document.addEventListener('focusin',event=>{if(event.target.closest('#sheet-content'))lastFocus='spreadsheet';else if(event.target.closest('#document-pane'))lastFocus='document';else if(event.target.closest('#calculator'))lastFocus='calculator';});
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229||$('#modal').open)return;
    const key=event.key,code=event.code,ctrl=event.ctrlKey||event.metaKey;
    if(event.altKey&&ctrl&&event.shiftKey&&key==='ArrowRight'){event.preventDefault();evaluateInline();return;}
    if(event.altKey&&!event.shiftKey&&ctrl){const action={ArrowRight:sendToSpreadsheet,ArrowLeft:insertSpreadsheet,ArrowUp:()=>setPane('spreadsheet',true),ArrowDown:()=>setPane('spreadsheet',false)}[key]||(code==='NumpadEnter'?insertSpreadsheet:null);if(action){event.preventDefault();action();return;}}
    if(event.altKey&&event.shiftKey&&!ctrl){const action={ArrowRight:sendToCalculator,ArrowLeft:insertCalculator,ArrowUp:()=>setPane('calculator',true),ArrowDown:()=>setPane('calculator',false)}[key]||(code==='NumpadEnter'?insertCalculator:null);if(action){event.preventDefault();action();return;}}
    if(event.altKey)return;
    if(ctrl&&key==='Tab'){event.preventDefault();toggleMode();return;}
    if(ctrl&&key.toLowerCase()==='k'&&lastFocus==='document'){event.preventDefault();linkDialog();return;}
    if(ctrl&&['b','i'].includes(key.toLowerCase())&&editor.mode==='raw'&&lastFocus==='document'){event.preventDefault();editor.format(key.toLowerCase()==='b'?'bold':'italic');return;}
    if(!native&&ctrl){const action={n:()=>platform.newWindow(),o:()=>command('open'),s:()=>save(event.shiftKey),f:()=>findOpen(),h:()=>findOpen(true)}[key.toLowerCase()];if(action){event.preventDefault();action();return;}}
    if(!native&&key==='F1'){event.preventDefault();help();}
    if(key==='Escape'&&!$('#find-bar').hidden){$('#find-bar').hidden=true;editor.focus();}
  },true);
  $('#find-input').oninput=refreshFind;$('#find-input').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();findNext(event.shiftKey?-1:1);}};
  $('#find-next').onclick=()=>findNext(1);$('#find-prev').onclick=()=>findNext(-1);$('#find-close').onclick=()=>{$('#find-bar').hidden=true;editor.focus();};$('#replace-one').onclick=replaceOne;$('#replace-all').onclick=()=>{refreshFindIfNeeded();editor.replaceMatches(matches,$('#replace-input').value);refreshFind();};
  $('#sidebar-resizer').addEventListener('pointerdown',event=>{const startX=event.clientX,startWidth=$('#sidebar').offsetWidth;event.target.setPointerCapture(event.pointerId);const move=e=>{document.documentElement.style.setProperty('--sidebar-width',Math.max(250,Math.min(innerWidth-260,startWidth+startX-e.clientX))+'px');sheet.refresh();};const end=()=>{event.target.removeEventListener('pointermove',move);event.target.removeEventListener('pointerup',end);};event.target.addEventListener('pointermove',move);event.target.addEventListener('pointerup',end);});
  $('#sidebar-resizer').onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const width=$('#sidebar').offsetWidth+(event.key==='ArrowLeft'?20:-20);document.documentElement.style.setProperty('--sidebar-width',Math.max(250,Math.min(innerWidth-260,width))+'px');sheet.refresh();}};
  for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>command(button.dataset.action);
  if(!native){$('#web-menu').hidden=false;for(const button of document.querySelectorAll('[data-menu]'))button.onclick=()=>{const rect=button.getBoundingClientRect();let items;
    if(button.dataset.menu==='file')items=[{label:'New window',shortcut:'Ctrl+N',action:()=>platform.newWindow()},{label:'Open…',shortcut:'Ctrl+O',action:()=>command('open')},{label:'Save',shortcut:'Ctrl+S',action:()=>save()},{label:'Save As…',shortcut:'Ctrl+Shift+S',action:()=>save(true)},{separator:true},{label:'Recent files & drafts',action:showRecents}];
    else if(button.dataset.menu==='edit')items=[{label:'Undo',shortcut:'Ctrl+Z',action:()=>command('undo')},{label:'Redo',shortcut:'Ctrl+Y',action:()=>command('redo')},{separator:true},{label:'Find',shortcut:'Ctrl+F',action:()=>findOpen()},{label:'Replace',shortcut:'Ctrl+H',action:()=>findOpen(true)}];
    else items=[{label:'Formatted / Raw',shortcut:'Ctrl+Tab',action:toggleMode},{label:'Word Wrap',action:()=>$('#word-wrap-button').click()},{label:'Calculator',shortcut:'Alt+Shift+↑',action:()=>setPane('calculator',!calcShown)},{label:'Spreadsheet',shortcut:'Alt+Ctrl+↑',action:()=>setPane('spreadsheet',!sheetShown)},{separator:true},...['system','light','dark'].map(value=>({label:(theme===value?'✓ ':'')+value[0].toUpperCase()+value.slice(1),action:()=>chooseTheme(value)}))];openPopup(items,rect.left,rect.bottom);};$('#browser-open').onchange=async event=>{if(event.target.files[0]){sheet.commitEditing();await checkpoint();platform.importFile(event.target.files[0]);}};
    window.addEventListener('pagehide',()=>{try{sheet.commitEditing();platform.checkpoint({markdown:getSource(),dirty,name:session.name,mode:editor.mode});}catch{}});
  }
}

async function start(){
  session=await platform.bootstrap();applyTheme(session.theme);const parsed=parseDocument(session.markdown||'');workbook=parsed.workbook;savedSource=session.dirty?null:session.markdown||'';dirty=Boolean(session.dirty);
  savedBytes=Number.isFinite(session.savedBytes)?session.savedBytes:session.path&&!session.dirty?utf8Bytes(session.markdown||''):0;
  const requiresRaw=needsRawPreservation(parsed.body),progressive=!requiresRaw&&parsed.body.length>65536;
  editor=new DocumentEditor({onChange:()=>{if(editor?.mode==='raw')rawChangedSinceSync=true;editChanged();},onSelection:status});editor.setBody(requiresRaw||progressive?'':parsed.body);
  if(progressive)beginFormatting(session.markdown||'');
  sheet=new SpreadsheetView({element:$('#sheet-content'),workbook,onNotice:notice,onInsert:insertSpreadsheet,onChange:worksheetChanged});
  workbook=sheet.workbook; // share the validated workbook so link metadata and cell edits remain atomic
  wireUI();
  editor.raw.addEventListener('compositionstart',()=>composing=true);editor.raw.addEventListener('compositionend',()=>{composing=false;if(formatPending)queueFormatting(350);});
  if(workbook.sheets.some(worksheet=>Object.values(worksheet.cells).some(value=>value!=='')))setPane('spreadsheet',true);
  new ResizeObserver(()=>updateSidebarPlacement()).observe(editor.richElement);
  new ResizeObserver(()=>updateSidebarPlacement()).observe(editor.raw);
  platform.onCommand(action=>Promise.resolve(command(action)).catch(error=>notice(error.message)));platform.onTheme(applyTheme);
  if(requiresRaw){editor.switchMode('raw',{fullSource:session.markdown});$('#mode-label').textContent='Raw';$('#mode-icon').textContent='</>';showDocumentWarnings([...parsed.warnings,'Opened in raw mode to preserve extended source exactly, or keep this large document responsive.']);}
  else showDocumentWarnings(parsed.warnings);
  syncDocumentCellEdits();
  loaded=true;window.markpadLoadTiming={editableMs:performance.now()};requestAnimationFrame(updateSidebarPlacement);refreshTitle();status();sizeStatus();$('#document-state').textContent=session.recovered?'Recovered draft':dirty?'Draft preserved':session.path?'Saved':'New note';editor.focus();
  // An intentionally small integration surface keeps separate UI enhancements
  // decoupled from the editor's dependency-heavy bundle and preserves recovery.
  window.markpadApp=Object.freeze({editor:()=>editor, sheet:()=>sheet, platform:()=>platform});
  document.dispatchEvent(new Event('markpad:ready'));
  // A small, read-only inspection surface aids desktop smoke verification.
  window.markpadInspect=Object.freeze({source:()=>getSource(),state:()=>({mode:editor.mode,dirty,calcShown,sheetShown,calculator:calcValue,theme,formatPending,release:'tables-links-logo-2026-11-09',savedBytes,sheets:workbook.sheets.map(s=>({id:s.id,name:s.name,cells:{...s.cells},columnWidths:{...s.columnWidths},rowHeights:{...s.rowHeights}}))})});
}
start().catch(error=>{$('#document-state').textContent='Could not open editor';notice(error.message,20000);console.error(error);});
