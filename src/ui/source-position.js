/** Maps a plain Markdown source offset onto the corresponding WYSIWYG text
 * offset and back. Formatting markers have no cursor position in rich mode. */
function visibleSource(source) {
  const characters=[], offsets=[];
  let fence=null,position=0;
  for(const line of String(source).split('\n')) {
    const start=position;
    position+=line.length+1;
    const open=line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/);
    if(fence) {
      const close=line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if(close&&close[1][0]===fence[0]&&close[1].length>=fence.length){fence=null;continue;}
    } else if(open) {fence=open[1];continue;}
    let prefix=0;
    if(!fence){
      // Markdown block decorations do not appear as editable characters.
      const marker=line.match(/^\s{0,3}(?:(?:>\s*)+|#{1,6}\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)/);
      if(marker)prefix=marker[0].length;
      if(/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(line))continue;
    }
    let inlineCode=false;
    for(let i=prefix;i<line.length;i++){
      const ch=line[i];
      if(!fence){
        if(line.startsWith('<u>',i)){i+=2;continue;}
        if(line.startsWith('</u>',i)){i+=3;continue;}
        if(ch==='\\'&&/^[\\`*_{}\[\]()#+.!~>|-]$/.test(line[i+1]||'')){i++;}
        else if(ch==='`'){inlineCode=!inlineCode;continue;}
        else if(!inlineCode){
          if(ch==='['||ch===']'){
            if(ch===']'&&line[i+1]==='('){let depth=1,j=i+2;
              while(j<line.length&&depth){if(line[j]==='(')depth++;else if(line[j]===')')depth--;j++;}
              if(!depth){i=j-1;continue;}
            }
            if(ch==='[')continue;
          }
          if(ch==='*'||ch==='~'||(ch==='_'&&(line[i-1]==='_'||line[i+1]==='_'||!/[\w]/.test(line[i-1]||'')||!/[\w]/.test(line[i+1]||''))))continue;
        }
      }
      characters.push(line[i]);offsets.push(start+i);
    }
    characters.push('\n');offsets.push(start+line.length);
  }
  return {plain:characters.join(''),offsets};
}

function codeUnits(block,blockStart){
  const result=[];
  block.forEach((child,offset)=>{
    const start=blockStart+offset;
    if(child.isText){for(let i=0;i<child.text.length;i++)result.push({char:child.text[i],pm:start+i});}
    else if(child.type.name==='hardBreak')result.push({char:'\n',pm:start});
    else if(child.type.name==='image')result.push({char:'\uFFFC',pm:start});
  });
  return result;
}

/** Returns a compact, ascending pair index; no quadratic edit-distance matrix. */
export function mapDocumentPositions(source,doc){
  const {plain,offsets}=visibleSource(source);
  const pairs=[];
  let cursor=0;
  doc.descendants((node,pos)=>{
    if(!node.isTextblock)return;
    const units=codeUnits(node,pos+1),text=units.map(unit=>unit.char).join('');
    if(!text)return false;
    let found=plain.indexOf(text,cursor);
    if(found<0){
      // Soft Markdown wraps can become a space or a hard break in ProseMirror.
      // Match all other characters monotonically, preserving later positions.
      let point=cursor;
      for(const unit of units){
        const wanted=unit.char;
        let next=plain.indexOf(wanted,point);
        if(next<0&&/\s/.test(wanted))next=point;
        if(next<0)break;
        pairs.push({pm:unit.pm,raw:offsets[Math.min(next,offsets.length-1)]??source.length});
        point=Math.min(plain.length,next+1);
      }
      cursor=point;
    }else{
      for(let i=0;i<units.length;i++)pairs.push({pm:units[i].pm,raw:offsets[found+i]??source.length});
      cursor=found+units.length;
    }
    return false;
  });
  return {
    pairs,
    sourceLength:source.length,
    pmLength:doc.content.size,
    toRaw(pm){
      if(!pairs.length)return Math.min(source.length,Math.max(0,pm));
      for(let i=0;i<pairs.length;i++){
        if(pairs[i].pm>=pm)return pairs[i].pm===pm?pairs[i].raw:(i===0?pairs[0].raw:pairs[i-1].raw+1);
      }
      return Math.min(source.length,pairs.at(-1).raw+1);
    },
    toRich(raw){
      if(!pairs.length)return Math.min(doc.content.size,Math.max(0,raw));
      for(let i=0;i<pairs.length;i++){
        if(pairs[i].raw>=raw)return pairs[i].pm;
      }
      return Math.min(doc.content.size,pairs.at(-1).pm+1);
    },
  };
}
