# Markpad project instructions

## Project and source of truth

Markpad is Joy's Windows-first, local Markdown notepad. The intended checkout is `C:\repos\markpad`, but scripts must work from any directory, including paths with spaces.

Read `README.md`, `docs/PROJECT_DESIGN.md`, `docs/PROJECT_PLAN.md`, and the relevant verification report before making changes. The user's latest instructions take precedence over the design. The original failed-project documents are historical material under `docs/archive/`; their checked boxes are not verification of this implementation.

The project root contains the source and a shortcut to `bin/Markpad.exe`. The Windows executable, supporting DLLs, `locales/`, and `resources/` must stay together under `bin/`. The EXE loads the production app from `bin/resources/app/`. Editing `src/` or `desktop/` alone does not update that runtime copy. Legacy projects with a root-level EXE are supported by the refresh script.

## Essential behavior

- Open directly into one editable document; Formatted mode is the normal default. Use the structured Tiptap/ProseMirror editor, not repeated whole-document `innerHTML` replacement.
- Preserve plain Markdown. Never silently remove unsupported Markdown, HTML, front matter, formulas, or raw-source edits. Conservative raw-mode fallback is preferable to a lossy conversion.
- Ctrl+Tab toggles Formatted/Raw. Theme choices are Light, Dark, System; System is the default.
- Calculator shortcuts require **Alt+Shift**. Spreadsheet shortcuts require **Alt+Ctrl**. Right sends from the document; Left and **NumpadEnter** insert into the remembered document selection/caret; Up/Down show/hide the relevant pane.
- **Alt+Ctrl+Shift+Right** appends ` = result` after a selected equation without opening a pane. Check this full modifier combination before the other groups. Main Enter is not keypad Enter.
- Both sidebar ribbon tabs toggle independently. Calculator is upper-right; spreadsheet is lower-right and reserves the calculator's vertical space even when it is hidden.
- Calculator values are transient. Worksheet values/formulas are document data. Spreadsheet sections are readable Markdown tables under named headings, with versioned hidden metadata for editable formulas. An untouched all-empty workbook adds nothing; customized dimensions or registered cell links are persisted even without populated cells.
- Unsaved notes and unsaved edits to saved files must remain recoverable from Recent after closing. Never silently overwrite an original file to implement recovery.
- New/another application launch supports independent document windows. Sharing the desktop coordinator reduces redundant runtime overhead; do not enforce a single document window.

## Safety and performance invariants

