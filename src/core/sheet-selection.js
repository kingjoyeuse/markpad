/** Compact header selection: even selecting a million rows stores one span. */
export function normalizeSpans(spans) {
  const sorted=spans.map(([a,b])=>[Math.min(a,b),Math.max(a,b)]).sort((a,b)=>a[0]-b[0]);
  const result=[];
  for(const [a,b] of sorted){const last=result.at(-1);if(last&&a<=last[1]+1)last[1]=Math.max(last[1],b);else result.push([a,b]);}
  return result;
}
export function axisContains(selection,index){return Boolean(selection?.spans.some(([a,b])=>index>=a&&index<=b));}
export function axisCount(selection){return selection?.spans.reduce((sum,[a,b])=>sum+b-a+1,0)||0;}
export function axisIndices(selection,limit=10000){
  if(axisCount(selection)>limit)throw Error(`Use up to ${limit.toLocaleString()} selected rows or columns for this operation.`);
  return selection.spans.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i));
}
export function selectAxis(previous,axis,index,{control=false,shift=false}={}){
  const prior=previous?.axis===axis?previous:null;
  if(shift&&prior){const span=[Math.min(prior.anchor,index),Math.max(prior.anchor,index)];return {axis,anchor:prior.anchor,spans:normalizeSpans(control?[...prior.spans,span]:[span])};}
  if(control&&prior){
    let spans;
    if(axisContains(prior,index))spans=prior.spans.flatMap(([a,b])=>index<a||index>b?[[a,b]]:[...(a<index?[[a,index-1]]:[]),...(b>index?[[index+1,b]]:[])]);
    else spans=normalizeSpans([...prior.spans,[index,index]]);
    return spans.length?{axis,anchor:index,spans}:null;
  }
  return {axis,anchor:index,spans:[[index,index]]};
}
