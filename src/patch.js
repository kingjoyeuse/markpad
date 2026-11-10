/* Markpad UI enhancements. Plain browser script so the portable runtime can be
   updated without rebuilding third-party editor dependencies. Editor instances
   stay owned by src/main.js; this module only uses its narrow markpadApp bridge. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let installed = false;
  let edit = null;
  let platform = null;
  let zoom = 100;
  let wordWrap = true;
  let wheelPixels = 0;
  let statusPending = false;
  let cachedKey=null,cachedText='',cachedTotals=null;

  const count = text => {
    const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
    return {
      chars: normalized.length,
      words: normalized.trim() ? (normalized.trim().match(/\S+/gu) || []).length : 0,
      lines: normalized.split('\n').length,
    };
  };
  const number = value => value.toLocaleString();
  const totals = ({ chars, words, lines }) =>
    `${number(chars)} chars · ${number(words)} words · ${number(lines)} ${lines === 1 ? 'line' : 'lines'}`;

  function updateStatus() {
    statusPending = false;
    if (!edit) return;
    const selection = edit.selection();
    const raw = edit.mode === 'raw';
    const pm = !raw && edit.editor?.state;
    const key=raw?edit.raw.value:pm.doc;
    if(key!==cachedKey){cachedKey=key;cachedText=raw?edit.raw.value:pm.doc.textBetween(0,pm.doc.content.size,'\n','\uFFFC');cachedTotals=count(cachedText);}
    const documentText=cachedText;
    const caret = raw
      ? (edit.raw.selectionDirection === 'backward' ? edit.raw.selectionStart : edit.raw.selectionEnd)
      : pm.selection.head;
    const before = raw
      ? documentText.slice(0, caret)
      : pm.doc.textBetween(0, Math.max(0, Math.min(caret, pm.doc.content.size)), '\n', '\uFFFC');
    const normalized = before.replace(/\r\n?/g, '\n');
    const line = normalized.split('\n').length;
    const column = normalized.length - normalized.lastIndexOf('\n');
    $('#caret-position').textContent = `Ln ${number(line)}, Col ${number(column)}`;
    $('#document-totals').textContent = totals(cachedTotals);
    const selected = selection.from !== selection.to;
    const selectionElement = $('#selected-totals');
    selectionElement.hidden = !selected;
    if (selected) selectionElement.textContent = `Sel: ${totals(count(selection.text))}`;
  }

  function scheduleStatus() {
    if (statusPending) return;
    statusPending = true;
    requestAnimationFrame(updateStatus);
  }

  function setWordWrap(enabled) {
    wordWrap = Boolean(enabled);
    document.documentElement.classList.toggle('no-word-wrap', !wordWrap);
    const button = $('#word-wrap-button');
    button.setAttribute('aria-pressed', String(wordWrap));
    button.textContent = wordWrap ? 'Wrap on' : 'Wrap off';
    button.title = `Word wrap: ${wordWrap ? 'On' : 'Off'}`;
    if (platform?.setWordWrap) Promise.resolve(platform.setWordWrap(wordWrap)).catch(console.error);
    window.markpadApp?.sheet?.()?.refresh?.();
  }

  function applyZoom(value) {
    const next = Math.max(50, Math.min(300, Math.round(value / 10) * 10));
    if (next === zoom) return;
    zoom = next;
    $('#zoom-button').textContent = `${zoom}%`;
    if (platform?.setZoom) {
      Promise.resolve(platform.setZoom(zoom)).then(() => window.markpadApp?.sheet?.()?.refresh?.()).catch(error => console.error('Zoom failed:', error));
    } else {
      // File preview / browser fallback: keep the status bar inside the viewport.
      document.body.style.zoom = `${zoom}%`;
      $('#app').style.height = `${(10000 / zoom).toFixed(4)}vh`;
      window.markpadApp?.sheet?.()?.refresh?.();
    }
  }

  function ctrlWheel(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    if (Math.abs(delta) >= 40) {
      wheelPixels = 0;
      applyZoom(zoom + (delta < 0 ? 10 : -10));
      return;
    }
    wheelPixels += delta;
    if (Math.abs(wheelPixels) >= 55) {
      applyZoom(zoom + (wheelPixels < 0 ? 10 : -10));
      wheelPixels = 0;
    }
  }

  function documentFocused(target) {
    return Boolean(target?.closest?.('#document-pane'));
  }

  // Use the same formatting commands as the toolbar rather than maintaining a
  // second Markdown transformation path. No shortcut operates in tool inputs.
  function formattingHotkeys(event) {
    if (!edit || event.isComposing || event.keyCode === 229 || event.defaultPrevented || $('#modal')?.open) return;
    if (!documentFocused(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    const code = event.code;
    let format = null;
    if (!event.altKey && !event.shiftKey) {
      const keys = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline', KeyE: 'code' };
      format = keys[code] || null;
      // Ctrl+K is already the user-friendly link dialog in the main editor.
    } else if (!event.altKey && event.shiftKey) {
      const keys = {
        KeyX: 'strike', KeyL: 'bulletList', Digit7: 'orderedList',
        Digit8: 'bulletList', Digit9: 'blockquote', KeyC: 'codeBlock',
      };
      format = keys[code] || null;
    } else if (event.altKey && !event.shiftKey) {
      const keys = { Digit1: 'h1', Digit2: 'h2', Digit3: 'h3' };
      format = keys[code] || null;
    }
    if (!format) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (format === 'underline' && edit.mode === 'raw') {
      // Markdown encodes underline using inline HTML, which Tiptap's built-in
      // underline Markdown tokenizer understands and round-trips on reopen.
      const selection = edit.selection();
      const before = edit.raw.value;
      const current = selection.text;
      if (current.startsWith('<u>') && current.endsWith('</u>')) {
        edit.insertText(current.slice(3, -4));
      } else {
        edit.insertText(`<u>${current || 'text'}</u>`);
        edit.raw.setSelectionRange(selection.from + 3, selection.from + 3 + (current || 'text').length);
        edit.onSelection?.();
      }
    } else if (format === 'underline') {
      edit.editor.chain().focus().toggleUnderline().run();
    } else {
      edit.format(format);
    }
    scheduleStatus();
  }

  function install() {
    if (installed || !window.markpadApp?.editor?.()) return;
    edit = window.markpadApp.editor();
    platform = window.markpadApp.platform?.();
    installed = true;

    const previousSelection = edit.onSelection;
    edit.onSelection = (...args) => { previousSelection?.(...args); scheduleStatus(); };
    const previousChange = edit.onChange;
    edit.onChange = (...args) => { previousChange?.(...args); scheduleStatus(); };

    $('#word-wrap-button').addEventListener('click', () => setWordWrap(!wordWrap));
    $('#zoom-button').addEventListener('click', () => applyZoom(100));
    document.addEventListener('wheel', ctrlWheel, { capture: true, passive: false });
    document.addEventListener('keydown', formattingHotkeys, true);
    platform?.onCommand?.(action => {
      if (action === 'word-wrap-toggle') setWordWrap(!wordWrap);
      if (action === 'zoom-in') applyZoom(zoom + 10);
      if (action === 'zoom-out') applyZoom(zoom - 10);
      if (action === 'zoom-reset') applyZoom(100);
    });
    setWordWrap(true);
    scheduleStatus();
    // Read-only view for test automation; not part of the persistence format.
    window.markpadUiInspect = Object.freeze({
      counts: () => ({ document: $('#document-totals').textContent, selection: $('#selected-totals').hidden ? '' : $('#selected-totals').textContent, caret: $('#caret-position').textContent }),
      zoom: () => zoom,
      wordWrap: () => wordWrap,
    });
  }

  document.addEventListener('markpad:ready', install, { once: true });
  if (window.markpadApp) install();
})();
