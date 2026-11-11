import {tokenizeCode} from './code-lexer.js';

const previewTags = new Set([
  'details', 'summary', 'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'u',
  's', 'del', 'sub', 'sup', 'mark', 'code', 'pre', 'br', 'hr', 'ul', 'ol',
  'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

// Rebuild only supported, static markup. Template contents stay inert and
// are never attached. The original source is kept separately on the node.
function safePreview(source) {
  if (source.length > 32768) return null;
  const template = document.createElement('template');
  template.innerHTML = source;
  function copy(node, depth = 0) {
    if (depth > 64) return null;
    if (node.nodeType === 3) return document.createTextNode(node.data);
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !previewTags.has(node.localName)) return null;
    const element = document.createElement(node.localName);
    for (const {name, value} of node.attributes) {
      if (node.localName !== 'details' || name !== 'open') return null;
      element.setAttribute(name, value);
    }
    for (const child of node.childNodes) {
      const safe = copy(child, depth + 1);
      if (!safe) return null;
      element.append(safe);
    }
    return element;
  }
  const fragment = document.createDocumentFragment();
  for (const child of template.content.childNodes) {
    const safe = copy(child);
    if (!safe) return null;
    fragment.append(safe);
  }
  return fragment.firstElementChild ? fragment : null;
}

function htmlNodeView({node, editor, getPos}, inline) {
  const dom = document.createElement(inline ? 'span' : 'div');
  dom.className = inline ? 'html-source-inline' : 'html-source-block';
  dom.contentEditable = 'false';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.setAttribute('aria-label', 'Edit HTML source');
  edit.title = 'Edit HTML source';
  const input = document.createElement('textarea');
  input.setAttribute('aria-label', 'HTML source');
  input.spellcheck = false;
  input.wrap = 'off';
  const sourceEditor = document.createElement('span');
  sourceEditor.className = 'html-source-editor';
  const overlay = document.createElement('pre');
  overlay.setAttribute('aria-hidden', 'true');
  sourceEditor.append(overlay,input);
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'Done';
  let editing = false;

  function highlight(element, source) {
    const tokens=source.length<=200000?tokenizeCode(source,'html'):[];
    const fragment=document.createDocumentFragment();
    let end=0;
    for(const token of tokens){
      fragment.append(source.slice(end,token.start));
      const span=document.createElement('span');
      span.className='mp-syntax-'+token.type;
      span.textContent=source.slice(token.start,token.end);
      fragment.append(span);
      end=token.end;
    }
    fragment.append(source.slice(end));
    element.replaceChildren(fragment);
    return tokens.length>0;
  }
  function alignSource(){overlay.scrollTop=input.scrollTop;overlay.scrollLeft=input.scrollLeft;}
  function paintSource(){
    sourceEditor.classList.toggle('highlighted',highlight(overlay,input.value+'\n'));
    alignSource();
  }

  function display() {
    editing = false;
    dom.draggable = dom.classList.contains('ProseMirror-selectednode');
    const preview = inline ? null : safePreview(node.attrs.source);
    const code = document.createElement('code');
    highlight(code,node.attrs.source);
    if (inline) {
      edit.replaceChildren(code);
      dom.replaceChildren(edit);
    } else {
      const body = document.createElement(preview ? 'div' : 'pre');
      body.append(preview || code);
      edit.textContent = 'Edit HTML';
      dom.replaceChildren(body, edit);
    }
  }

  edit.addEventListener('click', () => {
    editing = true;
    dom.draggable = false;
    input.value = node.attrs.source;
    dom.replaceChildren(sourceEditor, done);
    paintSource();
    input.focus();
  });
  input.addEventListener('mousedown', event => event.stopPropagation());
  dom.addEventListener('dragstart', event => {
    if (editing) event.preventDefault();
  });
  input.addEventListener('input', () => {
    paintSource();
    const pos = getPos();
    if (typeof pos === 'number') {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {source: input.value}));
    }
  });
  input.addEventListener('scroll',alignSource);
  done.addEventListener('click', () => {
    display();
    edit.focus();
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' || (event.ctrlKey && event.key === 'Enter')) {
      event.preventDefault();
      done.click();
    }
  });
  display();
  return {
    dom,
    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
      dom.draggable = !editing;
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
      dom.draggable = false;
    },
    stopEvent: event => event.target !== dom,
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      if (!editing) display();
      else if (input.value !== next.attrs.source.replace(/\r\n?/g, '\n')){input.value=next.attrs.source;paintSource();}
      return true;
    },
  };
}

const registered = new WeakSet();

export function htmlSourceExtensions(Node, MarkdownManager) {
  const marked = new MarkdownManager().instance;
  if (!registered.has(marked)) {
    registered.add(marked);
    // Keep Marked's own HTML grammar and precedence. Rename its tokens before
    // Tiptap tries to convert the HTML to ordinary rich-text nodes.
    const tokenizer = marked.Tokenizer.prototype;
    marked.use({tokenizer: {
      html(source) {
        const token = tokenizer.html.call(this, source);
        return token ? {...token, type: 'htmlSourceBlock'} : false;
      },
      tag(source) {
        const token = tokenizer.tag.call(this, source);
        if (!token) return false;
        const rawText = token.raw.match(/^<(script|style|textarea|pre)(?:[\s/>])/i);
        if (rawText) {
          const rest = source.slice(token.raw.length);
          const close = new RegExp('</' + rawText[1] + '\\s*>', 'i').exec(rest);
          token.raw = close ? source.slice(0, token.raw.length + close.index + close[0].length) : source;
          this.lexer.state.inRawBlock = false;
        }
        return {...token, type: 'htmlSourceInline'};
      },
    }});
  }

  return [false, true].map(inline => {
    const name = inline ? 'htmlSourceInline' : 'htmlSourceBlock';
    const tag = inline ? 'span' : 'div';
    return Node.create({
      name,
      group: inline ? 'inline' : 'block',
      inline,
      atom: true,
      addAttributes: () => ({source: {default: '', rendered: false}}),
      parseHTML: () => [{tag: tag + '[data-markpad-html]', getAttrs: element => ({source: element.textContent})}],
      renderHTML: ({node}) => [tag, {'data-markpad-html': ''}, node.attrs.source],
      renderText: ({node}) => node.attrs.source,
      addNodeView: () => props => htmlNodeView(props, inline),
      parseMarkdown: (token, helpers) => helpers.createNode(name, {source: inline ? token.raw : token.raw.replace(/\n+$/, '')}),
      renderMarkdown: node => node.attrs.source,
    });
  });
}
