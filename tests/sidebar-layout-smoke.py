"""Run: python tests/sidebar-layout-smoke.py [--chromium PATH] [--screenshots DIR]
Offline, isolated test of the deployed renderer. Never accesses user drafts.
"""
import argparse,json,pathlib,re
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--chromium');ap.add_argument('--screenshots');args=ap.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];errors=[];results=[]
def load(page,directory,theme,markdown):
    page.evaluate('''session=>{window.markpad={bootstrap:async()=>session,setTitle:async()=>{},
      checkpoint:async()=>({}),setTheme:async()=>{},onTheme:()=>{},onCommand:()=>{},
      setWordWrap:async()=>{},setZoom:async()=>{}};}''',
      {'id':'sidebar-test','name':'Untitled','markdown':markdown,'dirty':False,'theme':theme})
    html=(directory/'index.html').read_text()
    # Omit CSP only in this in-memory fixture so Playwright can inject the local
    # scripts offline. Production CSP and application files are not modified.
    html=re.sub(r'<meta[^>]+http-equiv=[^>]+>','',html,flags=re.I)
    html=re.sub(r'<script\b[^>]*>[\s\S]*?</script>|<link\b[^>]*>','',html,flags=re.I)
    page.set_content(html);page.add_style_tag(content=(directory/'main.css').read_text())
    page.add_style_tag(content='#workspace:not([data-panels="none"]) #ribbon {right:350px !important;}')
    common=directory if (directory/'main.js').exists() else root/'app'
    page.add_script_tag(content=(common/'patch.js').read_text())
    extra=re.sub(r'^import .*?;\s*','',(common/'runtime-enhancements.js').read_text(),flags=re.M)
    helpers='\n'.join((common/'ui'/f).read_text().replace('export ','') for f in ['source-position.js','recent-time.js','code-lexer.js'])
    page.add_script_tag(content='(()=>{'+helpers+'\n'+extra+'})()')
    page.add_script_tag(content=(common/'main.js').read_text())
    page.wait_for_function('Boolean(window.markpadInspect)');page.wait_for_timeout(70)
def geometry(page):
    return page.evaluate('''()=>{const rect=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();
      return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,expanded:e.getAttribute('aria-expanded'),parent:e.parentElement.id};};
      return{workspace:rect('workspace'),calc:rect('calc-tab'),sheet:rect('sheet-tab'),sidebar:rect('sidebar'),
        state:markpadInspect.state(),scrollbar:parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--editor-scrollbar-width'))||0};}''')
def verify(page,label):
    g=geometry(page);w=g['workspace'];edge=w['right']-g['scrollbar']
    for name,key in [('calc','calcShown'),('sheet','sheetShown')]:
        tab=g[name];opened=g['state'][key];expected=g['sidebar']['left']-4 if opened else edge
        assert tab['parent']=='workspace',(label,name,'shared parent',g)
        assert abs(tab['right']-expected)<1.1,(label,name,'horizontal position',g)
        assert tab['expanded']==str(opened).lower(),(label,name,'ARIA state',g)
    assert abs(g['calc']['top']-w['top'])<1.1,(label,'calculator top',g)
    assert abs(g['sheet']['bottom']-w['bottom'])<1.1,(label,'spreadsheet bottom',g)
    results.append({'case':label,'calcOpen':g['state']['calcShown'],'sheetOpen':g['state']['sheetShown'],
                    'calcRight':g['calc']['right'],'sheetRight':g['sheet']['right']})
    return g
with sync_playwright() as p:
    opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if args.chromium:opts['executable_path']=args.chromium
    browser=p.chromium.launch(**opts)
    for location in ['app','bin/resources/app/app','resources/app/app']:
        for theme,width,height,text in [('light',1200,900,''),('dark',1200,900,'# Heading\n\n'+'Text line.\n\n'*120),
                                         ('dark',720,540,'Small window.'),('light',950,700,'Scrolling\n\n'*100)]:
            label=f'{location}:{theme}:{width}x{height}'
            page=browser.new_page(viewport={'width':width,'height':height})
            page.on('pageerror',lambda err:errors.append(str(err)))
            load(page,root/location,theme,text);verify(page,label+':startup')
            for step,target in enumerate(['sheet-tab','calc-tab','sheet-tab','calc-tab','calc-tab','sheet-tab','calc-tab','sheet-tab']):
                before=geometry(page);page.locator('#'+target).click();page.wait_for_timeout(35)
                after=verify(page,f'{label}:toggle{step+1}');other='calc' if target=='sheet-tab' else 'sheet'
                assert abs(before[other]['right']-after[other]['right'])<1.1,(label,'other tab moved',before,after)
                if args.screenshots and location=='bin/resources/app/app' and width==1200 and theme=='dark' and step<4:
                    dest=pathlib.Path(args.screenshots);dest.mkdir(parents=True,exist_ok=True)
                    page.screenshot(path=str(dest/f'sidebar-state-{step+1}.png'))
            page.locator('#calc-tab').click();page.locator('#sheet-tab').click()
            page.evaluate("document.documentElement.style.setProperty('--sidebar-width','460px')")
            verify(page,label+':wider-cards');page.set_viewport_size({'width':width-80,'height':height-50})
            page.wait_for_timeout(70);verify(page,label+':resize-window');page.locator('#sheet-tab').click()
            page.keyboard.press('Control+Tab');page.wait_for_timeout(70);verify(page,label+':raw-mode')
            page.locator('#calc-tab').click();verify(page,label+':raw-closed');page.close()
    browser.close()
assert not errors,errors
print(json.dumps({'passed':len(results),'rendererErrors':errors,'cases':results},indent=2))
