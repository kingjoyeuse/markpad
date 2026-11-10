"""Focused safety/interaction checks of the complete update. Requires Python Playwright.
Run: python tests/complete-edge-smoke.py --chromium PATH --output DIRECTORY
"""
import importlib.util,argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('complete-ui-smoke.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
parser=argparse.ArgumentParser();parser.add_argument('--chromium');parser.add_argument('--output',type=Path,default=f.ROOT/'tests/artifacts/edges');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,args=['--no-sandbox'])
 page,errors=f.load(browser,'Hello');page.locator('.tiptap').focus();page.keyboard.press('Control+a');page.keyboard.press('Control+b');f.check('**Hello**' in page.evaluate('markpadInspect.source()'),'Ctrl+B still formats document')
 page.keyboard.press('Control+i');f.check(page.locator('.tiptap strong em,.tiptap em strong').count()==1,'Ctrl+I works with bold')
 page.close()
 source='```c\nint main(void) {\n  return 0;\n}\n```\n'
 page,errors=f.load(browser,source)
 f.check(page.locator('.tiptap pre code').count()==1,'Fenced C block is editable and rendered')
 page.locator('.tiptap pre code').click();page.keyboard.press('Home');page.keyboard.press('Tab')
 f.check(page.evaluate("document.activeElement.closest('.tiptap')!==null"),'Tab inside code stays in editor')
 f.check('\t' in page.evaluate('markpadInspect.source()'),'Tab indents code')
 page.keyboard.press('Shift+Tab');f.check(not errors,'Code indentation has no errors',errors);page.close()
 # A fast-text file may promote while another pane has keyboard focus. Never steal it.
 source=('25\n\n'+('**Paragraph:** editable content.\n\n'*4500)).replace('\n','\r\n')
 page,errors=f.load(browser,source);page.locator('#raw-editor').focus();page.evaluate("document.querySelector('#raw-editor').setSelectionRange(0,2)");page.keyboard.press('Alt+Shift+ArrowRight')
 page.wait_for_function('!markpadInspect.state().formatPending',timeout=20000)
 f.check(page.evaluate("document.activeElement.id==='calc-expression'"),'Formatting completion preserves calculator focus')
 f.check(page.evaluate('markpadInspect.source()')==source,'No-edit staged load preserves exact original CRLF Markdown')
 page.wait_for_timeout(200);f.check('→' not in page.locator('#file-size').inner_text(),'No-edit staged load does not invent a changed file size');page.close()
 page,errors=f.load(browser,source);page.locator('#raw-editor').focus();page.keyboard.press('Control+Tab');page.wait_for_timeout(1400)
 f.check(page.evaluate('markpadInspect.state().mode==="raw"&&!markpadInspect.state().formatPending'),'Manual mode toggle cancels deferred formatting')
 f.check(page.evaluate('markpadInspect.source()')==source,'Canceling formatting preserves complete source');page.close()
 # Persisted dimensions and formulas must survive a fresh document load.
 page,errors=f.load(browser,'12');page.locator('.tiptap').focus();page.keyboard.press('Control+a');page.keyboard.press('Alt+Control+ArrowRight');page.keyboard.press('ArrowRight');page.keyboard.press('=');page.keyboard.press('ArrowLeft');page.keyboard.press('F4');page.keyboard.press('Enter')
 f.check(page.evaluate('markpadInspect.state().sheets[0].cells.B1')=='=$A$1','Locked formula stored correctly')
 f.check(page.locator('.sheet-cell[data-row="0"][data-col="1"]').inner_text()=='12','Locked formula evaluates correctly')
 page.locator('.sheet-col[data-col="0"]').click(button='right');page.get_by_role('menuitem',name='Delete column',exact=True).click()
 f.check(page.evaluate('markpadInspect.state().sheets[0].cells.A1')=='=#REF!','Deleting referenced column marks dependent formula invalid')
 page.keyboard.press('Control+z');f.check(page.evaluate('markpadInspect.state().sheets[0].cells.B1')=='=$A$1','Undo restores deleted column and locked formula')
 saved=page.evaluate('markpadInspect.source()');page.close();page,errors=f.load(browser,saved)
 f.check(page.locator('#sheet-tab').get_attribute('aria-expanded')=='true','Saved worksheet automatically opens on reload')
 f.check(page.locator('.sheet-cell[data-row="0"][data-col="1"]').inner_text()=='12','Formula evaluates after save/reopen')
 f.check(not errors,'Reopened worksheet has no renderer exceptions',errors);page.close();browser.close()
(args.output/'results.json').write_text(json.dumps(f.RESULTS,indent=2));print(json.dumps(f.RESULTS,indent=2))
