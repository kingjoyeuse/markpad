/* Portable-runtime UI corrections. Runs against the already bundled editor
 * without requiring npm ci or a full Windows EXE rebuild for file patches.
 * Future builds also include native source-side implementations of these
 * behaviours; in that case their feature flags prevent duplication. */
import {mapDocumentPositions} from './ui/source-position.js';
import {formatRecentTime} from './ui/recent-time.js';
import {tokenizeCode} from './ui/code-lexer.js';

const $=query=>document.querySelector(query);
let installed=false;

function centerCaret(edit){
  if(edit.centerCurrentSelection){edit.centerCurrentSelection();return;}
  if(edit.mode==='formatted'){
    const view=edit.editor.view,element=edit.richElement,range=view.state.selection;
    try{
      const a=view.coordsAtPos(range.from),b=view.coordsAtPos(range.to);
      element.scrollTop+=(a.top+b.top)/2-element.getBoundingClientRect().top-element.clientHeight/2;
    }catch{};
  }else{
    const raw=edit.raw,at=Math.floor((raw.selectionStart+raw.selectionEnd)/2);
    const style=getComputedStyle(raw),mirror=document.createElement('div');
    Object.assign(mirror.style,{
      position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-99999px',top:'0',
      width:`${raw.clientWidth}px`,whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,
      wordBreak:style.wordBreak,tabSize:style.tabSize,font:style.font,
      padding:style.padding,boxSizing:'border-box',border:'0'
    });
    if(at<=400000){
      mirror.textContent=raw.value.slice(0,at);
      const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);
      document.body.append(mirror);
      raw.scrollTop=Math.max(0,marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top-raw.clientHeight/2);
      mirror.remove();
    }else{
      const before=raw.value.slice(0,at),rows=before.split('\n').length-1;
      const line=parseFloat(style.lineHeight)||24;
      raw.scrollTop=Math.max(0,rows*line-raw.clientHeight/2);
    }
  }
}

function preserveModeSelection(edit){
  if(edit.centerCurrentSelection)return; // The rebuilt source handles this.
  const original=edit.switchMode.bind(edit);
  edit.switchMode=(mode,options={})=>{
    if(mode===edit.mode)return;
    let range;
    if(mode==='raw'){
      edit.syncRichSelection(true);
      const map=mapDocumentPositions(edit.getBody(),edit.editor.state.doc);
      const {from,to}=edit.editor.state.selection;
      range=[map.toRaw(from),map.toRaw(to)];
      original(mode,options);
      edit.raw.setSelectionRange(...range);
    }else{
      const {selectionStart:start,selectionEnd:end}=edit.raw;
      original(mode,options);
      const map=mapDocumentPositions(options.body??edit.getBody(),edit.editor.state.doc);
      range=[map.toRich(start),map.toRich(end)];
      const doc=edit.editor.state.doc,Type=edit.editor.state.selection.constructor;
      const selection=Type.between(doc.resolve(Math.max(0,Math.min(doc.content.size,range[0]))),doc.resolve(Math.max(0,Math.min(doc.content.size,range[1]))));
      edit.editor.view.dispatch(edit.editor.state.tr.setSelection(selection));
    }
    requestAnimationFrame(()=>{if(edit.mode===mode)centerCaret(edit);});
  };
}

function interceptTab(edit){
  // Capture Tab before browser focus navigation, including inside fenced code blocks.
  document.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
    if(!event.target.closest('#rich-editor,#raw-editor'))return;
    if(event.target.closest('.markpad-table-ghost'))return; // ghost navigator owns Tab
    if(edit.mode==='formatted' && !event.target.closest('#rich-editor'))return;
    if(edit.mode==='raw' && !event.target.closest('#raw-editor'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(edit.mode==='raw'){
      if(typeof edit.rawTab==='function'){edit.rawTab(event.shiftKey);return;}
      if(!event.shiftKey){edit.insertText('  ');return;}
      const raw=edit.raw,from=raw.selectionStart;
      const start=raw.value.lastIndexOf('\n',from-1)+1;
      const prefix=raw.value.slice(start).match(/^(\t| {1,2})/);
      if(prefix){edit.recordRawUndo();edit.rawRedo=[];
        raw.setRangeText('',start,start+prefix[0].length,'preserve');
        raw.setSelectionRange(Math.max(start,from-prefix[0].length),Math.max(start,raw.selectionEnd-prefix[0].length));
        edit.onChange?.();edit.onSelection?.();}
      return;
    }
    const view=edit.editor.view;
    if(typeof edit.handleDocumentKeyDown==='function'){edit.handleDocumentKeyDown(view,event);return;}
    const state=view.state;
    const $from=state.selection.$from;
    let code=false;
    for(let d=$from.depth;d>=0;d--)if($from.node(d).type.name==='codeBlock'){code=true;break;}
    if(event.shiftKey){
      if(code){
        const line=$from.parent.textContent;
        const offset=$from.parentOffset,start=line.lastIndexOf('\n',offset-1)+1;
        const prefix=line.slice(start).match(/^(\t| {1,2})/);
        if(prefix)view.dispatch(state.tr.delete($from.start()+start,$from.start()+start+prefix[0].length).scrollIntoView());
      }else if(!edit.editor.commands.liftListItem('listItem'))edit.editor.commands.liftListItem('taskItem');
    }else if(code)view.dispatch(state.tr.insertText('\t').scrollIntoView());
    else if(!edit.editor.commands.sinkListItem('listItem')&&!edit.editor.commands.sinkListItem('taskItem'))
      view.dispatch(state.tr.insertText('  ').scrollIntoView());
  },true);
}

