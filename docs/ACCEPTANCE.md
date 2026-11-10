# Markpad — Acceptance and verification matrix

Revision: 2026-11-09.

All scenarios below start as **not yet verified**. This file defines what to check; it does not claim that features are implemented or tests have passed. Record actual results, limitations, build identity, and environment in a separate verification report. Historical checks in the supplied project plan are not evidence for this source tree.

## Priority and execution

- **P0:** A failure risks lost or silently changed document/workbook data.
- **P1:** Core requested behavior needed for everyday use.
- **P2:** Broader compatibility, polish, and performance characterization.

Perform useful core/parser checks in the available environment, then native packaged checks on Windows. A browser or headless renderer check does not establish native file-dialog behavior, actual multiwindow lifecycle, native-menu shortcut handling, or packaged startup/memory.

## A. Document and editing behavior

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| ED-01 | P1 | Launch into an immediately editable untitled window. Formatted mode is the default; no account, landing page, or setup wizard blocks writing. |
| ED-02 | P1 | Type headings, emphasis, lists, code, and a link. Completed syntax is formatted while editing in the same surface, with a stable caret. |
| ED-03 | P1 | Apply each toolbar format to a selection and at an empty caret. The output is valid Markdown and the next typed character appears where expected. |
| ED-04 | P1 | Insert and edit a link through the UI. Text/URL are editable; canceling the dialog changes nothing. |
| ED-05 | P1 | Toggle Formatted/Raw repeatedly with Ctrl+Tab and the toolbar. Content remains intact; the caret remains in a corresponding location; mode switching alone does not mark the file modified. |
| ED-06 | P0 | Open a document containing unknown Markdown, front matter, HTML comments, tables, and code fences. Displaying or toggling modes cannot silently delete unsupported source. |
| ED-07 | P0 | Open and save an unedited document. No unexpected source rewrite or spreadsheet appendix appears. |
| ED-08 | P1 | Exercise undo/redo across typing, formatting, mode changes, inline calculation, and pasted content. A single transfer is one predictable undoable action. |
| ED-09 | P1 | Paste plain text and formatted clipboard content; use multiline selection, non-ASCII characters, and input composition. Text, caret, and undo remain stable. |
| ED-10 | P1 | Use Ctrl+N/O/S/Shift+S, Ctrl+Z/Y, Ctrl+A/C/X/V, and formatting shortcuts. Commands affect the intended document or focused tool. |
| ED-11 | P1 | Resize the window with both tools hidden/open. The editor stays usable, toolbar controls remain reachable, and content is not obscured by the right tabs. |

## B. Theme and layout

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| UI-01 | P1 | Fresh preference state uses System. Light, Dark, and System are selectable from menus and persist correctly. |
| UI-02 | P1 | Change the OS color preference while System is selected. All open windows update without a restart; explicit Light/Dark windows follow their configured preference. |
| UI-03 | P1 | Check editor, toolbar, context menu, dialogs, calculator, and grid in both themes. Text, selections, focus, error, and disabled states remain readable. |
| UI-04 | P1 | Click the Calculator ribbon tab twice. It opens upper-right, then closes without losing its value. |
| UI-05 | P1 | Click the Spreadsheet ribbon tab twice. It opens from lower-right, then closes without losing cell data. |
| UI-06 | P1 | Open both tools. Calculator is above spreadsheet. Spreadsheet expansion respects the reserved calculator area when calculator is hidden. |
| UI-07 | P1 | Alt+Shift+Up/Down shows/hides calculator; Alt+Ctrl+Up/Down shows/hides spreadsheet. These do not trigger the other tool's command. |

