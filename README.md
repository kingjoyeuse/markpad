# Markpad

A local Markdown notepad with live formatting, a calculator, a small spreadsheet, and recoverable unsaved notes.

**The project root is `C:\repos\markpad`**, with `AGENTS.md`, `package.json`, and `src\` in that folder and the portable app under `bin\Markpad.exe`. A shortcut to `bin\Markpad.exe` can stay in the project root. Older root-level runtime layouts are supported by the icon installer and source refresh script.

## Earlier update: 0.1.2 / tables-links-logo-2026-11-09

Uses the user's revised **black-and-white notepad/M logo** in the window, taskbar,
executable, and matching root shortcuts. Its source is `assets/markpad-source.png`;
`scripts/make-icons.py` reproduces the PNG and nine ICO frames.

This also completes the in-progress worksheet multi-selection/auto-fit, linked
cell insertion, and growing/shrinking document tables. See
[interaction details and Markdown storage](docs/TABLES_LINKS_LOGO_UPDATE.md).

Apply the replacement ZIP with all windows closed, extracting into
`C:\repos\markpad`, not `bin`. Overwrite matching files, run
`Apply-Markpad-Icon.cmd` to update the EXE and shortcut icons, then relaunch.
No rebuild is required. F1 identifies `tables-links-logo-2026-11-09`.

## Complete update: 0.1.1 / complete-2026-11-09

This is the combined update, not just the sidebar fix. The release name is visible under **Help → Keyboard Shortcuts (F1)**; About Markpad shows 0.1.1.

- Large supported documents first open as editable **Fast text**, then automatically become formatted after a short pause in typing. A worker prepares formatting off the editor thread. Typing restarts preparation; stale results cannot replace edits. Ctrl+Tab during preparation keeps Raw mode instead. Unsupported sources or sources over the safety threshold remain Raw.
- Status shows `Size: saved → current` when modified, or one size when unchanged. Untitled notes show their prospective size. Hover for exact UTF-8 bytes, including saved worksheet tables/metadata.
- Sending text to a tool gives that tool keyboard focus. Transferring a value back still uses the document's remembered selection/caret.
- Right-click a worksheet row number/column letter to insert or delete. Drag its boundary to resize; double-click the boundary to auto-fit. Structure and size changes are undoable; populated worksheet dimensions survive save/reopen.
- In a worksheet cell, press `=` and use arrows to pick references. In C1, `=`, Left, Left produces `=A1`. F4 cycles `A1 → $A$1 → A$1 → $A1 → A1`. Enter commits to the original cell; F2 switches between pointing and text-caret editing.
- The v2 independent top/bottom sidebar tabs remain in place. Windows uses a regenerated multi-size ICO instead of scaling the PNG for its tiny titlebar icon.

**Apply a replacement-files ZIP:** close every Markpad window, extract into `C:\repos\markpad` (not into `bin`), and overwrite matching files. Run `Apply-Markpad-Icon.cmd` once to update the icon embedded inside the existing EXE and matching shortcut icons. Then use the existing shortcut. No rebuild, npm install, or new EXE download is needed for this patch.

[Verification, measurements, and limitations](docs/COMPLETE_UPDATE_VERIFICATION_2026-11-09.md). The Windows-specific icon updater and native appearance still require validation on Windows.

## Run it

Open **`bin\Markpad.exe`**, or use your root shortcut to it. Keep its DLLs, `locales\`, and `resources\` **inside `bin\` beside the EXE**; moving only the EXE will not work. Run `Apply-Markpad-Icon.cmd` to migrate runtime support files from the root to `bin\` if necessary, add the new native window and EXE icons, and update any matching root shortcut icons. No Node.js, Python, installation wizard, account, or online service is required to run the portable Windows package.

### Markpad icon and `bin` layout

The supplied notepad/M artwork is used as a transparent application icon. Windows windows load the multi-size ICO (including small title-bar frames); other platforms load the PNG. The multi-size ICO is also embedded into `bin\Markpad.exe`, so Explorer, the taskbar, and the executable's Properties use it too. `Apply-Markpad-Icon.cmd` embeds the icon in your existing EXE without replacing the 239 MiB binary with a new download. It stages and replaces the EXE safely, then updates root `.lnk` shortcuts whose target is the selected Markpad executable. Close every Markpad window before running it. Changes to built-in binary resources are Windows-only; running `npm run package:win` **on Windows** will also embed the icon when building a fresh portable executable.

The build targets Windows x64. It has been assembled from the official checksum-verified Electron runtime. **The Windows executable was packaged here, but has not been executed on Windows in this environment.** The actual desktop host and interface were exercised on Linux as described below. This initial build is unsigned.

Choose **File → New Markpad** (Ctrl+N) for a blank document in the current window. The previous document is preserved in **Recent Files & Drafts** before the window switches. **New Markpad Window** (Ctrl+Shift+N) or a separate launch opens an independent window. Choosing Save writes the Markdown file.

## Editor and appearance

- Formatted mode is the default: write and edit directly in the formatted document.
- Completed heading, bold, italic, strikethrough, inline-code, list, checklist, quote, link, code-block, and horizontal-rule input patterns are supported. A Markdown code fence starts its code block when followed by a space; the toolbar also offers a code-block button.
- The toolbar includes paragraph/headings, emphasis, lists, checklists, links, code, tables, and rules. Use the table button for table authoring.
- **Ctrl+Tab** switches between Formatted and Raw. The Raw surface includes the entire saved Markdown, including any managed spreadsheet appendix.
- HTML stays in the formatted document. Supported static blocks, such as `<details>`, render in place. Other HTML appears as source. Select **Edit HTML** on a block or click an inline tag to edit its source. Markpad saves the HTML directly in the Markdown file.
- The **HTML** toolbar button inserts an empty HTML section. HTML source uses syntax highlighting.
- In Formatted mode, the link button switches to **Edit link** when the caret touches a link or the selection includes one. **Break link** removes each link touched by the selection and leaves its text in place.
- Hover over a fenced code block to choose its highlighting language or copy its contents. Type a language name and press Enter to complete it, or clear the field for plain text.
- **View → Appearance → Light / Dark / System** controls the theme. System is the default and follows changes to the OS preference.
- The right-edge Calculator and Spreadsheet ribbon tabs open/close independently. Both can remain open, calculator above spreadsheet. Drag the sidebar divider to change its width.
- Find/Replace is available through the Edit menu and Ctrl+F/Ctrl+H.

## Transfer shortcuts

Alt is required for every tool shortcut. The calculator uses Shift; the spreadsheet uses Ctrl. These meanings do not depend on which pane currently has focus.

| Action | Shortcut |
| --- | --- |
| Send selected number/equation to calculator | Alt+Shift+Right |
| Insert calculator result at remembered document caret/selection | Alt+Shift+Left **or** Alt+Shift+NumpadEnter |
| Show / hide calculator | Alt+Shift+Up / Alt+Shift+Down |
| Send selected text/number/equation to active worksheet cell | Alt+Ctrl+Right |
| Insert active cell's displayed value into document | Alt+Ctrl+Left **or** Alt+Ctrl+NumpadEnter |
| Show / hide spreadsheet | Alt+Ctrl+Up / Alt+Ctrl+Down |
| Append ` = result` after a selected equation without opening a pane | Alt+Ctrl+Shift+Right |
| Toggle Formatted / Raw | Ctrl+Tab |

The Enter transfer shortcuts specifically use the numeric keypad. Ordinary Enter remains available for normal editing/calculation. A transfer replaces highlighted document text, or inserts at its remembered caret when no text is highlighted.

**Send to calc** also appears in the document's right-click menu and is disabled for unparseable selections. Calculator input supports arithmetic, parentheses, powers, percentages, decimal/group separators, and currency symbols. Currency symbols decorate an amount; no currency conversion occurs. US-style grouping is the default. Unambiguous international forms are accepted, but ambiguous comma conventions follow the rules in the design. Percent is literal arithmetic: `10%` is `0.1`, so `200 + 10%` is `200.1`.

## Spreadsheet

The first tab is **Data**. Use `+` to add tabs and double-click a tab to rename it. A tab's context menu can delete it; deletion has a confirmation and undo path.

While entering a value, press an arrow to save it and move one cell. In a formula, arrows pick and highlight references where a reference can be entered. Tab commits the formula and returns to its origin. Enter commits it and moves one row below the origin. F2 toggles formula caret editing.

Supported everyday controls include arrows, Shift+Arrow selection, Enter/Shift+Enter, Tab/Shift+Tab, F2, Escape, Delete, Ctrl+A/C/X/V, Ctrl+Z/Y, Ctrl+Home/End, Ctrl+Arrow, Ctrl+D/R fill, and Ctrl+PageUp/PageDown for tabs. Ctrl+Space and Shift+Space select the used portion of a column/row. Copy/paste uses rectangular tab-separated data, and internal formula copying/fill adjusts relative references while retaining `$` absolute references.

Formulas support cell and range references, references to named sheets, arithmetic/comparisons, and these functions:

```text
SUM AVERAGE MIN MAX COUNT COUNTA IF IFERROR ABS ROUND ROUNDUP ROUNDDOWN
SQRT POWER MOD AND OR NOT PI FLOOR CEILING INT LEN CONCAT CONCATENATE
```

Errors are displayed rather than silently turned into values, including circular references. This is a small worksheet tool with a documented Excel-style subset; it does not provide Excel workbooks, charts, macros, pivots, formatting palettes, or every Excel function/shortcut.

### How worksheets are saved

If every sheet is empty, no worksheet material is appended. Once any sheet has entered values/formulas, each tab receives a bottom-of-document section named after that tab and an ordinary Markdown table of displayed results. A versioned hidden HTML comment retains the exact cell inputs, formulas, tab names and order. Reopening in Markpad restores editable formulas; ordinary Markdown viewers can read the tables.

Calculator input, results and history are not added to the Markdown file. A value becomes document data only when inserted into the document or worksheet.

If a generated table is changed directly in Raw mode or another editor, Markpad preserves the edited source instead of silently replacing it from stale metadata. This initial version keeps that conflicted section in raw text and prevents stale sidebar edits from overwriting it; it does not reconcile arbitrary external table changes back into formulas. Edit managed cells through the spreadsheet for a normal lossless round trip.

## Draft recovery and file behavior

Recovery is local, normally in `%APPDATA%\Markpad\recovery-v1`. Each document has its own record and a previous validated backup. A normal draft checkpoint follows a short typing pause, with a two-second maximum scheduled delay during continuous typing; closing explicitly waits for a fresh checkpoint. A sudden failure can still lose typing since the last completed checkpoint.

Saved files are updated only by Save/Save As. Recovery preserves newer unsaved edits independently. Atomic replacement protects existing bytes on a failed write, and file fingerprints detect a changed on-disk file before replacement. Forgetting a recent draft removes its recovery copy, not its saved file. Do not manually delete the recovery folder if you need its unsaved notes.

UTF-8 Markdown is supported, including UTF-8 BOM and existing line endings when a file is not edited. Invalid UTF-8 and typical UTF-16 input are rejected instead of being silently corrupted. Convert such a file to UTF-8 in another editor first.

## Use this folder in Codex

This folder is the development and release checkout for [kingjoyeuse/markpad](https://github.com/kingjoyeuse/markpad). See [Windows releases](docs/RELEASING.md) for packaging and publishing. Point Codex at `C:\repos\markpad`; `AGENTS.md` explains the architecture, latest requirements, safety invariants, and build workflow.

To change the application, install Node.js 24 LTS if needed, then use a terminal in the project folder:

```text
npm ci
npm test
npm run build:portable
```

Close Markpad before the last command, then launch `bin\Markpad.exe` again. `build:portable` builds the renderer and updates `bin\resources\app\` (or `resources\app\` for legacy root installations), the production code loaded by that executable. **Do not hand-edit `bin\resources\app\` or generated `app\` files.** Make changes in `src\` or `desktop\` and rebuild.

`Build-Markpad.cmd` performs this install-if-needed, test, and refresh workflow from a double-clickable script. `npm start` instead runs the development Electron copy. Runtime downloads occur during dependency installation/packaging, not when using the application.

| Location | Purpose |
| --- | --- |
| `bin\Markpad.exe`, `bin\resources\`, `bin\locales\`, and DLLs | Runnable Windows application and support files |
| `AGENTS.md` | Codex project instructions |
| `src\` | Interface, editor, calculator, grid and Markdown/formula models |
| `desktop\` | Native menus/windows, preload API, file and recovery handling |
| `scripts\` | Build, refresh, test, and ZIP assembly commands |
| `tests\` | Core/recovery tests and reproducible UI/native smoke runners |
| `docs\PROJECT_DESIGN.md` | Current source-of-truth design |
| `docs\PROJECT_PLAN.md` | Implemented work and remaining verification |
| `docs\*VERIFICATION*` | Actual test methods/results and limitations |
| `docs\archive\` | The three supplied historical documents |
| `bin\resources\app\` | Generated production application loaded by `bin\Markpad.exe` |
| `assets\markpad.ico`, `assets\markpad.png` | Original app/window icons for Windows and Electron |
| `Apply-Markpad-Icon.cmd` | Windows one-time branding update and safe runtime migration |

To generate another combined package, run `npm run package:project`. The resulting ZIP is under `dist\`. This creates a fresh local Git baseline for the distributed source; it does not publish or modify an external repository.

## Verification and remaining limits

The initial implementation passed **28 core/recovery tests**, **15 integrated renderer test groups**, **11 isolated spreadsheet interaction groups**, and **9 native desktop smoke checks**. The reports distinguish genuine native filesystem checks from browser-fallback UI checks. Test profiles and screenshots are not included in this project package.

The native Linux run opened/saved a real Markdown file, recovered an immediately closed unsaved draft, kept six distinct windows, synchronized theme, and exited after the last close. The sandbox denied OS singleton sockets, so the native test explicitly stubbed that lock only in its test harness; actual second-launch routing remains a target-machine check. Native picker dialogs, physical Windows keypad routing, Windows DPI and packaged Windows launch also remain unverified.

For six small notes with both panes hidden, the final Linux headless samples were about **360–361 MiB PSS** and **0.26–0.37% reported idle CPU** across the nine Electron-listed processes. PSS apportions shared memory; summed RSS double-counted shared pages and was roughly 1.08 GiB. One warm test note was ready at 227 ms of main-process uptime. These are illustrative measurements, not Windows promises or controlled cold-start benchmarks. **Electron is substantially heavier than classic Notepad.** The original brief's Electron choice was retained, and its fixed overhead remains the largest resource compromise.

Other initial limits:

- Extended Markdown such as front matter or link-reference definitions stays in Raw mode to preserve it. Documents above the 8 Mi-character formatting limit also stay in Raw mode.
- Formatted and raw editing have separate undo histories; a single continuous cross-mode history is not yet provided. Unchanged mode toggles retain the raw history. Raw snapshots have an 8 MiB history target (one oversized latest snapshot is retained); spreadsheet history is bounded separately.
- JavaScript-number precision is used, with ordinary floating-point noise reduced in display. This is not an arbitrary-precision accounting engine.
- Range evaluation and generated table rectangles are bounded at 100,000 cells. Very distant sparse cells may exceed the Markdown export rectangle limit even when few cells are filled.
- No automatic file association, installer, code signing, or in-app updates are configured in this portable build.

See the focused reports for test evidence instead of treating the old project plan's checkboxes as proof. Electron and bundled editor components retain their third-party licenses and notices.
