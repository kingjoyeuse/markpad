# Third-party components

Markpad's editor uses the open-source Tiptap editor and its ProseMirror foundation. The packaged desktop runtime is Electron. These components retain their respective copyright and license terms.

The portable distribution includes Electron's `LICENSE`, `LICENSES.chromium.html`, and the JavaScript bundle's `main.js.LEGAL.txt`. Those files accompany the runtime and bundled code. The source distribution includes the exact npm dependency lockfile.

## Runtime and editor dependencies

| Component | Version | License | Upstream |
| --- | --- | --- | --- |
| @tiptap/core | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-blockquote | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-bold | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-bullet-list | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-code | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-code-block | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-document | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-dropcursor | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-gapcursor | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-hard-break | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-heading | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-horizontal-rule | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-image | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-italic | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-link | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-list | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-list-item | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-list-keymap | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-ordered-list | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-paragraph | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-placeholder | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-strike | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-table | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-task-item | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-task-list | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-text | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extension-underline | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/extensions | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/markdown | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/pm | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/starter-kit | 3.33.0 | MIT | https://github.com/ueberdosis/tiptap |
| linkifyjs | 4.4.0 | MIT | git+https://github.com/nfrasser/linkifyjs.git |
| marked | 17.0.6 | MIT | git://github.com/markedjs/marked.git |
| orderedmap | 2.1.1 | MIT | git+https://github.com/marijnh/orderedmap.git |
| prosemirror-changeset | 2.4.6 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-changeset.git |
| prosemirror-commands | 1.7.2 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-commands.git |
| prosemirror-dropcursor | 1.8.4 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-dropcursor.git |
| prosemirror-gapcursor | 1.4.1 | MIT | git://github.com/prosemirror/prosemirror-gapcursor.git |
| prosemirror-history | 1.5.1 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-history.git |
| prosemirror-inputrules | 1.5.1 | MIT | git://github.com/prosemirror/prosemirror-inputrules.git |
| prosemirror-keymap | 1.2.3 | MIT | git://github.com/prosemirror/prosemirror-keymap.git |
| prosemirror-model | 1.25.13 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-model.git |
| prosemirror-schema-list | 1.6.0 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-schema-list.git |
| prosemirror-state | 1.4.4 | MIT | git://github.com/prosemirror/prosemirror-state.git |
| prosemirror-tables | 1.8.5 | MIT | https://github.com/ProseMirror/prosemirror-tables.git |
| prosemirror-transform | 1.12.5 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-transform.git |
| prosemirror-view | 1.42.9 | MIT | git+https://code.haverbeke.berlin/prosemirror/prosemirror-view.git |
| rope-sequence | 1.3.4 | MIT | git+https://github.com/marijnh/rope-sequence.git |
| w3c-keyname | 2.2.8 | MIT | git+https://github.com/marijnh/w3c-keyname.git |

Electron 45.2.3 is distributed under its included MIT license and Chromium third-party notices. esbuild is a build-time tool under the MIT license.
