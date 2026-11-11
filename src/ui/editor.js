import {Editor,InputRule,Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {TextSelection,AllSelection} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import {ExpandableTables} from './table-editing.js';
import {LinkedCellEditing} from './linked-cell-editing.js';
import {cellLinkId,CELL_LINK_PREFIX,linkedDisplay,findRawCellLinks,mapSourceOffset} from '../core/linked-cells.js';
import {createEvaluator} from '../core/workbook.js';
import {CodeHighlight} from './code-highlight.js';
import {mapDocumentPositions} from './source-position.js';
import {htmlSourceExtensions} from './html-source.js';

const MarkpadTaskItem=TaskItem.extend({
  addInputRules(){
    return [new InputRule({
      find:/^\s*\[([ xX])\]\s$/,
      handler:({range,match,chain})=>{
        if(!this.editor.isActive('bulletList'))return null;
        chain().deleteRange(range).liftListItem('listItem').toggleTaskList()
          .updateAttributes('taskItem',{checked:match[1].toLowerCase()==='x'}).run();
      }
    }),...(this.parent?.()||[])];
  }
});

export class DocumentEditor {
  constructor({onChange,onSelection,onMode,copyText}) {
    this.onChange=onChange;this.onSelection=onSelection;this.onMode=onMode;
    this.richElement=document.querySelector('#rich-editor');this.raw=document.querySelector('#raw-editor');
    this.mode='formatted';this.originalSource='';this.richChanged=false;this.loading=false;this.rawUndo=[];this.rawRedo=[];
    this.editor=new Editor({element:this.richElement,extensions:[
      StarterKit.configure({underline:true,link:{openOnClick:false,autolink:false,markdownLinks:true,defaultProtocol:'https',isAllowedUri:(uri)=>/^(https?:\/\/|mailto:|#)/i.test(uri)}}),
      Markdown.configure({markedOptions:{gfm:true},indentation:{style:'space',size:2}}),
      TableKit.configure({table:{resizable:false}}),TaskList,MarkpadTaskItem.configure({nested:true}),
      ...htmlSourceExtensions(Node,MarkdownManager),
      Image.configure({allowBase64:true}),ExpandableTables,LinkedCellEditing,CodeHighlight.configure({copyText}),Placeholder.configure({placeholder:'Start writing…'})
    ],content:'',contentType:'markdown',editorProps:{attributes:{'aria-label':'Formatted Markdown editor','role':'textbox','aria-multiline':'true',spellcheck:'true'},handleClick:(view,pos,event)=>{if(event.target.closest('a')){event.preventDefault();return true;}return false;},handleKeyDown:(view,event)=>this.handleDocumentKeyDown(view,event)},
    onUpdate:()=>{if(this.loading)return;this.richChanged=true;this.onChange?.();},
    onSelectionUpdate:()=>this.onSelection?.(),onFocus:()=>this.onSelection?.()});
    document.addEventListener('pointerdown',event=>{
      if(this.mode==='formatted'&&!this.richElement.contains(event.target))this.syncRichSelection();
    },true);
    this.richElement.addEventListener('focusout',()=>this.syncRichSelection(true));
    this.raw.addEventListener('beforeinput',()=>this.recordRawUndo());
    this.raw.addEventListener('input',()=>{this.rawRedo=[];this.onChange?.();this.onSelection?.();});
    this.raw.addEventListener('select',()=>this.onSelection?.());this.raw.addEventListener('keyup',()=>this.onSelection?.());
    this.raw.addEventListener('click',()=>this.onSelection?.());
    this.raw.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229)return;
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?this.redo():this.undo();}
      else if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='y'){event.preventDefault();this.redo();}
      else if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey){event.preventDefault();this.rawTab(event.shiftKey);}
    });
  }
  /** Keep Tab inside the document, including code fences. */
  handleDocumentKeyDown(view,event){
    if(event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return false;
    event.preventDefault();
    const state=view.state,$from=state.selection.$from;
    let block=null;
    for(let depth=$from.depth;depth>=0;depth--){
      if($from.node(depth).type.name==='codeBlock'){block={node:$from.node(depth),start:$from.start(depth)};break;}
    }
    if(block){
      const text=block.node.textContent,relative=Math.max(0,state.selection.from-block.start);
      if(event.shiftKey){
        const lineStart=text.lastIndexOf('\n',relative-1)+1;
        const prefix=text.slice(lineStart).match(/^(\t| {1,2})/);
        if(prefix){
          const tr=state.tr.delete(block.start+lineStart,block.start+lineStart+prefix[0].length);
          view.dispatch(tr.scrollIntoView());
        }
      }else view.dispatch(state.tr.insertText('\t').scrollIntoView());
    }else if(event.shiftKey){
      if(!this.editor.commands.liftListItem('listItem')) this.editor.commands.liftListItem('taskItem');
    }else if(!this.editor.commands.sinkListItem('listItem')&&!this.editor.commands.sinkListItem('taskItem')){
      view.dispatch(state.tr.insertText('  ').scrollIntoView());
    }
    return true;
  }
  rawTab(outdent){
    const source=this.raw.value,{selectionStart:start,selectionEnd:end}=this.raw;
    const first=source.lastIndexOf('\n',start-1)+1;
    // Multiple selected lines are handled as one undoable operation.
    const last=end>start&&source[end-1]==='\n'?end-1:end;
    const lineEnd=source.indexOf('\n',last),until=lineEnd===-1?source.length:lineEnd;
    const selectionWholeLines=end>start&&(source.slice(start,end).includes('\n')||outdent);
    if(!selectionWholeLines&&!outdent){this.insertText('  ');return;}
    this.recordRawUndo();this.rawRedo=[];
    const original=source.slice(first,until);
    const lines=original.split('\n');
    const updated=lines.map(line=>outdent?line.replace(/^(?:\t| {1,2})/,''):'  '+line).join('\n');
    this.raw.setRangeText(updated,first,until,'preserve');
    this.raw.setSelectionRange(first,first+updated.length);
    this.raw.focus();this.onChange?.();this.onSelection?.();
  }
  trimRawHistory(){
    const bytes=()=>[...this.rawUndo,...this.rawRedo].reduce((n,item)=>n+item.value.length*2,0);
    while(this.rawUndo.length+this.rawRedo.length>150||bytes()>8*1024*1024){
      // Keep one most-recent snapshot even for an unusually large raw file.
      if(this.rawUndo.length>1)this.rawUndo.shift();
      else if(this.rawRedo.length>1)this.rawRedo.shift();
      else if(this.rawUndo.length&&this.rawRedo.length)this.rawRedo.shift();
      else break;
    }
  }
  recordRawUndo(){const last=this.rawUndo.at(-1);if(!last||last.value!==this.raw.value){this.rawUndo.push({value:this.raw.value,start:this.raw.selectionStart,end:this.raw.selectionEnd});this.trimRawHistory();}}
  setBodyJSON(source,json){this.replaceLoadedContent(source,json,{emitUpdate:false});}
  /** Loading/reformatting is not a user edit, and must not join the first typed
   * change in the undo history (which could otherwise undo the whole load). */
  replaceLoadedContent(source,content,options){
    this.loading=true;
    try{
      this.originalSource=String(source);this.richChanged=false;
      this.useCRLF=this.originalSource.includes('\r\n')&&!/(?<!\r)\n|\r(?!\n)/.test(this.originalSource);
      this.editor.chain().setMeta('addToHistory',false).setContent(content,options).run();
      this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    }finally{this.loading=false;}
  }
  showFastText(source,{keepSelection=false}={}){const start=keepSelection?this.raw.selectionStart:0,end=keepSelection?this.raw.selectionEnd:0;this.raw.value=source;this.rawSnapshot={source:String(source),value:this.raw.value};this.richElement.hidden=true;this.raw.hidden=false;this.mode='raw';this.raw.setSelectionRange(start,end);this.raw.spellcheck=false;this.richElement.classList.add('large-document');}
  setBody(source){this.replaceLoadedContent(source,source,{contentType:'markdown',emitUpdate:false});}
  getBody(){if(!this.richChanged)return this.originalSource;const doc=this.editor.state.doc;if(this.serializedDoc!==doc){const markdown=this.editor.getMarkdown();this.serializedBody=this.useCRLF?markdown.replace(/\r?\n/g,'\r\n'):markdown;this.serializedDoc=doc;}return this.serializedBody;}
  getRaw(){return this.rawSnapshot?.value===this.raw.value?this.rawSnapshot.source:this.raw.value;}
  setRaw(source,{history=false}={}){if(history){this.recordRawUndo();this.rawRedo=[];}this.raw.value=source;this.rawSnapshot={source:String(source),value:this.raw.value};this.onSelection?.();}
  switchMode(mode,{body,fullSource,json,preserveFocus=false}={}){
    if(mode===this.mode)return;
    const priorFocus=preserveFocus?document.activeElement:null;
    const restoreFocus=priorFocus&&!this.raw.contains(priorFocus)&&!this.richElement.contains(priorFocus);
    let range;
    if(mode==='raw'){
      this.syncRichSelection(true);
      const nextSource=fullSource??this.getBody();
      const mapping=mapDocumentPositions(this.getBody(),this.editor.state.doc);
      const sel=this.editor.state.selection;
      range=[mapping.toRaw(sel.from),mapping.toRaw(sel.to)];
      if(this.raw.value!==nextSource){this.rawUndo=[];this.rawRedo=[];}
      this.raw.value=nextSource;this.rawSnapshot={source:nextSource,value:this.raw.value};
      this.richElement.hidden=true;this.raw.hidden=false;this.mode='raw';
      this.raw.focus({preventScroll:true});
      this.raw.setSelectionRange(...range);
    }else{
      const oldRaw=this.raw.value,start=this.raw.selectionStart,end=this.raw.selectionEnd;
      if(body!==undefined){if(json)this.setBodyJSON(body,json);else this.setBody(body);}
      if(start===0&&end===0)range=[1,1];else{const mapping=mapDocumentPositions(body??oldRaw,this.editor.state.doc);range=[mapping.toRich(start),mapping.toRich(end)];}
      this.richElement.hidden=false;this.raw.hidden=true;this.mode='formatted';
      const pm=this.editor.state.doc;
      const selection=TextSelection.between(pm.resolve(Math.max(0,Math.min(pm.content.size,range[0]))),pm.resolve(Math.max(0,Math.min(pm.content.size,range[1]))));
      this.editor.view.dispatch(this.editor.state.tr.setSelection(selection));
      this.editor.view.focus();
    }
    if(restoreFocus&&priorFocus.isConnected)priorFocus.focus({preventScroll:true});
    this.onMode?.(this.mode);this.onSelection?.();
    const nextMode=this.mode;
    requestAnimationFrame(()=>{if(this.mode===nextMode)this.centerCurrentSelection();});
  }
  /** Center the current selection instead of accepting the browser's usual
   * scroll-to-end behavior following a contenteditable/textarea mode switch. */
  centerCurrentSelection(){
    if(this.mode==='formatted'){
      const view=this.editor.view,container=this.richElement,selection=view.state.selection;
      try{
        const first=view.coordsAtPos(selection.from),last=view.coordsAtPos(selection.to);
        const target=(first.top+last.top)/2;
        container.scrollTop+=target-container.getBoundingClientRect().top-container.clientHeight/2;
      }catch{/* A transient unmounted DOM node may not have coordinates yet. */}
    }else{
      const raw=this.raw,center=Math.floor((raw.selectionStart+raw.selectionEnd)/2);
      if(center>400000){
        const before=raw.value.slice(0,center);
        const rows=before.split('\n').length-1;
        raw.scrollTop=Math.max(0,rows*parseFloat(getComputedStyle(raw).lineHeight)-raw.clientHeight/2);
        return;
      }
      const style=getComputedStyle(raw),mirror=document.createElement('div');
      Object.assign(mirror.style,{
        position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-99999px',top:'0',
        width:`${raw.clientWidth}px`,whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,
        wordBreak:style.wordBreak,tabSize:style.tabSize,font:style.font,
        padding:style.padding,boxSizing:'border-box',border:'0'
      });
      mirror.textContent=raw.value.slice(0,center);
      const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);
      document.body.append(mirror);
      const top=marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top;
      mirror.remove();
      raw.scrollTop=Math.max(0,top-raw.clientHeight/2);
    }
  }
  focus(){this.mode==='raw'?this.raw.focus():this.editor.commands.focus();}
  syncRichSelection(force=false){
    if(this.mode!=='formatted'||(!force&&!this.editor.view.hasFocus()))return;
    const selection=window.getSelection(),view=this.editor.view;
    if(!selection?.anchorNode||!selection.focusNode||!view.dom.contains(selection.anchorNode)||!view.dom.contains(selection.focusNode))return;
    if(!(view.state.selection instanceof TextSelection||view.state.selection instanceof AllSelection))return;
    try{
      const anchor=view.posAtDOM(selection.anchorNode,selection.anchorOffset),head=view.posAtDOM(selection.focusNode,selection.focusOffset);
      const mapped=TextSelection.between(view.state.doc.resolve(anchor),view.state.doc.resolve(head));
      if(!mapped.eq(view.state.selection))view.dispatch(view.state.tr.setSelection(mapped));
    }catch{/* A composition or DOM change may briefly make a native range unmappable. */}
  }
  selection(){this.syncRichSelection();if(this.mode==='raw')return{from:this.raw.selectionStart,to:this.raw.selectionEnd,text:this.raw.value.slice(this.raw.selectionStart,this.raw.selectionEnd)};const {from,to}=this.editor.state.selection;return{from,to,text:this.editor.state.doc.textBetween(from,to,'\n')};}
  insertText(text,{append=false}={}){
    text=String(text);const sel=this.selection();const from=append?sel.to:sel.from;const to=sel.to;
    if(this.mode==='raw'){this.recordRawUndo();this.raw.setRangeText(text,from,to,'end');this.rawRedo=[];this.raw.focus();this.onChange?.();this.onSelection?.();return;}
    const transaction=this.editor.state.tr.insertText(text,from,to);
    const end=Math.min(transaction.doc.content.size,transaction.mapping.map(to,1));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(end),-1));
    this.editor.view.dispatch(transaction.scrollIntoView());this.editor.view.focus();
  }
  linkedOccurrences(source){
    if(this.mode==='raw')return findRawCellLinks(source??this.raw.value);
    const found=[];
    this.editor.state.doc.descendants((node,pos)=>{
      if(!node.isText)return;
      const mark=node.marks.find(m=>m.type.name==='link'&&cellLinkId(m.attrs.href));if(!mark)return;
      const id=cellLinkId(mark.attrs.href),last=found.at(-1);
      if(last?.id===id&&last.to===pos){last.to=pos+node.nodeSize;last.text+=node.text;}
      else found.push({id,from:pos,to:pos+node.nodeSize,text:node.text,marks:node.marks});
    });
    for(const item of found)if(item.text==='\u200b')item.text='';
    return found;
  }
  insertLinkedCells(spec){
    if(this.mode==='raw'){this.insertText(spec.table?'\n\n'+spec.markdown+'\n\n':spec.markdown);return;}
    const text=cell=>({type:'text',text:cell.text||'\u200b',marks:[{type:'link',attrs:{href:CELL_LINK_PREFIX+cell.id}}]});
    let content;
    if(spec.table){
      const header={type:'tableRow',content:spec.columns.map(label=>({type:'tableHeader',content:[{type:'paragraph',content:[{type:'text',text:label}]}]}))};
      const rows=spec.matrix.map(row=>({type:'tableRow',content:row.map(cell=>({type:'tableCell',content:[{type:'paragraph',content:[text(cell)]}]}))}));
      content=[{type:'table',content:[header,...rows]},{type:'paragraph'}];
    }else content=[text(spec.matrix[0][0])];
    const {from,to}=this.selection();
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    this.editor.chain().focus().insertContentAt({from,to},content).run();
    this.editor.view.dispatch(closeHistory(this.editor.state.tr.setStoredMarks([])));
  }
  refreshLinkedValues(workbook,preserveIds=new Set()){
    if(this.mode!=='formatted')return false;
    const occurrences=this.linkedOccurrences(),evaluate=createEvaluator(workbook),storedMarks=this.editor.state.storedMarks;
    let tr=this.editor.state.tr,changed=false;
    for(const item of [...occurrences].reverse()){
      const link=workbook.linkedCells?.[item.id];if(!link||preserveIds.has(item.id))continue;
      const value=linkedDisplay(workbook,link,evaluate);
      if(item.text===value)continue;
      tr=tr.replaceWith(item.from,item.to,this.editor.schema.text(value||'\u200b',item.marks));changed=true;
    }
    if(changed){
      this.loading=true;
      try{if(!preserveIds.size)closeHistory(tr);
        this.editor.view.dispatch(tr.setStoredMarks(storedMarks).setMeta('addToHistory',false).setMeta('markpad-link-sync',true));this.richChanged=true;}
      finally{this.loading=false;}
    }
    return changed;
  }
  selectRange(from,to){if(this.mode==='raw'){this.raw.focus();this.raw.setSelectionRange(from,to);const line=this.raw.value.slice(0,from).split('\n').length;this.raw.scrollTop=Math.max(0,(line-4)*24);}else{this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc,from,to)).scrollIntoView());this.editor.commands.focus();}this.onSelection?.();}
  selectAll(){if(this.mode==='raw'){this.raw.focus();this.raw.select();}else this.editor.chain().focus().selectAll().run();}
  linkRanges(){
    if(this.mode!=='formatted')return [];
    const {doc,selection,schema}=this.editor.state;
    const {from,to,$from}=selection;
    const ranges=[];
    const collect=(block,start)=>{
      let range=null;
      const append=()=>{
        if(range&&(from===to?range.from<=from&&from<=range.to:range.from<to&&range.to>from))ranges.push(range);
      };
      block.forEach((child,offset)=>{
        const mark=child.isText&&schema.marks.link.isInSet(child.marks);
        if(range&&mark&&range.mark.eq(mark)){range.to=start+offset+child.nodeSize;return;}
        append();
        range=mark?{from:start+offset,to:start+offset+child.nodeSize,mark}:null;
      });
      append();
    };
    if(from===to){if($from.parent.isTextblock)collect($from.parent,$from.start());}
    else doc.nodesBetween(from,to,(node,pos)=>{
      if(node.isTextblock){collect(node,pos+1);return false;}
    });
    return from===to?ranges.slice(-1):ranges;
  }
  breakLinks(){
    const ranges=this.linkRanges();
    if(!ranges.length)return;
    const {tr,schema}=this.editor.state;
    for(const range of ranges)tr.removeMark(range.from,range.to,schema.marks.link);
    this.editor.view.dispatch(closeHistory(tr.removeStoredMark(schema.marks.link)));
    this.focus();
    this.onSelection?.();
  }
  applyLink({from,to,text},href,label){
    if(this.mode==='raw'){
      if(href){this.selectRange(from,to);this.insertText('['+label+']('+href+')');}
      return;
    }
    const {tr,schema}=this.editor.state,link=schema.marks.link;
    if(href&&label!==text){
      tr.insertText(label,from,to);
      to=from+label.length;
    }
    if(from!==to){
      tr.removeMark(from,to,link);
      if(href)tr.addMark(from,to,link.create({href}));
      tr.setSelection(TextSelection.between(tr.doc.resolve(from),tr.doc.resolve(to)));
      this.editor.view.dispatch(closeHistory(tr.removeStoredMark(link)));
    }
    this.focus();
    this.onSelection?.();
  }
  undo(){if(this.mode==='formatted')return this.editor.chain().focus().undo().run();const prev=this.rawUndo.pop();if(!prev)return;this.rawRedo.push({value:this.raw.value,start:this.raw.selectionStart,end:this.raw.selectionEnd});this.trimRawHistory();this.raw.value=prev.value;this.raw.setSelectionRange(prev.start,prev.end);this.onChange?.();this.onSelection?.();}
  redo(){if(this.mode==='formatted')return this.editor.chain().focus().redo().run();const next=this.rawRedo.pop();if(!next)return;this.recordRawUndo();this.raw.value=next.value;this.raw.setSelectionRange(next.start,next.end);this.onChange?.();this.onSelection?.();}
  format(kind,value){
    if(this.mode==='raw')return this.formatRaw(kind,value);
    let c=this.editor.chain().focus();
    if(kind==='bold')c.toggleBold();else if(kind==='italic')c.toggleItalic();else if(kind==='underline')c.toggleUnderline();else if(kind==='strike')c.toggleStrike();
    else if(kind==='bulletList')c.toggleBulletList();else if(kind==='orderedList')c.toggleOrderedList();else if(kind==='taskList')c.toggleTaskList();
    else if(kind==='blockquote')c.toggleBlockquote();else if(kind==='code')c.toggleCode();else if(kind==='codeBlock')c.toggleCodeBlock();
    else if(kind==='htmlBlock'){
      const {$to}=this.editor.state.selection;
      c.insertContentAt($to.depth?$to.after(1):$to.pos,{type:'htmlSourceBlock',attrs:{source:'<div>\n</div>'}});
    }
    else if(kind==='horizontalRule')c.setHorizontalRule();else if(kind==='table')c.insertTable({rows:2,cols:1,withHeaderRow:true});
    else if(kind==='paragraph')c.setParagraph();else if(/^h[1-6]$/.test(kind))c.toggleHeading({level:Number(kind.slice(1))});
    else if(kind==='link'){if(!value)c.unsetLink();else c.extendMarkRange('link').setLink({href:value});}
    else return;c.run();
  }
  formatRaw(kind,value){
    const sel=this.selection();const text=sel.text;let replacement=text;
    const wrappers={bold:'**',italic:'*',strike:'~~',code:'`',underline:'<u>'};
    if(wrappers[kind]){const w=wrappers[kind];replacement=w+(text||'text')+(kind==='underline'?'</u>':w);}
    else if(kind==='link')replacement='['+(text||'link text')+']('+(value||'https://')+')';
    else if(kind==='codeBlock')replacement='\n```\n'+text+'\n```\n';
    else if(kind==='htmlBlock'){
      this.raw.setSelectionRange(sel.to,sel.to);
      replacement='\n\n<div>\n</div>\n\n';
    }
    else if(kind==='horizontalRule')replacement='\n\n---\n\n';
    else if(kind==='table')replacement='\n\n|  |\n| --- |\n|  |\n\n';
    else if(['bulletList','orderedList','taskList','blockquote','paragraph'].includes(kind)||/^h[1-6]$/.test(kind)){
      const source=this.raw.value;const start=source.lastIndexOf('\n',sel.from-1)+1;const endIndex=source.indexOf('\n',sel.to);const end=endIndex===-1?source.length:endIndex;
      const lines=source.slice(start,end).split('\n');const prefix=kind==='bulletList'?'- ':kind==='taskList'?'- [ ] ':kind==='blockquote'?'> ':/^h/.test(kind)?'#'.repeat(Number(kind[1]))+' ':'';
      replacement=lines.map((line,i)=>(kind==='orderedList'?(i+1)+'. ':prefix)+line.replace(/^(#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s+)?|\d+\.\s+|>\s*)/,'' )).join('\n');
      this.raw.setSelectionRange(start,end);this.insertText(replacement);return;
    }else return;
    this.insertText(replacement);
    if(wrappers[kind]){const start=sel.from+wrappers[kind].length;this.raw.setSelectionRange(start,start+(text||'text').length);}
  }
  active(kind){return this.mode==='formatted'&&this.editor.isActive(kind);}
  activeBlock(){for(let i=1;i<=3;i++)if(this.editor.isActive('heading',{level:i}))return'h'+i;return'paragraph';}
  getText(){return this.mode==='raw'?this.raw.value:this.editor.getText();}
  findMatches(query){if(!query)return[];const matches=[];const needle=query.toLocaleLowerCase();if(this.mode==='raw'){const text=this.raw.value.toLocaleLowerCase();let pos=0;while((pos=text.indexOf(needle,pos))!==-1){matches.push({from:pos,to:pos+query.length});pos+=Math.max(1,query.length);}return matches;}this.editor.state.doc.descendants((node,pos)=>{if(node.isText){let at=0;const text=node.text.toLocaleLowerCase();while((at=text.indexOf(needle,at))!==-1){matches.push({from:pos+at,to:pos+at+query.length});at+=Math.max(1,query.length);}}});return matches;}
  replaceMatches(matches,value){if(this.mode==='raw'){this.recordRawUndo();let text=this.raw.value;for(const m of [...matches].reverse())text=text.slice(0,m.from)+value+text.slice(m.to);this.raw.value=text;this.onChange?.();return;}let tr=this.editor.state.tr;for(const m of [...matches].reverse())tr=tr.insertText(value,m.from,m.to);this.editor.view.dispatch(tr);}
}

export function needsRawPreservation(source){
  // Line-by-line checks avoid unbounded whole-document regex backtracking.
  if(source.length>8*1024*1024)return true;
  let fence=null,first=true;
  for(let line of source.split(/\r?\n/)){
    if(first){first=false;if(line==='---')return true;}
    const mark=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(fence){if(mark&&mark[1][0]===fence[0]&&mark[1].length>=fence.length&&line.slice(mark[0].length).trim()==='')fence=null;continue;}
    if(mark){fence=mark[1];continue;}
    line=line.replace(/<\/?u>/gi,'').replace(/`[^`]*`/g,'').replace(/\\</g,'');
    if(/^ {0,3}\[[^\]]+\]:|^\$\$/i.test(line))return true;
  }
  return false;
}
