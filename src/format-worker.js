/* Markdown parsing runs off the UI thread. Never reads files or runs content as code. */
importScripts('editor-runtime.js');
const {MarkdownManager,StarterKit,TableKit,TaskList,TaskItem,Image}=globalThis.MarkpadVendor;
const manager=new MarkdownManager({extensions:[
  StarterKit.configure({underline:true,link:{openOnClick:false,autolink:false,markdownLinks:true,defaultProtocol:'https',isAllowedUri:uri=>/^(https?:\/\/|mailto:|#)/i.test(uri)}}),
  TableKit.configure({table:{resizable:false}}),TaskList,TaskItem.configure({nested:true}),Image.configure({allowBase64:true})
],markedOptions:{gfm:true},indentation:{style:'space',size:2}});
self.onmessage=({data})=>{
 const {id,source}=data;
 try{const start=performance.now();const doc=manager.parse(source);self.postMessage({id,doc,parseMs:performance.now()-start});}
 catch(error){self.postMessage({id,error:String(error.message||error)});}
};
