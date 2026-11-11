// Browser-only development fallback. The desktop host uses durable atomic files.
// localStorage is deliberately not described as the desktop recovery guarantee.
export function browserPlatform(notice){
  const prefix='markpad-preview-draft:';const params=new URLSearchParams(location.search);const id=params.get('session')||crypto.randomUUID();let state;let handle=null;let commands=()=>{};
  const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  const persist=()=>localStorage.setItem(prefix+id,JSON.stringify(state));
  return{
    async bootstrap(){state=read(prefix+id)||{id,name:'Untitled',path:null,markdown:'',dirty:false,theme:localStorage.getItem('markpad-theme')||'system',updatedAt:new Date().toISOString()};return{...state,recovered:Boolean(state.markdown),theme:localStorage.getItem('markpad-theme')||'system'};},
    async checkpoint(next){state={...state,...next,updatedAt:new Date().toISOString()};persist();return{updatedAt:state.updatedAt};},
    async save({markdown,saveAs}){
      if(window.showSaveFilePicker){try{if(!handle||saveAs)handle=await window.showSaveFilePicker({suggestedName:state.name==='Untitled'?'Untitled.md':state.name,types:[{description:'Markdown document',accept:{'text/markdown':['.md']}}]});const writer=await handle.createWritable();await writer.write(markdown);await writer.close();state.name=handle.name;state.path=handle.name;}catch(error){if(error.name==='AbortError')return{canceled:true};throw error;}}
      else{const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=state.name==='Untitled'?'Untitled.md':state.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);state.name=link.download;state.path=link.download;notice('Downloaded Markdown. The desktop app supports normal Save and Save As.');}
      state.markdown=markdown;state.dirty=false;persist();return{saved:true,name:state.name,path:state.path};
    },
    async open(){document.querySelector('#browser-open').click();},
    async newDocument(){location.href=location.pathname+'?session='+crypto.randomUUID();},
    async newWindow(){window.open(location.pathname+'?session='+crypto.randomUUID(),'_blank');},
    async listRecents(){return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(read).filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(row=>({...row,excerpt:row.markdown.slice(0,110),kind:row.path?'file':'draft'}));},
    async openRecent(nextId){window.open(location.pathname+'?session='+encodeURIComponent(nextId),'_blank');},
    async removeRecent(nextId){if(nextId===id)throw new Error('This draft is open. Close it before forgetting it.');localStorage.removeItem(prefix+nextId);},
    async setTheme(theme){localStorage.setItem('markpad-theme',theme);},
    async setTitle({name,dirty}){document.title=(dirty?'* ':'')+name+' — Markpad';},
    async close(){commands('prepare-close');},async readyToClose(){notice('Draft preserved. You can close this browser tab.');},
    onCommand(callback){commands=callback;return()=>{};},onTheme(callback){window.addEventListener('storage',event=>{if(event.key==='markpad-theme')callback(event.newValue||'system');});return()=>{};},
    async importFile(file){const nextId=crypto.randomUUID();const markdown=await file.text();localStorage.setItem(prefix+nextId,JSON.stringify({id:nextId,name:file.name,path:file.name,markdown,dirty:false,updatedAt:new Date().toISOString()}));location.href=location.pathname+'?session='+nextId;},
    async readClipboard(){return navigator.clipboard.readText();},async writeClipboard(text){return navigator.clipboard.writeText(text);}
  };
}
