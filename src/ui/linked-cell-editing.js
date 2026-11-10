import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {cellLinkId} from '../core/linked-cells.js';

/** A full-value replacement must retain its cell binding, unlike ordinary web
 * links where replacing a whole label commonly removes the non-inclusive mark. */
export const LinkedCellEditing=Extension.create({
  name:'linkedCellEditing',
  addProseMirrorPlugins(){return [new Plugin({
    appendTransaction(transactions,oldState,newState){
      if(!transactions.some(t=>t.docChanged)||transactions.some(t=>t.getMeta('markpad-link-sync')||t.getMeta('markpad-link-mark')))return null;
      const sel=oldState.selection;if(sel.empty)return null;
      let link=null,covered=sel.from,invalid=false;
      oldState.doc.nodesBetween(sel.from,sel.to,(node,pos)=>{
        if(!node.isText)return;
        const mark=node.marks.find(m=>m.type.name==='link'&&cellLinkId(m.attrs.href));
        if(!mark||(link&&mark.attrs.href!==link.attrs.href)||pos>covered){invalid=true;return;}
        link=mark;covered=Math.min(sel.to,pos+node.nodeSize);
      });
      if(invalid||!link||covered<sel.to)return null;
      let from=sel.from,to=sel.to;
      for(const tr of transactions){from=tr.mapping.map(from,-1);to=tr.mapping.map(to,1);}
      if(to<=from||!newState.doc.textBetween(from,to))return null;
      return newState.tr.addMark(from,to,link).ensureMarks([...(newState.storedMarks||[]).filter(mark=>mark.type.name!=='link'),link]).setMeta('markpad-link-mark',true);
    }
  })];}
});
