/** Small, offline fenced-code highlighter. Decorations add color in formatted
 * mode; they never alter the text or the saved Markdown. */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import {tokenizeCode} from './code-lexer.js';

export const CodeHighlight = Extension.create({
  name: 'markpadCodeHighlight',
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
    const plugin=new Plugin({state:{init:(_,state)=>compute(state),apply:(tr,old,_previous,state)=>tr.docChanged?compute(state):old},props:{decorations:state=>plugin.getState(state)}});
    return [plugin];
  }
});