function applyCodeNodeView(edit){
  // New fully bundled builds use efficient ProseMirror decorations instead.
  if(edit.editor.extensionManager.extensions.some(ext=>ext.name==='markpadCodeHighlight'))return;
  const view=edit.editor.view;
  const nodeViews={...(view.props.nodeViews||{})};
  nodeViews.codeBlock=(initial)=>{
    const pre=document.createElement('pre');pre.className='mp-codeblock';
    const content=document.createElement('code');content.className='mp-code-input';
    const overlay=document.createElement('code');overlay.className='mp-code-overlay';
    overlay.setAttribute('aria-hidden','true');
    pre.append(content,overlay);
    let latest=initial,queued=false;
    const paint=()=>{
      queued=false;
      const text=latest.textContent;
      const lang=latest.attrs.language;
      if(!lang||text.length>200000){content.style.color='';pre.classList.remove('mp-code-colored');overlay.replaceChildren();return;}
      const tokens=tokenizeCode(text,lang);
      if(!tokens.length){content.style.color='';pre.classList.remove('mp-code-colored');overlay.replaceChildren();return;}
      pre.classList.add('mp-code-colored');
      const fragment=document.createDocumentFragment();
      let end=0;
      for(const token of tokens){
        if(token.start>end)fragment.append(document.createTextNode(text.slice(end,token.start)));
        const span=document.createElement('span');span.className=`mp-syntax-${token.type}`;
        span.textContent=text.slice(token.start,token.end);fragment.append(span);end=token.end;
      }
      if(end<text.length)fragment.append(document.createTextNode(text.slice(end)));
      overlay.replaceChildren(fragment);
    };
    const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(paint);}};
    schedule();
    return {
      dom:pre,contentDOM:content,
      update(node){if(node.type!==latest.type)return false;latest=node;schedule();return true;},
      ignoreMutation(mutation){return overlay===mutation.target||overlay.contains(mutation.target);}
    };
  };
  view.setProps({nodeViews});
}

function formatRecentsWhenShown(){
  const modal=$('#modal');
  const mutate=()=>{
    for(const button of modal.querySelectorAll('.recent-main')){
      if(button.querySelector('.recent-time'))continue;
      const name=button.querySelector('strong'),detail=button.querySelector('span');
      if(!name||!detail)continue;
      const separator=detail.textContent.lastIndexOf(' · ');
      if(separator<0)continue;
      const date=new Date(detail.textContent.slice(separator+3));
      if(!Number.isFinite(date.getTime()))continue;
      const header=document.createElement('span');header.className='recent-main-header';
      const time=document.createElement('span');time.className='recent-time';
      time.textContent=formatRecentTime(date);time.title=date.toLocaleString();
      detail.textContent=detail.textContent.slice(0,separator);
      header.append(name,time);button.prepend(header);
    }
  };
  new MutationObserver(mutate).observe(modal,{subtree:true,childList:true});
  mutate();
}

function install(){
  if(installed||!window.markpadApp?.editor?.())return;
  installed=true;
  const edit=window.markpadApp.editor();
  preserveModeSelection(edit);
  interceptTab(edit);
  applyCodeNodeView(edit);
  formatRecentsWhenShown();
  // The bundled editor knows how to expand the sheet on an icon click.
  const workbook=window.markpadInspect?.state?.().sheets||[];
  if(workbook.some(sheet=>Object.values(sheet.cells).some(value=>value!==''))&&!window.markpadInspect.state().sheetShown)
    $('#sheet-tab')?.click();
  const refreshScrollbar=()=>{
    const surface=edit.mode==='raw'?edit.raw:edit.richElement;
    const width=surface.scrollHeight>surface.clientHeight+1?Math.max(0,surface.offsetWidth-surface.clientWidth):0;
    document.documentElement.style.setProperty('--editor-scrollbar-width',`${width}px`);
  };
  const resize=new ResizeObserver(refreshScrollbar);
  resize.observe(edit.richElement);resize.observe(edit.raw);
  const richBody=edit.richElement.querySelector('.tiptap');
  if(richBody)resize.observe(richBody);
  edit.raw.addEventListener('input',refreshScrollbar);
  $('#mode-toggle').addEventListener('click',()=>requestAnimationFrame(refreshScrollbar));
  window.addEventListener('resize',refreshScrollbar);
  requestAnimationFrame(refreshScrollbar);
  window.markpadEnhancementInspect=Object.freeze({
    scrollbar:()=>getComputedStyle(document.documentElement).getPropertyValue('--editor-scrollbar-width').trim(),
    codeNode:()=>Boolean($('.mp-codeblock')),
  });
}
document.addEventListener('markpad:ready',install,{once:true});
if(window.markpadApp)install();
