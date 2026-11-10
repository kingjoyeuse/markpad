"""Focused user-facing table keyboard, ghost persistence and overlap checks."""
from pathlib import Path
import importlib.util,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('f',ROOT/'tests/complete-ui-smoke.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
out=ROOT/'tests/artifacts/tables';out.mkdir(parents=True,exist_ok=True)

def cell(page,row,col,end=False):
 page.evaluate('''({row,col,end})=>{const e=markpadApp.editor();let table=null,p=0;e.editor.state.doc.descendants((n,pos)=>{if(!table&&n.type.name==='table'){table=n;p=pos;return false}});let at=p+2;for(let r=0;r<row;r++)at+=table.child(r).nodeSize;for(let c=0;c<col;c++)at+=table.child(row).child(c).nodeSize;at+=end?table.child(row).child(col).nodeSize-2:2;e.selectRange(at,at)}''',{'row':row,'col':col,'end':end})
 page.wait_for_timeout(70)
def shape(page):return page.evaluate("(()=>{const t=document.querySelector('.tiptap table');return t?[t.rows.length,t.rows[0].cells.length]:null})()")
def clear_cell(page,row,col):
 cell(page,row,col);page.keyboard.press('Home');page.keyboard.press('Shift+End');page.wait_for_timeout(60);page.keyboard.press('Backspace');page.wait_for_timeout(70)
def ghost_axis(page):return page.evaluate('document.activeElement.dataset.ghostAxis')

with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page,errors=f.load(b,'');page.locator('[data-format="table"]').click();page.wait_for_timeout(100)
 f.check(shape(page)==[2,1],'Table button creates one header and one body cell')
 f.check(page.evaluate("markpadApp.editor().editor.state.selection.$head.parentOffset") == 0,'Caret starts in the blank header')
 f.check(page.locator('.markpad-table-ghost:visible').count()==4,'One extra ghost row and column appear while caret is in table')
 initial=page.evaluate('markpadInspect.source()')
 f.check('ghost' not in initial and initial.count('|')==6,'Starter Markdown contains only real cells',initial)
 page.keyboard.type('Heading');page.keyboard.press('ArrowRight');page.wait_for_timeout(70)
 f.check(ghost_axis(page)=='column','Right at final header moves into ghost column')
 before=page.evaluate('markpadInspect.source()');page.keyboard.press('ArrowRight');page.wait_for_timeout(70)
 f.check(page.evaluate('markpadApp.editor().editor.view.hasFocus()') and shape(page)==[2,1],'Second Right wraps to next real row without extending table')
 f.check(page.evaluate('markpadInspect.source()')==before,'Navigating ghost columns does not alter Markdown')
 page.keyboard.type('Body');page.keyboard.press('ArrowDown');page.wait_for_timeout(70)
 f.check(ghost_axis(page)=='row','Down from final real row enters ghost row')
 saved=page.evaluate('markpadInspect.source()');page.keyboard.press('ArrowDown');page.wait_for_timeout(70)
 f.check(page.evaluate('markpadApp.editor().editor.state.selection.$head.parent.type.name')=='paragraph','Second Down leaves table into a paragraph')
 f.check(page.locator('.markpad-table-ghost:visible').count()==0,'All ghosts hide once caret leaves table')
 f.check(shape(page)==[2,1],'Exiting empty ghost row does not create a real row')
 cell(page,0,0,True);page.keyboard.press('ArrowRight');page.keyboard.type('New column');page.wait_for_timeout(100)
 f.check(shape(page)==[2,2],'Typing in ghost column creates a complete real column')
 f.check(page.locator('.tiptap th').all_inner_texts()==['Heading','New column'],'New column preserves header semantics and typed content')
 cell(page,1,1);page.keyboard.type('Other');page.keyboard.press('ArrowDown');page.keyboard.type('New row');page.wait_for_timeout(100)
 f.check(shape(page)==[3,2],'Typing in ghost row creates a full real row')
 f.check([x.strip() for x in page.locator('.tiptap tr').nth(2).locator('td').all_inner_texts()]==['','New row'],'New ghost row becomes body cells, not headers',page.locator('.tiptap table').inner_html())
 source=page.evaluate('markpadInspect.source()');f.check('New row' in source and 'markpad-table-ghost' not in source,'Ghost expansion saves only entered real rows and columns')
 # Distinguish removal from a fresh blank starter.
 clear_cell(page,2,1);f.check(shape(page)==[2,2],'Clearing every value in a row contracts that row')
 clear_cell(page,0,1);clear_cell(page,1,1);f.check(shape(page)==[2,1],'Clearing every value in a column contracts that column',page.evaluate('({doc:markpadApp.editor().editor.getJSON(),source:markpadInspect.source(),selection:markpadApp.editor().editor.state.selection.toJSON()})'))
 page.keyboard.press('Control+z');page.wait_for_timeout(100)
 f.check(shape(page)==[2,2],'Undo restores a cleared-and-contracted column')
 # Link/sheet focus hides ghosts without writing them.
 page.locator('#sheet-tab').click();page.wait_for_timeout(100)
 f.check(page.locator('.markpad-table-ghost:visible').count()==0,'Clicking a sidebar tab hides table ghosts')
 page.locator('#sheet-tab').click();page.close()
 # Content overlap: top-only table must not narrow for lower spreadsheet.
 page,errors=f.load(b,'| Header | Other |\n| --- | --- |\n| Value | More |\n\nOutside.\n')
 page.locator('.tiptap > p').last.click();page.wait_for_timeout(100)
 table=page.locator('.tiptap table');base=table.bounding_box()['width']
 page.locator('#sheet-tab').click();page.wait_for_timeout(120)
 f.check(abs(table.bounding_box()['width']-base)<2,'Nonoverlapping lower spreadsheet does not squash a table near top')
 page.locator('#calc-tab').click();page.wait_for_timeout(120)
 rect=table.bounding_box();panel=page.locator('#calculator').bounding_box()
 f.check(rect['x']+rect['width']<=panel['x']-8,'Overlapping calculator narrows table to remaining left area',{'table':rect,'panel':panel})
 f.check(rect['width']<base-100,'Overlap results in actual width reduction')
 page.locator('#calc-tab').click();page.wait_for_timeout(120)
 f.check(abs(table.bounding_box()['width']-base)<2,'Table returns to normal width after overlapping panel closes')
 page.locator('#sheet-tab').click();cell(page,0,0)
 page.locator('#calc-tab').click();cell(page,0,0);page.wait_for_timeout(120)
 ghosts=page.locator('.markpad-table-ghosts').bounding_box();panel=page.locator('#calculator').bounding_box()
 f.check(ghosts['x']+ghosts['width']<=panel['x']-8,'Ghost expansion space also stays clear of overlapping panel')
 f.check(not errors,'Table navigation and layout have no renderer exceptions',errors)
 page.screenshot(path=str(out/'table-overlap.png'));page.close()
 page,errors=f.load(b,source);f.check(shape(page)==[3,2],'Expanded real table round-trips through Markdown');page.close()
 # The final actual row wraps through its ghost column into the ghost row.
 page,errors=f.load(b,'| H |\n| --- |\n| value |\n');cell(page,1,0,True)
 page.keyboard.press('ArrowRight');page.keyboard.press('ArrowRight');page.wait_for_timeout(80)
 f.check(ghost_axis(page)=='row','Right out of last ghost column wraps to first ghost-row cell')
 page.keyboard.type('third');page.wait_for_timeout(80);f.check(shape(page)==[3,1],'Keyboard-only ghost row can be materialized')
 f.check(not errors,'Ghost wrap has no renderer exceptions',errors);page.close();b.close()
(out/'results.json').write_text(json.dumps(f.RESULTS,indent=2));print(json.dumps(f.RESULTS,indent=2))
