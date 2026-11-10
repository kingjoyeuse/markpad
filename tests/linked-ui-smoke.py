"""Focused real-pointer/keyboard tests for header sizing and linked Markdown.
Runs only in an isolated browser with a stub desktop bridge; no real documents.
"""
from pathlib import Path
import importlib.util,json,argparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('complete_smoke',ROOT/'tests/complete-ui-smoke.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default='/usr/bin/chromium');parser.add_argument('--output',type=Path,default=ROOT/'tests/artifacts/linked');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)

def seed(page,cells):
 page.evaluate('''cells=>{const s=markpadApp.sheet();s.applyCells(Object.entries(cells).map(([address,after])=>({sheetId:s.activeSheetId,address,after})));}''',cells)
def header(page,axis,index,**kwargs):
 key='col' if axis=='column' else 'row';page.locator(f'.sheet-{key}[data-{key}="{index}"]').click(**kwargs)
def edge(page,axis,index,side):
 return page.locator(f'.sheet-resize-handle.{axis}.{side}[data-index="{index}"]')
def double_edge(page,axis,index,side):
 r=edge(page,axis,index,side).bounding_box();page.mouse.dblclick(r['x']+r['width']/2,r['y']+r['height']/2,delay=80)
def drag_edge(page,axis,index,side,delta):
 r=edge(page,axis,index,side).bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+(delta if axis=='column' else 0),y+(delta if axis=='row' else 0),steps=5);page.mouse.up()