## C. Calculator and editor transfers

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| CA-01 | P1 | Select `1,234.56`, `$1,234.56`, a negative amount, and values with supported currency symbols. Send to calc displays the intended numeric value. |
| CA-02 | P1 | Select `2 + 3 * 4` and `(2 + 3) * 4`. Results are 14 and 20 respectively. Unicode ×/÷/− work if advertised. |
| CA-03 | P1 | Open the editor context menu with a valid number/expression, plain prose, malformed number, and empty selection. Send to calc is enabled only for supported valid input. |
| CA-04 | P1 | Alt+Shift+Right evaluates a valid selection and opens the calculator. Invalid input leaves the document and previous valid calculator result unchanged. |
| CA-05 | P1 | Place a caret in the document, then click/type in calculator. Alt+Shift+Left inserts the result at that remembered caret. Repeat with a highlighted document range; it is replaced. |
| CA-06 | P1 | Repeat CA-05 with Alt+Shift+NumpadEnter. Verify physical/key-code keypad Enter handling in the Windows application. |
| CA-07 | P1 | With both tools closed, select an equation and press Ctrl+Alt+Shift+Right. The exact original equation remains and ` = result` is appended after it. Neither tool opens. |
| CA-08 | P1 | With either or both tools open, repeat CA-07. It still evaluates inline without sending to either tool. The calculator-only Alt+Shift+Right still sends to calculator regardless of spreadsheet visibility. |
| CA-09 | P1 | Test an incomplete equation, division by zero, excessive nesting, and nonfinite output. Show a bounded error; do not freeze, corrupt the document, or enable invalid result insertion. |
| CA-10 | P0 | Evaluate a malicious-looking string containing JavaScript/property access or commands. It is rejected as data; no code runs. |
| CA-11 | P0 | Save a document after calculator use without insertion. No calculator expression, result, or history appears in the `.md`; calculator-only edits do not dirty the document. |
| CA-12 | P1 | Document the parser's percentage and separator conventions and test those exact conventions consistently in calculator and sheet formulas. |

## D. Spreadsheet interaction

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| SS-01 | P1 | Open spreadsheet in a new window. The first tab is Data, there is a visible active cell, and text/number/formula inputs can be edited. |
| SS-02 | P1 | Add, rename, switch, and remove worksheets. Names/order and independent data persist; removing nonempty data has an explicit undo or confirmation path. |
| SS-03 | P1 | Enter `=SUM(A1:A3)`, change a dependency, and observe recalculation. Test each advertised basic function with ordinary and boundary inputs. |
| SS-04 | P1 | Test arithmetic precedence, ranges, empty cells, numeric text, errors, and circular references. The documented behavior is consistent and errors do not become silent zeros. |
| SS-05 | P1 | With spreadsheet open, select text, a number, and an equation in the document and press Alt+Ctrl+Right. Data goes to the remembered active cell; an equation remains an editable formula. |
| SS-06 | P1 | With spreadsheet closed, Alt+Ctrl+Right opens spreadsheet and transfers text, a number, or an equation. It never evaluates inline or sends to calculator. |
| SS-07 | P1 | Select a cell, then set an insertion caret in the document. Alt+Ctrl+Left inserts its displayed value at that caret. Repeat with a highlighted document range. |
| SS-08 | P1 | Repeat SS-07 with Alt+Ctrl+NumpadEnter, verifying keypad distinction and no accidental calculator transfer. |
| SS-09 | P1 | Test arrows, Shift+Arrow, Enter/Shift+Enter, Tab/Shift+Tab, F2, Escape, and Delete in navigation and edit states. |
| SS-10 | P1 | Copy/paste rectangular TSV data between cells and an external spreadsheet/plain-text editor. Shape, empty fields, tabs, and line breaks behave as documented. |
| SS-11 | P1 | Undo/redo cell changes and multi-cell paste. The document editor's history is not accidentally invoked instead. |
| SS-12 | P2 | Test advertised Ctrl+Home/End, Ctrl+Arrow, Ctrl+D/R, and Ctrl+PageUp/PageDown behavior. Record unsupported Excel shortcuts explicitly. |
| SS-13 | P2 | Copy/fill formulas with relative and absolute references, and rename tabs used by cross-sheet formulas where supported. References remain correct. |
| SS-14 | P1 | Hide and reopen spreadsheet; switch focus among document, formula field, grid, and calculator. Active cell and remembered document insertion point remain reliable. |

## E. Markdown workbook round-trip

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| MD-01 | P0 | Save/reopen an empty workbook. No generated spreadsheet section or metadata is added. |
| MD-02 | P0 | Save two named tabs with numbers, text, formulas, and blank cells. Each has a named bottom section and readable Markdown table; reopen restores editable inputs and formulas. |
| MD-03 | P0 | Include an empty named tab alongside a nonempty tab. Its name/order survive the round-trip. A formula displaying blank still counts as entered content. |
| MD-04 | P0 | Save, reopen, edit, and save repeatedly. No duplicated appendix, lost body text, or accumulated formatting artifacts appear. |
| MD-05 | P0 | Use pipes, backslashes, multiline cell text, Unicode, leading zeros, and literal text beginning with `=`. The intended cell data survives and metadata remains safely encoded. |
| MD-06 | P0 | Create a normal body heading named Data and ordinary body tables. Markpad leaves them as document content unless they carry its explicit managed markers. |
| MD-07 | P0 | Change a generated visible table cell in Raw mode and in an external editor. Reopening/saving must not silently overwrite that edit using stale metadata. |
| MD-08 | P0 | Truncate/corrupt metadata or use an unknown version. Preserve source and offer a recoverable fallback; do not silently remove sheets or text. |
| MD-09 | P0 | Rename/delete tabs and save. Only the corresponding managed sections change; unrelated headings/tables remain untouched. |
| MD-10 | P1 | Open the `.md` in an ordinary Markdown viewer. Headings and tables remain useful; internal metadata does not appear as visible prose. |
| MD-11 | P0 | Verify workbook formula evaluation does not execute HTML/JavaScript or external operations from a loaded Markdown file. |

