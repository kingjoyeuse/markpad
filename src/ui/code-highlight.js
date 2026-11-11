/** Small, offline fenced-code highlighter. Decorations add color in formatted
 * mode; they never alter the text or the saved Markdown. */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import {codeLanguage,codeLanguages,tokenizeCode} from './code-lexer.js';

let pickerId=0;
const languages=[{value:'',label:'Plain text'},...codeLanguages.map(value=>({value,label:value}))];

function languagePicker(applyLanguage) {
  const dom=document.createElement('span');
  dom.className='code-language-picker';
  dom.contentEditable='false';
  const input=document.createElement('input');
  input.className='code-language';
  input.setAttribute('aria-label','Code language');
  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-expanded','false');
  input.placeholder='Plain text';
  input.spellcheck=false;
  input.autocomplete='off';
  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='code-language-toggle';
  toggle.setAttribute('aria-label','Show code languages');
  toggle.textContent='▾';
  const menu=document.createElement('div');
  menu.className='code-language-menu';
  menu.id='code-language-menu-'+(++pickerId);
  menu.setAttribute('role','listbox');
  menu.setAttribute('aria-label','Supported code languages');
  menu.hidden=true;
  input.setAttribute('aria-controls',menu.id);
  dom.append(input,toggle,menu);
  let current='',matches=[],active=-1;

  function close() {
    menu.hidden=true;
    menu.replaceChildren();
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
    toggle.setAttribute('aria-label','Show code languages');
  }
  function choose(value) {
    close();
    current=value;
    input.value=value;
    applyLanguage(value||null);
  }
  function highlight(index) {
    active=index;
    for(const [i,option] of [...menu.children].entries())option.setAttribute('aria-selected',String(i===active));
    if(active<0)input.removeAttribute('aria-activedescendant');
    else {
      const option=menu.children[active];
      input.setAttribute('aria-activedescendant',option.id);
      option.scrollIntoView({block:'nearest'});
    }
  }
  function open(query='') {
    const alias=codeLanguage(query);
    matches=languages.filter(({value,label})=>label.toLowerCase().includes(query)||(value&&value===alias));
    menu.replaceChildren();
    for(const [i,{value,label}] of matches.entries()){
      const option=document.createElement('button');
      option.type='button';
      option.tabIndex=-1;
      option.id=menu.id+'-'+i;
      option.setAttribute('role','option');
      option.setAttribute('aria-selected','false');
      option.textContent=label;
      option.addEventListener('click',()=>choose(value));
      menu.append(option);
    }
    if(!matches.length){const empty=document.createElement('span');empty.textContent='No matching languages';menu.append(empty);}
    menu.hidden=false;
    active=-1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label','Hide code languages');
  }
  input.addEventListener('focus',()=>{input.select();open();});
  input.addEventListener('click',()=>{if(menu.hidden)open();});
  input.addEventListener('input',()=>open(input.value.trim().toLowerCase()));
  input.addEventListener('blur',()=>{
    const value=input.value.trim().toLowerCase();
    if(value!==current&&(codeLanguage(value)||value===''))choose(codeLanguage(value)||'');
    else {close();input.value=current;}
  });
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      if(menu.hidden)open();
      if(matches.length)highlight(active<0?(event.key==='ArrowDown'?0:matches.length-1):
        (active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length);
    }else if(event.key==='Enter'){
      event.preventDefault();
      const typed=input.value.trim().toLowerCase();
      if(active<0&&typed===current.toLowerCase()){close();return;}
      const value=active>=0?matches[active]?.value:codeLanguage(typed)??(typed===''?'':matches[0]?.value);
      if(value!==undefined)choose(value);
    }else if(event.key==='Escape'&&!menu.hidden){
      event.preventDefault();
      close();
      input.value=current;
    }
  });
  menu.addEventListener('mousedown',event=>event.preventDefault());
  toggle.addEventListener('mousedown',event=>event.preventDefault());
  toggle.addEventListener('click',()=>{
    if(!menu.hidden){close();input.value=current;return;}
    input.focus();
    open();
  });
  return {
    dom,
    update(value){if((value||'')!==current){current=value||'';input.value=current;}},
  };
}

function codeBlockView(initial, view, getPos, copyText) {
  let node=initial;
  const dom=document.createElement('div');
  dom.className='code-block-shell';
  const picker=languagePicker(language=>{
    const pos=getPos();
    if(typeof pos==='number'&&language!==node.attrs.language){
      view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,language}));
    }
  });
  const pre=document.createElement('pre');
  const contentDOM=document.createElement('code');
  const copy=document.createElement('button');
  copy.type='button';
  copy.className='code-copy';
  copy.contentEditable='false';
  copy.setAttribute('aria-label','Copy code block');
  copy.title='Copy code block';
  copy.textContent='⧉';
  pre.append(contentDOM,copy);
  dom.append(picker.dom,pre);

  function updateLanguage() {
    picker.update(node.attrs.language);
    contentDOM.className=node.attrs.language?'language-'+node.attrs.language:'';
  }
  copy.addEventListener('mousedown',event=>event.preventDefault());
  copy.addEventListener('click',()=>copyText(node.textContent));
  updateLanguage();
  return {
    dom,contentDOM,
    update(next){if(next.type!==node.type)return false;node=next;updateLanguage();return true;},
    stopEvent:event=>picker.dom.contains(event.target)||event.target===copy,
    ignoreMutation:mutation=>mutation.type!=='selection'&&!contentDOM.contains(mutation.target),
  };
}

export const CodeHighlight = Extension.create({
  name: 'markpadCodeHighlight',
  addOptions:()=>({copyText:()=>{}}),
  addProseMirrorPlugins(){
    const compute=state=>{
      const decorations=[];
      state.doc.descendants((node,pos)=>{
        if (node.type.name !== 'codeBlock' || !node.attrs.language) return;
        const base=pos+1;
        for(const t of tokenizeCode(node.textContent,node.attrs.language))
          decorations.push(Decoration.inline(base+t.start,base+t.end,{class:`mp-syntax-${t.type}`}));
      });
      return DecorationSet.create(state.doc,decorations);
    };
    const copyText=this.options.copyText;
    const plugin=new Plugin({state:{init:(_,state)=>compute(state),apply:(tr,old,_previous,state)=>tr.docChanged?compute(state):old},props:{
      decorations:state=>{
        const set=plugin.getState(state),{selection,storedMarks,schema}=state;
        if(!selection.empty||!schema.marks.code.isInSet(storedMarks||[])||schema.marks.code.isInSet(selection.$from.marks()))return set;
        // The blank inline code slot belongs to the view. It never changes the
        // Markdown, document history, or dirty state before the user types.
        return set.add(state.doc,[Decoration.widget(selection.from,()=>{
          const slot=document.createElement('span');
          slot.className='inline-code-placeholder';
          slot.setAttribute('aria-hidden','true');
          return slot;
        },{key:'inline-code-placeholder',side:1,ignoreSelection:true})]);
      },
      nodeViews:{codeBlock:(node,view,getPos)=>codeBlockView(node,view,getPos,copyText)},
    }});
    return [plugin];
  }
});
