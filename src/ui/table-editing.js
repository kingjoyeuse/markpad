import {Extension} from '@tiptap/core';
import {Plugin,TextSelection} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';

// Ghosts live outside the ProseMirror document. Only entering actual text creates
// schema cells. Selection/layout decorations cannot enter Markdown or recovery.
const LAYOUT='markpad-table-layout',EXPAND='markpad-table-expand',PRUNE='markpad-table-prune';
const contentful=node=>{
  if(node.textContent.replace(/[\s\u200b]/g,''))return true;
  let found=false;node.descendants(child=>{if(child.isLeaf&&!child.isText&&child.type.name!=='hardBreak')found=true;});return found;
};
function regular(table){
  if(!table||table.type.name!=='table'||!table.childCount)return false;
  const count=table.firstChild.childCount;if(!count)return false;
  for(let r=0;r<table.childCount;r++){
    const row=table.child(r);if(row.childCount!==count)return false;
    for(let c=0;c<count;c++)if((row.child(c).attrs.colspan||1)!==1||(row.child(c).attrs.rowspan||1)!==1)return false;
  }return true;
}
function context(state){
  const $pos=state.selection.$head;let tableDepth=0,rowDepth=0,cellDepth=0;
  for(let d=1;d<=$pos.depth;d++){
    const name=$pos.node(d).type.name;
    if(name==='table')tableDepth=d;else if(name==='tableRow')rowDepth=d;else if(name==='tableCell'||name==='tableHeader')cellDepth=d;
  }
  if(!tableDepth||!rowDepth||!cellDepth)return null;
  const table=$pos.node(tableDepth);if(!regular(table))return null;
  return{pos:$pos.before(tableDepth),table,row:$pos.index(tableDepth),col:$pos.index(rowDepth),cellPos:$pos.before(cellDepth),cell:$pos.node(cellDepth)};
}
function cellPosition(table,pos,row,col){
  let out=pos+2;for(let r=0;r<row;r++)out+=table.child(r).nodeSize;
  for(let c=0;c<col;c++)out+=table.child(row).child(c).nodeSize;return out;
}
function pruneCleared(transactions,oldState,newState){
  if(!transactions.some(t=>t.docChanged)||transactions.some(t=>t.getMeta(PRUNE)||t.getMeta(EXPAND)||t.getMeta('preventUpdate')||t.getMeta('markpad-link-sync')))return null;
  const changes=[];
  oldState.doc.descendants((old,pos)=>{
    if(old.type.name!=='table')return;
    if(!regular(old))return false;
    let nextPos=pos;for(const t of transactions)nextPos=t.mapping.map(nextPos,1);
    const table=newState.doc.nodeAt(nextPos);
    // Never contract a freshly created/expanded table or a structural operation.
    if(!regular(table)||table===old||table.childCount!==old.childCount||table.firstChild.childCount!==old.firstChild.childCount)return false;
    const goneRows=[],goneCols=[];
    for(let r=0;r<table.childCount;r++)if(contentful(old.child(r))&&!contentful(table.child(r)))goneRows.push(r);
    for(let c=0;c<table.firstChild.childCount;c++){
      let was=false,is=false;for(let r=0;r<table.childCount;r++){was||=contentful(old.child(r).child(c));is||=contentful(table.child(r).child(c));}
      if(was&&!is)goneCols.push(c);
    }
    if(!goneRows.length&&!goneCols.length)return false;
    let replacement;
    if(!contentful(table)||goneRows.length===table.childCount||goneCols.length===table.firstChild.childCount)replacement=newState.schema.nodes.paragraph.create();
    else{
      const rows=[];
      for(let r=0;r<table.childCount;r++){
        if(goneRows.includes(r))continue;const row=table.child(r),cells=[];
        for(let c=0;c<row.childCount;c++)if(!goneCols.includes(c)){
          const cell=row.child(c),promote=rows.length===0&&goneRows.includes(0)&&table.firstChild.firstChild.type.name==='tableHeader';
          cells.push(promote?newState.schema.nodes.tableHeader.create(cell.attrs,cell.content,cell.marks):cell);
        }
        rows.push(row.type.create(row.attrs,cells,row.marks));
      }
      replacement=table.type.create(table.attrs,rows,table.marks);
    }
    changes.push({pos:nextPos,table,replacement});return false;
  });
  if(!changes.length)return null;
  let tr=newState.tr;
  for(const item of changes.sort((a,b)=>b.pos-a.pos))tr=tr.replaceWith(item.pos,item.pos+item.table.nodeSize,item.replacement);
  return tr.setMeta(PRUNE,true);
}

