"""Offline real Chromium UI tests of current generated assets, with an isolated native-bridge stub.
No real files, drafts, registry or Windows profiles are changed. Worker uses identical shipped
code via a Blob only because this test environment blocks browser file/network navigations.
"""
from pathlib import Path
import re,json,time,argparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
RESULTS=[]
CHROMIUM=None
FIXTURE=None
OUTPUT=ROOT/'tests/artifacts/complete'
def check(condition,label,detail=None):
 assert condition,(label,detail)
 RESULTS.append({'test':label,'pass':True,'detail':detail})
def load(browser,text='25',baseline=False):
 page=browser.new_page(viewport={'width':1106,'height':783});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 html=(ROOT/'app/index.html').read_text();html=re.sub(r'<meta[^>]+http-equiv=[^>]+>','',html,flags=re.I);html=re.sub(r'<script\b[^>]*>[\s\S]*?</script>|<link\b[^>]*>','',html,flags=re.I)
 page.set_content(html);page.add_style_tag(content=(ROOT/'app/main.css').read_text())
 session={'id':'test','name':'test.md','path':'test.md','markdown':text,'savedBytes':len(text.encode()),'dirty':False,'theme':'dark'}
 page.evaluate('''session=>{window.markpad={bootstrap:async()=>session,setTitle:async()=>{},checkpoint:async()=>({}),setTheme:async()=>{},onTheme:()=>{},onCommand:()=>{},setWordWrap:async()=>{},setZoom:async()=>{},save:async()=>({saved:true,name:'test.md',path:'test.md'})};}''',session)
 worker=(ROOT/'app/editor-runtime.js').read_text()+'\n'+(ROOT/'app/format-worker.js').read_text().replace("importScripts('editor-runtime.js');",'')
 page.evaluate('''code=>{const BaseWorker=window.Worker;window.Worker=class extends BaseWorker{constructor(url,options){if(url==='format-worker.js')url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));super(url,options);}};}''',worker)
 page.add_script_tag(content=(ROOT/'app/patch.js').read_text())
 extra=re.sub(r'^import .*?;\s*','',(ROOT/'app/runtime-enhancements.js').read_text(),flags=re.M)
 helpers='\n'.join((ROOT/'app/ui'/f).read_text().replace('export ','') for f in ['source-position.js','recent-time.js','code-lexer.js'])
 page.add_script_tag(content='(()=>{'+helpers+'\n'+extra+'})()')
 page.evaluate('window.fixtureStart=performance.now()')
 page.add_script_tag(content=(Path('/mnt/data/markpad-baseline-main.js') if baseline else ROOT/'app/main.js').read_text())
 page.wait_for_function('!!window.markpadInspect',timeout=15000)
 check(not errors,'Renderer boot has no exceptions',errors)
 return page,errors

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROMIUM,args=['--no-sandbox'])
  page,errors=load(browser)
  rich=page.locator('.tiptap');rich.focus();page.keyboard.press('Control+a');page.keyboard.press('Alt+Control+ArrowRight')
  check(page.evaluate("document.activeElement.classList.contains('sheet-grid')"),'Transfer to spreadsheet focuses grid')
  page.keyboard.press('ArrowDown');check(page.locator('.sheet-address').inner_text()=='A2','Down after transfer moves active worksheet cell')
  rich.focus();page.keyboard.press('Control+a');page.keyboard.press('Alt+Shift+ArrowRight')
  check(page.evaluate("document.activeElement.id==='calc-expression'"),'Transfer to calculator focuses calculation input')
  page.keyboard.type('+5');page.keyboard.press('Enter');check(page.locator('#calc-result').inner_text()=='30','Transferred calculator value continues with keyboard calculation')
  grid=page.locator('.sheet-grid');grid.focus();page.keyboard.press('Control+Home');page.keyboard.press('ArrowRight');page.keyboard.press('ArrowRight');page.keyboard.press('=');page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowLeft')
  check(page.locator('.sheet-edit').input_value()=='=A1','C1 = Left Left builds =A1')
  check(page.locator('.sheet-cell.referenced[data-row="0"][data-col="0"]').count()==1,'Referenced A1 highlighted independently of formula origin')
  for expected in ['=$A$1','=A$1','=$A1','=A1']:
   page.keyboard.press('F4');check(page.locator('.sheet-edit').input_value()==expected,'F4 '+expected)
  page.keyboard.press('Enter');check(page.evaluate('markpadInspect.state().sheets[0].cells.C1')=='=A1','Formula commits to original C1')
  check(page.locator('.sheet-address').inner_text()=='C2','Enter after pointing moves below the formula origin')
  check(page.locator('.sheet-cell[data-row="0"][data-col="2"]').inner_text()=='25','Formula evaluates to transferred value')
  page.locator('.sheet-row[data-row="0"]').click(button='right');page.get_by_role('menuitem',name='Insert row above',exact=True).click()
  check(page.evaluate('markpadInspect.state().sheets[0].cells.C2')=='=A2','Insert row moves cells and updates formula')
  page.keyboard.press('Control+z');check(page.evaluate('markpadInspect.state().sheets[0].cells.C1')=='=A1','Row insertion is undoable')
  page.locator('.sheet-col[data-col="0"]').click(button='right');page.get_by_role('menuitem',name='Insert column left',exact=True).click()
  check(page.evaluate('markpadInspect.state().sheets[0].cells.D1')=='=B1','Insert column moves data and formula')
  page.locator('.sheet-col[data-col="0"]').click(button='right');page.get_by_role('menuitem',name='Delete column',exact=True).click()
  check(page.evaluate('markpadInspect.state().sheets[0].cells.C1')=='=A1','Delete inserted column restores addresses')
  handle=page.locator('.sheet-col[data-col="0"] .sheet-resize-handle.end');r=handle.bounding_box();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.down();page.mouse.move(r['x']+r['width']/2+55,r['y']+r['height']/2,steps=4);page.mouse.up()
  check(page.evaluate('markpadInspect.state().sheets[0].columnWidths[0]')==163,'Column drag resize persists width')
  handle=page.locator('.sheet-row[data-row="0"] .sheet-resize-handle.end');r=handle.bounding_box();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.down();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2+20,steps=4);page.mouse.up()
  check(page.evaluate('markpadInspect.state().sheets[0].rowHeights[0]')==47,'Row drag resize persists height')
  check(page.locator('.sheet-cell[data-row="0"][data-col="0"]').bounding_box()['height']==47,'Rendered cell follows resized height')
  page.wait_for_timeout(220);check('→' in page.locator('#file-size').inner_text(),'Status shows saved and pending sizes after spreadsheet changes')
  check('columnWidths' in page.evaluate('decodeURIComponent(markpadInspect.source())'),'Dimensions included in saved Markdown metadata')
  for first,second in [('calc-tab','sheet-tab'),('sheet-tab','calc-tab')]:
   for tab in ['calc-tab','sheet-tab']:
    if page.locator('#'+tab).get_attribute('aria-expanded')=='true':page.locator('#'+tab).click()
   before=page.locator('#'+second).bounding_box()['x'];page.locator('#'+first).click();after=page.locator('#'+second).bounding_box()['x'];check(abs(before-after)<1,'Independent tabs retained: '+first)
  check(not errors,'Spreadsheet interactions have no renderer exceptions',errors)
  grid.focus();page.keyboard.press('Control+Home');page.keyboard.press('ArrowDown')
  page.keyboard.type('42');page.keyboard.press('ArrowRight')
  check(page.locator('.sheet-address').inner_text()=='B2' and page.evaluate('markpadInspect.state().sheets[0].cells.A2')=='42','Arrow commits a typed value and moves right')
  formula=page.locator('.sheet-formula');formula.fill('literal');page.keyboard.press('ArrowDown')
  check(page.locator('.sheet-address').inner_text()=='B3' and page.evaluate('markpadInspect.state().sheets[0].cells.B2')=='literal','Arrow commits a formula-bar value and moves down')
  formula.fill('=');page.keyboard.press('ArrowUp');page.keyboard.press('ArrowLeft')
  check(formula.input_value()=='=A2' and page.locator('.sheet-cell.referenced[data-row="1"][data-col="0"]').count()==1,'Formula bar arrows insert and highlight the reference')
  page.keyboard.press('Tab')
  check(page.locator('.sheet-address').inner_text()=='B3' and page.evaluate('markpadInspect.state().sheets[0].cells.B3')=='=A2','Tab commits and returns to the formula origin')
  page.screenshot(path=str(OUTPUT/'spreadsheet.png'));page.close()
  atlas=FIXTURE.read_text(encoding='utf8') if FIXTURE else ('# Large-file fixture\n\n'+('**Paragraph:** sample editable text and words.\n\n'*8000))
  page,errors=load(browser,atlas)
  timing=page.evaluate('({ready:markpadLoadTiming.editableMs-fixtureStart,pending:markpadInspect.state().formatPending})')
  check(timing['pending'],'Large document initially editable before formatting completes',timing)
  raw=page.locator('#raw-editor');raw.focus();page.keyboard.press('Control+Home');page.keyboard.type('EDITED DURING LOAD\n')
  check(page.evaluate("markpadInspect.source().startsWith('EDITED DURING LOAD\\n')"),'Typing accepted during worker formatting')
  page.wait_for_function('markpadInspect.state().mode==="formatted"&&!markpadInspect.state().formatPending',timeout=30000)
  check(page.evaluate("markpadInspect.source().startsWith('EDITED DURING LOAD\\n')"),'Edits survive automatic formatting promotion')
  check(page.evaluate('markpadInspect.source().endsWith('+json.dumps(atlas[-100:])+')'),'Document tail preserved after formatting')
  check(not errors,'Large-file load has no renderer exceptions',errors)
  RESULTS.append({'test':'Atlas staged-load timings','pass':True,'detail':page.evaluate('({...markpadLoadTiming,fixtureStart})')})
  page.screenshot(path=str(OUTPUT/'large-file.png'));page.close();browser.close()
 (OUTPUT/'results.json').write_text(json.dumps(RESULTS,indent=2));print(json.dumps(RESULTS,indent=2))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--chromium');parser.add_argument('--fixture',type=Path);parser.add_argument('--output',type=Path,default=OUTPUT)
 args=parser.parse_args();CHROMIUM=args.chromium;FIXTURE=args.fixture;OUTPUT=args.output;OUTPUT.mkdir(parents=True,exist_ok=True);run()
