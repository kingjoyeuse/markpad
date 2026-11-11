/** Small, offline fenced-code highlighter. Decorations add color in formatted
 * mode; they never alter the text or the saved Markdown. */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import {codeLanguage,codeLanguages,tokenizeCode} from './code-lexer.js';

function codeBlockView(initial, view, getPos, copyText) {
  let node=initial;
  const dom=document.createElement('div');
  dom.className='code-block-shell';
  const input=document.createElement('input');
  input.className='code-language';
  input.contentEditable='false';
  input.setAttribute('list','code-languages');
  input.setAttribute('aria-label','Code language');
  input.placeholder='Plain text';
  input.spellcheck=false;
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
  dom.append(input,pre);

  function updateLanguage() {
    input.value=node.attrs.language||'';
    contentDOM.className=node.attrs.language?'language-'+node.attrs.language:'';
  }
  function commit(allowPrefix=false) {
    const value=input.value.trim().toLowerCase();
    const language=value&&(codeLanguage(value)||(allowPrefix&&codeLanguages.find(name=>name.startsWith(value))));
    if(value&&!language){updateLanguage();return;}
    const pos=getPos();
    if(typeof pos==='number'&&(language||null)!==node.attrs.language){
      view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,language:language||null}));
    }
    updateLanguage();
  }
  input.addEventListener('focus',()=>input.select());
  input.addEventListener('change',()=>commit());
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();commit(true);input.blur();}
    if(event.key==='Escape'){updateLanguage();input.blur();}
  });
  copy.addEventListener('mousedown',event=>event.preventDefault());
  copy.addEventListener('click',()=>copyText(node.textContent));
  updateLanguage();
  return {
    dom,contentDOM,
    update(next){if(next.type!==node.type)return false;node=next;updateLanguage();return true;},
    stopEvent:event=>event.target===input||event.target===copy,
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
      decorations:state=>plugin.getState(state),
      nodeViews:{codeBlock:(node,view,getPos)=>codeBlockView(node,view,getPos,copyText)},
      view(){
        const list=document.createElement('datalist');
        list.id='code-languages';
        for(const language of codeLanguages){const option=document.createElement('option');option.value=language;list.append(option);}
        document.body.append(list);
        return {destroy:()=>list.remove()};
      },
    }});
    return [plugin];
  }
});