class TableGhostView{
  constructor(view,plugin){
    this.view=view;this.plugin=plugin;this.container=view.dom.closest('#rich-editor');this.ghost=null;this.frame=0;this.destroyed=false;
    this.overlay=document.createElement('div');this.overlay.className='markpad-table-ghosts';this.overlay.hidden=true;
    this.container.append(this.overlay);this.inputs=new Map();this.tables=[];this.tablesDoc=null;
    this.schedule=()=>{if(!this.frame&&!this.destroyed)this.frame=requestAnimationFrame(()=>{this.frame=0;this.layout();});};
    this.onFocus=()=>this.schedule();this.onPointer=event=>{
      if(!this.overlay.contains(event.target))this.ghost=null;
      this.schedule();
    };
    this.container.addEventListener('scroll',this.schedule,{passive:true});window.addEventListener('resize',this.schedule);
    document.addEventListener('focusin',this.onFocus);document.addEventListener('focusout',this.onFocus);document.addEventListener('pointerdown',this.onPointer,true);
    this.resize=new ResizeObserver(this.schedule);this.resize.observe(this.container);
    for(const id of ['calculator','spreadsheet']){const el=document.getElementById(id);if(el)this.resize.observe(el);}
    this.mutations=new MutationObserver(this.schedule);
    for(const el of [document.documentElement,document.getElementById('workspace'),document.getElementById('calculator'),document.getElementById('spreadsheet'),this.container]){
      if(el)this.mutations.observe(el,{attributes:true,attributeFilter:['hidden','style','class']});
    }
    this.schedule();
  }
  update(view,previous){
    this.view=view;
    if(previous.doc!==view.state.doc){this.tablesDoc=null;if(this.ghost&&!regular(view.state.doc.nodeAt(this.ghost.pos)))this.ghost=null;}
    this.schedule();
  }
  activeContext(){
    if(this.container.hidden)return null;
    if(this.ghost&&this.overlay.contains(document.activeElement)){
      const table=this.view.state.doc.nodeAt(this.ghost.pos);return regular(table)?{...this.ghost,table}:null;
    }
    return this.view.hasFocus()?context(this.view.state):null;
  }
  tableList(){
    if(this.tablesDoc===this.view.state.doc)return this.tables;
    this.tables=[];this.view.state.doc.descendants((node,pos)=>{if(node.type.name==='table'){this.tables.push({node,pos});return false;}});
    this.tablesDoc=this.view.state.doc;return this.tables;
  }
  layout(){
    if(this.destroyed||!this.view.dom.isConnected)return;
    const active=this.activeContext(),containerRect=this.container.getBoundingClientRect();
    const panels=['calculator','spreadsheet'].map(id=>document.getElementById(id)).filter(el=>el&&!el.hidden&&el.getClientRects().length).map(el=>el.getBoundingClientRect());
    const layouts=[];
    // No DOM measurements of every paragraph: only tables, cached by document.
    for(const {node,pos} of this.tableList()){
      const dom=this.view.nodeDOM(pos);if(!dom?.getBoundingClientRect)continue;
      const table=dom.tagName==='TABLE'?dom:dom.querySelector('table');if(!table)continue;
      const rect=table.getBoundingClientRect(),parent=dom.parentElement,parentRect=parent.getBoundingClientRect(),style=getComputedStyle(parent);
      let available=Math.max(60,parentRect.right-parseFloat(style.paddingRight||0)-rect.left);
      const natural=available,isActive=active?.pos===pos;
      const ghostHeight=isActive?Math.max(30,Math.ceil(parseFloat(getComputedStyle(table).lineHeight)||25)+16):0;
      for(const panel of panels)if(rect.top<panel.bottom&&rect.bottom+(isActive?ghostHeight:0)>panel.top&&rect.left<panel.right&&rect.left+available>panel.left){available=Math.max(60,Math.min(available,panel.left-rect.left-12));}
      const ghostWidth=isActive?Math.max(28,Math.min(150,available/(node.firstChild.childCount+1))):0;
      if(isActive||available<natural-1)layouts.push({pos,width:Math.max(30,Math.floor(available-ghostWidth)),ghostWidth:Math.floor(ghostWidth),ghostHeight});
    }
    const previous=this.plugin.getState(this.view.state)||[];
    if(JSON.stringify(previous)!==JSON.stringify(layouts)){
      this.view.dispatch(this.view.state.tr.setMeta(LAYOUT,layouts).setMeta('addToHistory',false));
    }
    if(!active){this.overlay.hidden=true;this.ghost=null;return;}
    const dom=this.view.nodeDOM(active.pos),table=dom?.tagName==='TABLE'?dom:dom?.querySelector('table');
    const layout=layouts.find(x=>x.pos===active.pos);if(!table||!layout){this.overlay.hidden=true;return;}
    const rect=table.getBoundingClientRect(),rows=[...table.rows],last=rows.at(-1),cells=rows[0]?[...rows[0].cells]:[];
    this.overlay.hidden=false;this.overlay.style.left=`${rect.left-containerRect.left+this.container.scrollLeft}px`;
    this.overlay.style.top=`${rect.top-containerRect.top+this.container.scrollTop}px`;
    this.overlay.style.width=`${rect.width+layout.ghostWidth}px`;this.overlay.style.height=`${rect.height+layout.ghostHeight}px`;
    const wanted=new Set();
    const put=(axis,row,col,x,y,width,height)=>{
      const key=`${axis}:${row}:${col}`;wanted.add(key);let input=this.inputs.get(key);
      if(!input){
        input=document.createElement('textarea');input.className='markpad-table-ghost';input.tabIndex=-1;input.rows=1;input.spellcheck=false;input.placeholder='+';
        input.dataset.ghostAxis=axis;input.dataset.ghostRow=String(row);input.dataset.ghostCol=String(col);
        input.setAttribute('aria-label',axis==='column'?`New column, row ${row+1}`:`New row, column ${col+1}`);
        input.title=axis==='column'?'Type to add a column':'Type to add a row';
        input.addEventListener('focus',()=>{this.ghost={pos:Number(input.dataset.tablePos),axis,row,col};this.schedule();});
        input.addEventListener('keydown',event=>this.ghostKey(event,input));
        input.addEventListener('beforeinput',event=>{
          if(event.isComposing||this.composing)return;
          if(event.inputType.startsWith('insert')&&event.data){event.preventDefault();this.materialize(input,event.data);}
        });
        input.addEventListener('input',event=>{if(!event.isComposing&&!this.composing&&input.value)this.materialize(input,input.value);});
        input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(text){event.preventDefault();this.materialize(input,text);}});
        input.addEventListener('compositionstart',()=>{this.composing=true;});
        input.addEventListener('compositionend',()=>{this.composing=false;if(input.value)this.materialize(input,input.value);});
        this.inputs.set(key,input);this.overlay.append(input);
      }
      input.dataset.tablePos=String(active.pos);
      Object.assign(input.style,{left:x+'px',top:y+'px',width:Math.max(14,width)+'px',height:Math.max(22,height)+'px'});
    };
    rows.forEach((row,r)=>{
      const bounds=row.getBoundingClientRect();
      if(bounds.bottom<containerRect.top-100||bounds.top>containerRect.bottom+100){if(!(this.ghost?.axis==='column'&&this.ghost.row===r))return;}
      put('column',r,cells.length,rect.width,bounds.top-rect.top,layout.ghostWidth,bounds.height);
    });
    if(last){
      cells.forEach((cell,c)=>{const bounds=cell.getBoundingClientRect();put('row',rows.length,c,bounds.left-rect.left,rect.height,bounds.width,layout.ghostHeight);});
      put('corner',rows.length,cells.length,rect.width,rect.height,layout.ghostWidth,layout.ghostHeight);
    }
    for(const [key,input] of this.inputs)if(!wanted.has(key)){input.remove();this.inputs.delete(key);}
  }
  focusGhost(ctx,axis,row,col){
    this.ghost={pos:ctx.pos,axis,row,col};this.layout();
    const input=this.inputs.get(`${axis}:${row}:${col}`);if(!input)return false;
    input.focus({preventScroll:true});input.scrollIntoView({block:'nearest',inline:'nearest'});this.schedule();return true;
  }
  selectCell(ctx,row,col,end=false){
    if(row<0||row>=ctx.table.childCount||col<0||col>=ctx.table.firstChild.childCount)return false;
    const cell=ctx.table.child(row).child(col),pos=cellPosition(ctx.table,ctx.pos,row,col)+(end?cell.nodeSize-2:2);
    this.ghost=null;this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(pos),end?-1:1)).scrollIntoView());this.view.focus();this.schedule();return true;
  }
  leaveTable(ctx){
    let tr=this.view.state.tr;const end=ctx.pos+ctx.table.nodeSize,$end=tr.doc.resolve(end);
    // Tables at the document end need somewhere real for the caret to go.
    if(!$end.nodeAfter?.isTextblock)tr=tr.insert(end,this.view.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(end+1),1));this.ghost=null;
    this.view.dispatch(tr.scrollIntoView());this.view.focus();this.schedule();
  }
  ghostKey(event,input){
    if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
    const ghost=this.ghost,table=ghost&&this.view.state.doc.nodeAt(ghost.pos);if(!regular(table))return;
    const ctx={...ghost,table};let handled=true;
    if(event.key==='ArrowDown'){
      if(ctx.axis==='row'||ctx.axis==='corner')this.leaveTable(ctx);
      else if(ctx.row+1<table.childCount)this.focusGhost(ctx,'column',ctx.row+1,ctx.col);
      else this.focusGhost(ctx,'row',table.childCount,table.firstChild.childCount-1);
    }else if(event.key==='ArrowRight'){
      if(ctx.axis==='column'||ctx.axis==='corner'){
        if(ctx.row+1<table.childCount)this.selectCell(ctx,ctx.row+1,0);
        else if(ctx.axis==='column')this.focusGhost(ctx,'row',table.childCount,0);else this.leaveTable(ctx);
      }else if(ctx.col+1<table.firstChild.childCount)this.focusGhost(ctx,'row',ctx.row,ctx.col+1);else this.leaveTable(ctx);
    }else if(event.key==='ArrowLeft'){
      if(ctx.axis==='column')this.selectCell(ctx,ctx.row,table.firstChild.childCount-1,true);
      else if(ctx.col>0)this.focusGhost(ctx,'row',ctx.row,ctx.col-1);else this.selectCell(ctx,table.childCount-1,0,true);
    }else if(event.key==='ArrowUp'){
      if(ctx.axis==='row'||ctx.axis==='corner')this.selectCell(ctx,table.childCount-1,Math.min(ctx.col,table.firstChild.childCount-1));
      else if(ctx.row>0)this.focusGhost(ctx,'column',ctx.row-1,ctx.col);else this.selectCell(ctx,0,table.firstChild.childCount-1);
    }else if(event.key==='Escape')this.selectCell(ctx,Math.min(ctx.row,table.childCount-1),Math.min(ctx.col,table.firstChild.childCount-1),true);
    else if(event.key==='Tab'){
      if(event.shiftKey)this.selectCell(ctx,Math.min(ctx.row,table.childCount-1),Math.min(ctx.col,table.firstChild.childCount-1),true);
      else if(ctx.axis==='column'&&ctx.row+1<table.childCount)this.selectCell(ctx,ctx.row+1,0);else this.leaveTable(ctx);
    }else if(event.key==='Enter')this.leaveTable(ctx);
    else handled=false;
    if(handled){event.preventDefault();event.stopPropagation();}
  }
  materialize(input,text){
    const pos=Number(input.dataset.tablePos),table=this.view.state.doc.nodeAt(pos);if(!regular(table)||!text)return;
    const axis=input.dataset.ghostAxis,row=Number(input.dataset.ghostRow),col=Number(input.dataset.ghostCol),schema=this.view.state.schema;
    const addCol=axis==='column'||axis==='corner',addRow=axis==='row'||axis==='corner';
    const cols=table.firstChild.childCount+(addCol?1:0),rows=[];
    const content=(r,c)=>{
      if(r!==row||c!==col)return [schema.nodes.paragraph.create()];
      const fragments=[];String(text).split(/\r?\n/).forEach((line,i)=>{if(i)fragments.push(schema.nodes.hardBreak.create());if(line)fragments.push(schema.text(line));});
      return [schema.nodes.paragraph.create(null,fragments)];
    };
    for(let r=0;r<table.childCount+(addRow?1:0);r++){
      const old=r<table.childCount?table.child(r):null,cells=[];
      for(let c=0;c<cols;c++){
        if(old&&c<old.childCount)cells.push(old.child(c));
        else{
          const type=old?.firstChild.type.name==='tableHeader'?schema.nodes.tableHeader:schema.nodes.tableCell;
          cells.push(type.create(null,content(r,c)));
        }
      }
      rows.push(schema.nodes.tableRow.create(old?.attrs,cells));
    }
    const next=table.type.create(table.attrs,rows,table.marks);this.ghost=null;input.value='';
    let tr=this.view.state.tr.replaceWith(pos,pos+table.nodeSize,next).setMeta(EXPAND,true);
    const target=cellPosition(next,pos,row,col)+2+String(text).replace(/\r\n/g,'\n').length;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target,tr.doc.content.size)),-1));
    this.view.dispatch(tr.scrollIntoView());this.view.focus();this.schedule();
  }
  key(event){
    if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing||!this.view.state.selection.empty)return false;
    const ctx=context(this.view.state);if(!ctx)return false;
    const sel=this.view.state.selection,atEnd=sel.head===ctx.cellPos+ctx.cell.nodeSize-2;
    if(event.key==='ArrowRight'&&atEnd){
      if(ctx.col===ctx.table.firstChild.childCount-1)return this.focusGhost(ctx,'column',ctx.row,ctx.table.firstChild.childCount);
      return this.selectCell(ctx,ctx.row,ctx.col+1);
    }
    if(event.key==='ArrowDown'&&ctx.row===ctx.table.childCount-1&&this.view.endOfTextblock('down'))return this.focusGhost(ctx,'row',ctx.table.childCount,ctx.col);
    return false;
  }
  destroy(){
    this.destroyed=true;cancelAnimationFrame(this.frame);this.overlay.remove();this.resize.disconnect();this.mutations.disconnect();
    this.container.removeEventListener('scroll',this.schedule);window.removeEventListener('resize',this.schedule);
    document.removeEventListener('focusin',this.onFocus);document.removeEventListener('focusout',this.onFocus);document.removeEventListener('pointerdown',this.onPointer,true);
  }
}

export const ExpandableTables=Extension.create({
  name:'expandableTables',priority:1100,
  addProseMirrorPlugins(){
    let controller,plugin;
    plugin=new Plugin({
      state:{init:()=>[],apply:(tr,old)=>tr.getMeta(LAYOUT)??(tr.docChanged?[]:old)},
      props:{
        decorations(state){
          return DecorationSet.create(state.doc,(plugin.getState(state)||[]).flatMap(item=>{
            const node=state.doc.nodeAt(item.pos);if(node?.type.name!=='table')return [];
            const style=`width:${item.width}px;max-width:100%;${item.ghostHeight?`margin-bottom:${item.ghostHeight+20}px;`:''}`;
            return [Decoration.node(item.pos,item.pos+node.nodeSize,{class:'markpad-responsive-table',style})];
          }));
        },
        handleKeyDown(view,event){return controller?.key(event)||false;},
        handleDOMEvents:{focus(){controller?.schedule();return false;},blur(){controller?.schedule();return false;}}
      },
      appendTransaction:pruneCleared,
      view(view){controller=new TableGhostView(view,plugin);return controller;}
    });return [plugin];
  }
});