## F. Files, recovery, and independent windows

| ID | Priority | Scenario and expected result |
| --- | --- | --- |
| FS-01 | P0 | New/Open/Save/Save As complete a normal desktop loop. Cancel each dialog; existing text, path, selection, and dirty state remain intact. |
| FS-02 | P0 | Simulate unwritable path, full storage, and failed atomic replacement. Prior saved bytes and the current unsaved document remain recoverable; the app shows an actionable error. |
| FS-03 | P0 | Type an untitled note with a populated sheet, close its window without saving, quit/restart, and reopen from Recents. Text and original sheet formulas are recovered. |
| FS-04 | P0 | Modify a previously saved file, then close without saving. The disk file remains unchanged; Recents restores the newer draft and identifies it as unsaved. |
| FS-05 | P0 | Close immediately after the last character/cell edit, before the normal debounce would run. Final content is still recoverable. |
| FS-06 | P0 | Force process termination after an acknowledged recovery checkpoint. Restart and recover the checkpointed text/workbook. Record the expected maximum uncheckpointed interval honestly. |
| FS-07 | P0 | Fail the final close checkpoint. Window remains available with retry/Save As rather than disappearing and losing data. |
| FS-08 | P0 | Open six independent windows; edit and close them in mixed order. Draft IDs and contents do not collide or overwrite one another. |
| FS-09 | P1 | Launch Markpad again while windows are open. It creates/focuses the intended independent document window without forcing a single-document workflow. |
| FS-10 | P0 | Reopen a recovery entry that is already open. Avoid competing writers to the same draft; focus the existing window or create an explicitly separate copy. |
| FS-11 | P0 | Edit the same disk file in two windows or externally. A later save cannot silently overwrite newer on-disk changes. |
| FS-12 | P0 | Remove/move the original file while a draft exists. Recovery still works and Save As remains available. |
| FS-13 | P0 | Open enough documents to exceed the visible recent-list limit. Older unsaved drafts are retained unless explicitly deleted. |
| FS-14 | P1 | Recents distinguishes saved files, unsaved untitled notes, and modified recovered drafts. An untouched empty window does not fill the list. |
| FS-15 | P0 | Explicitly delete a draft and cancel the deletion if supported. Only the intended draft is affected; ordinary recent-item removal has a clear retention meaning. |
| FS-16 | P1 | Exit all windows. No unnecessary background process remains; next launch still restores the recent list. |

## G. Performance and packaged validation

No performance result is implied by source size, framework choice, parser unit tests, or a development browser preview. Capture a reproducible measurement for each item. Record actual values before selecting firm budgets.

| ID | Priority | Measurement |
| --- | --- | --- |
| PF-01 | P1 | Cold packaged startup to first editable frame; report sample count and individual/range values. |
| PF-02 | P1 | Warm startup/new-window creation while another window is open. |
| PF-03 | P1 | Total application-process memory and idle CPU after settling with one window and then six windows. Include child processes. |
| PF-04 | P1 | Typing/selection/formatting responsiveness for a short note and a representative larger Markdown document. |
| PF-05 | P2 | Visible responsiveness when toggling modes, transferring values, and recalculating a representative populated workbook. |
| PF-06 | P1 | Recovery checkpoint/close latency with text and workbook data; investigate any visible blocking. |
| PF-07 | P1 | Windows packaged launch, native menus/dialogs, physical keypad shortcuts, file paths containing spaces/non-ASCII characters, and six-window workflow. |
| PF-08 | P2 | Compare hidden versus visible tool panes and confirm idle CPU is not driven by repeated rendering/polling. |

## Verification report template

For each executed group, record:

- Build/version or source revision and exact run command.
- Operating system, hardware, runtime version, and whether packaged/native or browser-only.
- Scenario IDs, actual observed result, and supporting test/log/screenshot artifact where useful.
- Failures, unsupported behaviors, and any untested items.
- Resource measurement method and actual numbers, with cold/warm distinctions.

Only mark a scenario passed after observing its expected result. An unsupported or untestable requirement remains visible as such. Do not carry forward the historical project's checked boxes.