- Keep `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing. Renderer file access uses the narrow validated preload API. Do not add remote content or telemetry.
- Never evaluate expressions using JavaScript `eval`, `Function`, shell commands, or arbitrary property access. Keep the bounded expression interpreter.
- Final close must wait for a fresh durable checkpoint. A failed write keeps the window available. Save completion must not replace typing that happened while the save was pending.
- Use atomic file replacement and retain external-change detection. Decode UTF-8 strictly; do not silently replace invalid bytes and then save the damaged text.
- Draft IDs and histories are document-specific. Protect the user's actual recovery profile during testing.
- Preserve the document caret/selection when toolbar or sidebar controls receive focus. Keep all transfer operations undoable.
- Avoid adding a full UI framework, large spreadsheet engine, background polling, network services, or per-cell DOM for unused/hidden rows. The grid is virtualized. Ordinary draft writes are debounced with a maximum delay during continuous typing.
- Do not describe Electron as Notepad-size. Cite actual measurements and distinguish Linux/headless observations from Windows measurements.

## Commands and delivery

Use Node.js 24 LTS (or a supported compatible release) and npm for source work. The Windows executable in `bin/` needs neither Node nor Python.

```text
npm ci
npm test
npm run build
npm run build:portable
```

`npm run build:portable` rebuilds the renderer and refreshes the application loaded by `bin/Markpad.exe` (or the legacy root EXE). Close running Markpad windows before updating its resources, then reopen it. This is the normal final step after source changes in the extracted project folder.

Other commands:

- `npm start`: development Electron launch after rebuilding; requires the npm Electron runtime.
- `npm run package:win`: separate runtime-only package under `dist/Markpad-win32-x64`.
- `npm run package:project`: combined Windows runtime + Codex source ZIP under `dist/`.
- `python tests/ui-smoke.py`, `python tests/sheet-smoke.py`, and `python tests/native-smoke.py`: focused renderer/grid/native checks; see their documentation and CLI options. Python Playwright is a development test dependency only.

Routine local edits, tests, and builds are part of the implementation workflow. Follow the active session's actual permissions; do not invent an additional approval gate. Do not publish, push, or send messages unless requested.

When finishing a change, report what changed, the relevant checks actually run, and any remaining target-platform uncertainty. Keep `docs/PROJECT_PLAN.md` and verification evidence current. Never replace test evidence with historical checkboxes or say a Windows executable was launched if only Linux or a browser was tested.

## File ownership

- `src/`: editor interface, calculator, grid, expression and Markdown/workbook code.
- `desktop/`: native windows/menus, preload bridge, filesystem and recovery.
- `scripts/`: portable build/package/test utilities.
- `app/`: generated browser assets; regenerate, do not hand-edit.
- `bin/Markpad.exe`, `bin/resources/`, `bin/locales/`, and `bin/*.dll`: portable runtime; do not hand-edit.
- `assets/markpad.ico`: Windows native-window and EXE icon; `assets/markpad.png`: non-Windows window icon. Keep tiny ICO frames and transparency masks valid.
- `Apply-Markpad-Icon.cmd`: update the icon inside the EXE and any matching root shortcuts; relocate legacy root runtime files into `bin/` when needed.
- `scripts/Apply-Markpad-Icon.ps1`: offline Win32 PE icon patcher. Windows packaging embeds the icon by invoking it on the built executable.
- `tests/`: meaningful regression coverage; never run destructive checks against real notes.
- `docs/`: specification, plan, verification, and historical inputs.

The main checkout at `C:\Repos\markpad` tracks `kingjoyeuse/markpad`. Runtime binaries, generated app assets, dependency caches, test screenshots, and test profiles are ignored. Commit source/document changes; regenerate the `bin/` runtime application for review.

## Complete-update invariants (0.1.1)

- `src/main.js` owns the cancellable staged loader. Never apply a worker result for an older source generation. Keep raw text editable while parsing and preserve edits, selection and tool focus on promotion. Preserve unchanged source bytes, including CRLF.
- `src/format-worker.js` uses `app/editor-runtime.js`, a pinned editor dependency snapshot from `vendor/`. Terminate workers on completion/cancellation. The worker is local; do not weaken production CSP or enable remote scripts.
- `getBody()` caches serialization by immutable ProseMirror document identity. Highlighting/state totals must not redo whole-document work on caret-only transactions.
- File size is UTF-8 byte length of the prospective saved document, including worksheet metadata, compared with the last actual saved byte count. Do not use character count as byte count.
- Tool transfers must focus the destination control, while document selection remains available for the return transfer.
- Worksheet sizes are sparse `rowHeights`/`columnWidths`. Never allocate all Excel rows. Structural edits adjust all affected formulas (including locked references and cross-sheet references); deleting targets yields `#REF!`. All operations remain undoable.
- `=` reference pointing keeps the formula's origin distinct from the highlighted reference. F4 cycles both locks, row only, column only, neither. Dollar references must be lexed before currency amounts.
- `scripts/build.mjs` uses esbuild if installed and otherwise the offline builder. The offline builder combines current source, not an old app implementation, with pinned vendor dependencies. A dependency upgrade must regenerate the vendor snapshot and verify worker/editor schema compatibility; an ordinary source rebuild does not refresh that snapshot.
- Every patch containing application changes must include all affected current `app/` and `desktop/` files under both `bin/resources/app/` and legacy `resources/app/`. Do not mix app versions from older patch folders. `tests/update-package.test.mjs` asserts byte equality.
- Preserve v2 independent tab geometry. Run core tests plus complete-ui, edge and sidebar browser checks. Report Windows uncertainty separately from renderer test results. See docs/COMPLETE_UPDATE_VERIFICATION_2026-11-09.md.

## Tables, live cells, and branding (0.1.2)

- Current logo: the user-supplied black-and-white `assets/markpad-source.png`.
  Do not restore the purple-corner asset. Reproduce PNG/ICO using make-icons.py,
  preserve tiny DIB transparency masks, synchronize both runtime asset folders,
  and include the Windows EXE icon updater in logo patches.
- Header selection uses compact spans. Ctrl toggles individuals; Shift extends
  inclusively. Auto-fit measures stored/offscreen content and computed results.
  All-axis resize uses sparse defaults rather than allocating unused rows.
- Live cells are registered Markdown anchor links, not matching-number replacements.
  Keep IDs stable; row/column edits move coordinates and deletion yields #REF!.
  Preserve typing marks when syncing peers and isolate insertion's undo group. Loading or promoting formatted content is non-historic and cannot join the first user edit's undo group.
- Workbook v2 metadata preserves cell bindings and global sizes; still import v1.
  Direct edits of formula-result labels replace the cell formula, never backsolve.
- Ghost table widgets are outside the document. Never serialize them or make
  rows by navigation alone. Start one column / one blank header / one blank body.
  Contract only formerly nonempty rows/columns after clearing, not upon loading.
- Prefer focused interactive checks and meaningful tests over needless expansion.
  Record actual results and distinguish Chromium from native Windows execution.

## Release packaging (0.1.3)

- User requested GitHub under `kingjoyeuse/markpad` and separate minimal installer
  and portable downloads. Build and publish from the main checkout.
  `Publish-Markpad.cmd` pushes committed source using GitHub CLI authentication.
  Release uploads require the explicit `-Release` switch after user approval. Default new repository visibility is private;
  never silently change an existing repository's visibility or select a license.
- `installer/bootstrap.c` is a tiny native x64 launcher. `installer/setup.ps1`
  provides a per-user Windows Forms installer using built-in Windows PowerShell.
  It stages/checks files, preserves user extras/drafts, offers integration only
  after install, and keeps uninstallation scoped to the owned file manifest.
- Windows default apps require confirmation through the supported system UI;
  never patch UserChoice/hash or claim the checkbox overrides Windows protection.
- PATH changes must preserve type, variables, length and unrelated entries.
  Uninstall must not remove an entry that predated this installer.
- `scripts/windows-resources.py` preserves code and unrelated PE resources while
  branding icon/version metadata. Revalidate resources after any change. Never
  imply signing; these builds are unsigned.
- Portable profile selection happens before the singleton lock and ready event.
  `markpad-portable.json` selects adjacent `data`. Installed and dev launches keep
  their normal recovery profile. Never silently migrate/delete the user's notes.
- `scripts/build-releases.py --runtime bin` builds both distributions from a
  matching pinned runtime, current app source and only necessary runtime assets.
  Releases exclude source/tests/node_modules/history/drafts. Keep legal notices.
- `dist/releases/release-manifest.json` records source hashes. The publisher checks
  them before attaching binaries; changed code requires rebuilding.
- Keep tests focused. Distinguish compiler/ZIP/PE checks from Windows execution.