def dims(page,key):return page.evaluate(f'markpadApp.sheet().sheet.{key}||{{}}')
def select_rich_link(page,n=0):
 page.evaluate('''n=>{const e=markpadApp.editor();const a=e.linkedOccurrences()[n];e.selectRange(a.from,a.to);}''',n)

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,args=['--no-sandbox'])
 page,errors=f.load(browser,'A document.\n\n');page.locator('#sheet-tab').click()
 seed(page,{'A1':'short','B1':'excluded','C1':'A much longer visible value','A2':'one\ntwo\nthree','C2':'70','A100':'Offscreen longest contents in the selected columns'})
 # Give tests room to click header centers without horizontal scrolling.
 page.evaluate("document.documentElement.style.setProperty('--sidebar-width','650px');markpadApp.sheet().refresh()")
 header(page,'column',0);header(page,'column',2,modifiers=['Control'])
 f.check(page.evaluate("[...document.querySelectorAll('.sheet-col.selected')].map(n=>Number(n.dataset.col))")==[0,2],'Ctrl-click selects non-adjacent columns only')
 f.check(page.locator('.sheet-cell.selected[data-row="3"][data-col="2"]').count()==1,'Column selection includes empty displayed rows')
 header(page,'column',0,modifiers=['Control'])
 f.check(page.evaluate("markpadApp.sheet().axisSelection.spans")==[[2,2]],'Ctrl-click toggles a selected header off')
 header(page,'column',0);header(page,'column',3,modifiers=['Shift'])
 f.check(page.evaluate("markpadApp.sheet().axisSelection.spans")==[[0,3]],'Shift-click selects inclusive column interval')
 header(page,'row',0);header(page,'row',2,modifiers=['Control'])
 f.check(page.evaluate("markpadApp.sheet().axisSelection.spans")==[[0,0],[2,2]],'Ctrl-click selects non-adjacent rows')
 header(page,'row',4,modifiers=['Shift'])
 f.check(page.evaluate("markpadApp.sheet().axisSelection.spans")==[[2,4]],'Shift-click rows extends from latest plain/Ctrl anchor')
 header(page,'column',0);header(page,'column',2,modifiers=['Control']);double_edge(page,'column',0,'end')
 widths=dims(page,'columnWidths');f.check(widths['0']==widths['2'] and widths['0']>200 and '1' not in widths,'Selected columns auto-fit to one widest width, including offscreen content',widths)
 # Reset geometry for side ownership checks (do not invoke any code under test).
 page.evaluate("const s=markpadApp.sheet();s.sheet.columnWidths={0:108,1:108};s.axisSelection=null;s.refresh()")
 double_edge(page,'column',1,'start');widths=dims(page,'columnWidths');f.check(widths['0']==108 and widths['1']!=108,'Right side of A/B seam fits B, not A',widths)
 page.wait_for_timeout(550);double_edge(page,'column',0,'end');widths=dims(page,'columnWidths');f.check(widths['0']>200,'Left side of A/B seam fits A',{'widths':widths,'debug':page.evaluate('({click:markpadApp.sheet().lastResizeClick,drag:markpadApp.sheet().resizeDrag,selected:markpadApp.sheet().axisSelection,scroll:markpadApp.sheet().grid.scrollLeft})')})
 header(page,'row',0);header(page,'row',1,modifiers=['Control']);double_edge(page,'row',1,'end')
 heights=dims(page,'rowHeights');f.check(heights['0']==heights['1'] and heights['0']>=60,'Selected rows auto-fit to common tallest multiline content',heights)
 page.wait_for_timeout(550);drag_edge(page,'column',0,'start',25)
 f.check(page.evaluate('markpadApp.sheet().sheet.defaultColumnWidth')>100,'Left-of-A drag sets sheet-wide default width')
 f.check(page.evaluate('Object.keys(markpadApp.sheet().sheet.columnWidths||{}).length')==0,'All-column resize stays sparse')
 page.wait_for_timeout(550);drag_edge(page,'row',0,'start',15)
 f.check(page.evaluate('markpadApp.sheet().rowGeometry.size(500000)')==page.evaluate('markpadApp.sheet().rowGeometry.size(0)'),'Above-row-1 drag resizes distant and future rows')
 saved=page.evaluate('markpadInspect.source()');defaults=page.evaluate('({w:markpadApp.sheet().sheet.defaultColumnWidth,h:markpadApp.sheet().sheet.defaultRowHeight})');page.close()
 page,errors=f.load(browser,saved)
 f.check(page.evaluate('({w:markpadApp.sheet().sheet.defaultColumnWidth,h:markpadApp.sheet().sheet.defaultRowHeight})')==defaults,'Sheet-wide dimensions survive save/reopen')
 page.close()
 # Single cell, two occurrences, formula dependency and ordinary text.
 page,errors=f.load(browser,'Before: ');page.locator('#sheet-tab').click();seed(page,{'A1':'25','B1':'=A1*2'})
 page.evaluate('markpadApp.editor().selectRange(9,9);markpadApp.sheet().select({row:0,col:0})')
 page.locator('#sheet-insert').click()
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').inner_text()=='25','Insert-cell button creates a real linked document value')
 f.check(page.evaluate('markpadApp.editor().editor.view.hasFocus()'),'Inserting returns keyboard focus to document')
 seed(page,{'A1':'31'})
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').inner_text()=='31','Spreadsheet edit updates document label')
 select_rich_link(page);page.keyboard.type('99')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='99','Whole linked-label replacement updates original spreadsheet cell')
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').inner_text()=='99','Whole replacement retains the live link')
 page.keyboard.press('Control+z')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='31' and page.locator('.tiptap a[href^="#markpad-cell-"]').inner_text()=='31','Undo of a document edit restores the linked source cell without undoing insertion')
 # Ensure a new value restores a simple baseline regardless of grouping.
 seed(page,{'A1':'15'});page.evaluate("const e=markpadApp.editor();e.selectRange(e.editor.state.doc.content.size-1,e.editor.state.doc.content.size-1);e.insertText(' / ')");page.locator('#sheet-insert').click()
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').count()==2,'Multiple occurrences can link to the same cell')
 select_rich_link(page,0);page.keyboard.type('42')
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').all_inner_texts()==['42','42'],'Editing one occurrence updates the other occurrence',page.evaluate("({values:[...document.querySelectorAll('.tiptap a')].map(a=>a.textContent),links:markpadApp.sheet().workbook.linkedCells,cells:markpadApp.sheet().sheet.cells,doc:markpadApp.editor().editor.getJSON(),selection:markpadApp.editor().editor.state.selection.toJSON()})"))
 page.locator('#mode-toggle').click()
 f.check(page.evaluate('markpadInspect.state().mode')=='raw','Linked document can switch to Raw')
 raw=page.locator('#raw-editor');page.evaluate("const r=document.querySelector('#raw-editor');const at=r.value.indexOf('[42]');r.focus();r.setSelectionRange(at+1,at+3)");page.keyboard.type('73')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='73','Editing raw Markdown link label updates spreadsheet')
 f.check(page.evaluate("markpadInspect.source().split('[73]').length-1")==2,'Raw-mode editing updates peer link labels')
 page.locator('#mode-toggle').click();f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').all_inner_texts()==['73','73'],'Bindings survive Raw/Formatted switching')
 saved=page.evaluate('markpadInspect.source()');f.check('markpad:workbook:v2:data ' in saved,'Linked file writes versioned metadata')
 page.close();page,errors=f.load(browser,saved)
 f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').all_inner_texts()==['73','73'],'Bindings restore on fresh document load')
 select_rich_link(page,0);page.keyboard.type('81')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='81','A first edit immediately after reopening updates the linked source')
 page.keyboard.press('Control+z')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='73','Undo immediately after reopening restores both linked sides',page.evaluate("({cells:markpadApp.sheet().sheet.cells,doc:markpadApp.editor().editor.getJSON(),links:markpadApp.sheet().workbook.linkedCells,selection:markpadApp.editor().editor.state.selection.toJSON()})"))
 seed(page,{'A1':'18'});f.check(page.locator('.tiptap a[href^="#markpad-cell-"]').all_inner_texts()==['18','18'],'Restored bindings remain live')
 # Linked table, same button and shortcut path.
 seed(page,{'A1':'10','B1':'=A1*2','A2':'30','B2':'40'})
 page.evaluate("const e=markpadApp.editor();e.selectRange(e.editor.state.doc.content.size-1,e.editor.state.doc.content.size-1);e.insertText('\\n');const s=markpadApp.sheet();s.select({row:0,col:0});s.select({row:1,col:1},true)")
 page.locator('#sheet-insert').click()
 f.check(page.locator('.tiptap table').count()==1,'Multiple cells insert a Markdown table')
 f.check(page.locator('.tiptap table a').count()==4,'Each table value keeps its own live cell binding')
 seed(page,{'A1':'12'});f.check(page.locator('.tiptap table a').all_inner_texts()==['12','24','30','40'],'Linked table updates literals and dependent formulas')
 # Replace table input value, not the formula, and check recalculation.
 select_rich_link(page,2);page.keyboard.type('7')
 f.check(page.evaluate('markpadApp.sheet().sheet.cells.A1')=='7','Editing a linked table cell updates worksheet input')
 f.check(page.locator('.tiptap table a').all_inner_texts()==['7','14','30','40'],'Document table edit recalculates linked dependent formula')
 # Row insertion adjusts stable binding coordinates.
 page.evaluate('markpadApp.sheet().focus()');header(page,'row',0,button='right');page.get_by_role('menuitem',name='Insert row above',exact=True).click()
 f.check(page.evaluate('Object.values(markpadApp.sheet().workbook.linkedCells).every(x=>x.address.endsWith("2")||x.address.endsWith("3"))'),'Document links follow cells after row insertion')
 f.check(page.locator('.tiptap table a').all_inner_texts()==['7','14','30','40'],'Row insertion preserves linked values')
 header(page,'row',1,button='right');page.get_by_role('menuitem',name='Delete row',exact=True).click()
 f.check(page.locator('.tiptap table a').all_inner_texts()[:2]==['#REF!','#REF!'],'Deleting linked source row displays REF rather than wrong neighbour')
 page.keyboard.press('Control+z');f.check(page.locator('.tiptap table a').all_inner_texts()==['7','14','30','40'],'Undo restores deleted linked targets')
 saved=page.evaluate('markpadInspect.source()');(args.output/'linked-example.md').write_text(saved)
 f.check(not errors,'Linked editor and sizing interactions have no renderer errors',errors)
 page.screenshot(path=str(args.output/'linked-table.png'));page.close();page,errors=f.load(browser,saved)
 f.check(page.locator('.tiptap table a').all_inner_texts()==['7','14','30','40'],'Linked table save/reopen retains bindings and displayed values')
 f.check(not errors,'Reopened linked table has no renderer errors',errors)
 page.close();browser.close()
(args.output/'results.json').write_text(json.dumps(f.RESULTS,indent=2));print(json.dumps(f.RESULTS,indent=2))
