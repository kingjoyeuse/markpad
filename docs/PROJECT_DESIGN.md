# Markpad — Product and interaction design

Revision: 2026-11-09. Status: implementation specification; not a claim of completed or validated functionality.

## 1. Purpose and source of truth

Markpad replaces several everyday Notepad windows with a small local Markdown editor. It shows the final formatted document as the user types, provides approachable formatting controls, and keeps quick calculations and small spreadsheets beside the writing surface.

The user's current requirements take precedence over the attached historical `PROJECT_BRIEF.md`, `PROJECT_DESIGN.md`, and `PROJECT_PLAN.md`. Those attachments describe earlier Electron work, but no application source or executable was attached. Historical completion checkboxes and smoke-test statements therefore do not establish the state or quality of this implementation.

The practical usage target is five or six independent document windows open at the same time. Opening, typing, switching windows, and recovering an unsaved note are the primary workflows. Markpad is an offline, single-user desktop application. Files remain ordinary `.md` documents owned by the user.

## 2. Product priorities

1. Preserve the user's writing and spreadsheet inputs, including when a window closes without a file save.
2. Make typing and direct formatted editing immediate and predictable.
3. Keep startup, idle work, and the cost of multiple windows low.
4. Provide quick transfers between text, calculator, and spreadsheet without losing the document insertion point.
5. Keep the interface familiar and restrained.

Markpad does not require an account, cloud storage, collaboration service, project workspace, or landing page. There is no continuously running background service solely to retain notes.

## 3. Window and editor

Each document has its own desktop window and independent undo history, selection, calculator, and workbook. File actions belong in the native File menu. The title identifies the document and its unsaved state. A compact toolbar contains formatting controls and the Formatted/Raw toggle on the same row.

### Formatted mode

Formatted mode is the default. It is a directly editable document surface, not a separate preview beside a source editor. Recognized Markdown syntax becomes formatted content as it is completed while typing. Clicking a paragraph must not replace the entire document with raw Markdown or cause the selection to jump. Toolbar commands work on the current selection or set formatting at the caret.

Baseline formatting covers paragraphs, headings, bold, italic, strike-through, links, inline code, fenced code blocks, blockquotes, ordered and unordered lists, horizontal rules, and ordinary Markdown tables. Formatting controls use understandable labels/tooltips and support keyboard operation. Link insertion provides fields for the display text and URL.

The application must not silently erase unsupported Markdown when switching modes or saving. Unsupported structures must remain recoverable in the source, or the application must keep that document in Raw mode and clearly explain the limitation before a lossy conversion. Loading an existing file and saving without a user edit must not rewrite its contents merely because it was displayed.

Embedded HTML keeps its own source within Formatted mode. Render a limited set
of static HTML blocks locally and show other blocks and inline tags as source.
Each region supports highlighted source editing in place. Save the region as raw HTML
without adding Markdown fences, and never execute its markup or load its
external resources.

New Markpad uses Ctrl+N to preserve the current document in recovery before
opening a blank document in the same window. New Markpad Window uses
Ctrl+Shift+N to open a separate blank window.

### Raw mode

Raw mode exposes Markdown source for direct editing. `Ctrl+Tab` toggles Formatted/Raw. Switching modes preserves document content, the best available corresponding caret position, and the ability to undo ordinary editing operations. Mode changes alone are not document edits.

Managed spreadsheet sections are part of the saved Markdown format. Their treatment in Raw mode must be explicit: editing their visible table values cannot be silently ignored on the next save. The serializer must reconcile edits or retain the edited source rather than overwrite it with stale workbook metadata.

### Theme

The menus offer Light, Dark, and System. System is the default. A System window follows changes to the operating system's preferred color scheme while running. Explicit Light/Dark choices persist as an application preference. The editor, menus/dialogs where supported, calculator, spreadsheet, focus indicators, selections, and disabled states remain readable in both themes.

## 4. Right sidebar

Two independent ribbon-style tabs remain available on the right edge: Calculator and Spreadsheet. Clicking a closed tool's tab opens it; clicking its open tab closes it.

The calculator occupies the upper-right area. The spreadsheet starts at the lower-right corner and expands upward to the boundary reserved for the calculator, including when the calculator is hidden. When both are visible, the calculator is above the spreadsheet. The main editing surface keeps usable space and scrolls independently of the tools. Opening or hiding a pane does not discard its contents.

## 5. Calculator

The calculator accepts numeric input and simple arithmetic expressions. The parser supports decimal values, grouping commas, currency symbols, parentheses, unary signs, addition, subtraction, multiplication, division, exponentiation, and percentages within its documented grammar. Common Unicode multiplication, division, and minus signs may be normalized. US-style values such as `$1,234.56` must work. Any additional locale conventions must be deterministic; ambiguous separators must not be guessed differently between the calculator and spreadsheet.

Currency symbols are accepted as decoration on a number; no exchange-rate conversion is implied. Expression evaluation is data processing and must never execute JavaScript or operating system commands. Invalid expressions, division by zero, and nonfinite values produce a visible error without destroying the previous valid value or modifying the document.

The editor context menu includes **Send to calc**. It is enabled only when the highlighted text can be parsed as a supported finite number or arithmetic expression. It is disabled for empty or invalid selections. Sending an expression evaluates it and displays its result in the calculator.

Sending a value to the calculator opens the calculator, except that inline evaluation never opens it. Returning the calculator's current valid value inserts at the document's remembered caret or replaces its remembered selection. A failed calculation cannot be transferred as a numeric result.

### Inline evaluation

Inline evaluation preserves the selected equation and appends ` = ` followed by its result immediately after that selection. The inserted result forms one undoable editing action. It does not open the calculator or require the calculator to have been used first.

### Persistence boundary

Calculator input, result, and history are temporary tool state. They are never appended to the `.md` file. A result becomes document content only when the user explicitly inserts it or evaluates an equation inline. Calculator changes alone do not make the document dirty.

## 6. Spreadsheet

The spreadsheet is a small, keyboard-friendly grid for basic calculations. It supports multiple worksheets, each with a user-editable name. The first worksheet is named `Data`. Each sheet has an independent active cell, scroll position, and cells containing text, numbers, or formulas. Sheet names must remain unambiguous within the workbook.

Entering text stores text; entering a number stores a numeric input; an input beginning with `=` is a formula. A document-to-sheet transfer recognizes a supported equation and stores it as a formula rather than only storing its current result. Ordinary selected text remains text. Pasting tab/newline-separated data populates the corresponding rectangular cell range.

The visible cell displays its calculated value; the formula/input field allows editing its original input. Returning a cell to the document inserts its displayed value at the remembered document caret or replaces the remembered document selection. The requested baseline is one active cell; exporting a selected range is an extension and must have a documented output format if implemented.

### Basic formula scope

The intended initial scope includes arithmetic operators, parentheses, A1 references, ranges such as `A1:B4`, and simple functions such as `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `ROUND`, and `ABS`. Absolute/relative references and references to another tab require consistent handling wherever the corresponding copy/fill or cross-sheet operations are supported.

Invalid formulas, unknown functions, circular references, and references to removed cells/sheets produce recognizable cell errors instead of freezing or silently becoming zero. Formula evaluation must be bounded and must not execute arbitrary code. A documented supported subset is required; this is not a claim of complete Excel compatibility.

### Keyboard scope

The baseline Excel-style behavior is:

| Keys | Grid behavior |
| --- | --- |
| Arrow keys | Move the active cell when not editing |
| Shift+Arrow | Extend the selection |
| Enter / Shift+Enter | Commit and move down/up |
| Tab / Shift+Tab | Commit and move right/left |
| F2 | Edit the active cell |
| Escape | Cancel a pending cell edit |
| Delete | Clear selected cell contents |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy/cut/paste cells, including rectangular text data |
| Ctrl+Z / Ctrl+Y | Undo/redo spreadsheet edits |
| Ctrl+Home / Ctrl+End | Move to the start/end of the used grid |
| Ctrl+Arrow | Move to a populated-region boundary |
| Ctrl+D / Ctrl+R | Fill down/right within the selected range |
| Ctrl+PageUp / Ctrl+PageDown | Select previous/next worksheet |

Markpad's explicitly requested application shortcuts take priority over conflicting Excel conventions. An unavailable shortcut or unsupported Excel feature must be described accurately in the delivered documentation rather than treated as implemented.

## 7. Transfer shortcuts

The latest shortcut revision uses Alt+Shift for calculator actions and Alt+Ctrl for spreadsheet actions. Alt is required for both groups. Inline equation evaluation uses the separate Ctrl+Alt+Shift+Right action. Each shortcut has the same meaning regardless of which sidebar panes are visible; there is no context-sensitive overlap.

The menus/context menu also expose distinct **Send to calc**, **Evaluate inline**, and **Send to spreadsheet** commands. Sending to a hidden tool opens that tool; evaluating inline does not open either tool.

| Shortcut | Action |
| --- | --- |
| Ctrl+Tab | Toggle Formatted/Raw |
| Alt+Shift+Right | Send selected number/expression to calculator and show it |
| Alt+Shift+Left | Insert calculator value into the document |
| Alt+Shift+NumpadEnter | Same as Alt+Shift+Left |
| Ctrl+Alt+Shift+Right | Evaluate the selected equation and append ` = result` inline |
| Alt+Ctrl+Right | Send selected text/number/equation to the active spreadsheet cell and show spreadsheet |
| Alt+Ctrl+Left | Insert active spreadsheet cell's displayed value into the document |
| Alt+Ctrl+NumpadEnter | Same as Alt+Ctrl+Left |
| Alt+Shift+Up | Show calculator |
| Alt+Shift+Down | Hide calculator |
| Alt+Ctrl+Up | Show spreadsheet |
| Alt+Ctrl+Down | Hide spreadsheet |

The shortcut handler distinguishes the keypad Enter key from the main Enter key, checks the full modifier combination, and handles the three-modifier inline command before the calculator/spreadsheet groups. Transfer shortcuts do not accidentally trigger another group's command, text selection/navigation, or a conflicting native menu action.

The document caret/selection and spreadsheet active cell are remembered independently across pane focus changes. Opening a tool cannot destroy the editor selection needed for a later return transfer. A remembered range must track intervening document edits rather than retain invalid offsets.

## 8. Markdown workbook format

When every worksheet is empty, saving creates no spreadsheet appendix. A formula counts as entered content even if its displayed result is empty. Once the workbook contains entered content, preserve its sheet names and order, including an intentionally empty named sheet.

For each worksheet, append a section at the bottom of the document using its name as the heading and its data as an ordinary Markdown table. Values must be readable in other Markdown editors. Serialize the used region rather than thousands of unused grid cells.

Markdown tables alone cannot preserve spreadsheet formulas and input types. A narrowly scoped, versioned HTML comment therefore accompanies the human-readable table and stores the original cell inputs and workbook information required to reopen it. Markpad reconstructs the editable workbook from its own marked sections. It does not adopt arbitrary user-authored tables merely because a heading is named `Data`.

Required round-trip behavior:

- Preserve formulas as formulas, literal text as text, worksheet order/names, and intentionally empty cells within the used region.
- Escape table pipes, line breaks, backslashes, and metadata safely.
- Repeated saves do not duplicate the appendix.
- Renaming/deleting a worksheet updates the generated sections without touching unrelated headings.
- No calculator state appears in the appendix or metadata.
- Unknown or malformed metadata is retained safely; an error cannot cause the text or workbook to disappear.
- Reconcile edits made to generated visible tables in Raw mode or another editor, or retain their edited source for explicit recovery. Stale metadata must not silently overwrite externally edited visible values.
- Saving a document with no workbook data remains a plain document with no proprietary wrapper.

## 9. Files, windows, Recents, and recovery

New, Open, Save, Save As, and closing a window operate on its document. File dialogs and filesystem errors are native where practical. A canceled Open/Save As leaves the existing document intact. Saving uses an atomic replacement strategy where supported, and a failed save leaves the previous file and unsaved changes recoverable.

Multiple windows are supported. Launching Markpad again or opening another document must not force the user into a single-document window. For efficiency, one main process may coordinate several independent windows; the user-facing requirement is independent usable windows, not one heavyweight backend per launch.

### Unsaved recovery

Every document has a stable recovery identity separate from its filename. Changes to text or worksheets create a local recovery snapshot after a short debounce. Closing a window completes a final checkpoint before allowing the window to disappear.

Closing an untitled or modified window retains its content in Recents even if the user has never saved a `.md` file. A recovered modified file remains distinct from its older on-disk version. Closing never silently overwrites that original file. Reopening a recoverable draft restores text and worksheet inputs/formulas.

If the recovery checkpoint fails, the application keeps the document available and presents a retry/Save As path. It does not quietly close as though retention succeeded. Crash recovery tolerates an incomplete latest snapshot. Empty untouched windows need not clutter Recents.

### Recents

The recent list distinguishes saved files, untitled drafts, and saved files with recovered unsaved changes. It shows enough identity and time information to locate an earlier note. A draft already open can focus its existing window to prevent competing recovery writers.

Deleting a retained draft is explicit. Truncating the visible recent list must not silently delete unsaved content. A missing original file does not remove a recoverable draft. If the same disk file changes elsewhere or is open in another window, saving must detect the conflict or require an explicit resolution rather than silently overwrite the newer version.

## 10. Implementation direction and performance

The initial implementation retains the explicitly approved historical stack: Electron, JavaScript, HTML, and CSS. Windows share one main process. The renderer uses a structured Markdown editor; it does not rebuild the entire editable DOM on every keystroke. Use a small spreadsheet implementation and safe formula parser rather than a large office-suite dependency. No React layer is required for this application.

Electron has a Chromium/process memory baseline. This design does not promise Notepad-level memory, and a small JavaScript source bundle is not evidence of low runtime memory. A future native/system-WebView host is a possible migration if measured six-window costs are unacceptable; it is not required for the first implementation and must not compromise document safety.

Avoid unnecessary timers, repeated full-document parsing, full-grid rendering, background network requests, and duplicated per-window backend initialization. Recalculate affected data when practical. Keep recovery writes debounced while guaranteeing a close checkpoint. Hidden panes should perform no continuous rendering work.

Performance must be measured on a packaged application, preferably on the user's Windows 10 hardware or a clearly identified comparison machine:

| Measurement | Required report |
| --- | --- |
| Cold launch | Time from process launch until editable window accepts input |
| Warm/new window | Time to usable independent window |
| Idle | CPU and memory after settling, with one and six windows |
| Six-document workload | Total application-process memory with representative documents |
| Typing and transfer | Visible latency on an ordinary note and a larger Markdown file |
| Workbook activity | Recalculation/edit responsiveness with a representative used grid |
| Recovery | Checkpoint time and restored-content fidelity after normal and forced exit |

Initial results and acceptable budgets remain pending measurement. Report operating system, hardware, application build, document sizes, pane state, sampling method, and whether values are cold/warm. Browser-only measurements do not validate native startup, native file dialogs, Windows shortcuts, or recovery during real process termination.

## 11. Delivery and completion

A useful deliverable includes the application source, a reproducible Windows build/start path, the updated design, and an honest verification record. A packaged Windows executable is preferred when the available environment can produce it. If packaging or Windows execution cannot be performed, state that limitation explicitly.

Completion requires the end-to-end workflows in `ACCEPTANCE.md`, with the result and environment recorded for each material check. A checklist item is not complete because the corresponding code exists or because an earlier agent wrote that it passed.

## 12. Initial implementation scope and limits

This section records concrete implementation boundaries so the broader design above is not mistaken for a promise of complete Excel or arbitrary-Markdown compatibility. Verification belongs in the separate reports.

- **Spreadsheet rendering:** the grid begins with at least 1,000 rows and 52 columns, grows to reach entered cells, and creates DOM nodes only for the viewport. It is not a 52,000-element HTML table.
- **Spreadsheet editing:** cell editing, rectangular selection, formula input, TSV clipboard events, relative-reference copy/fill, multiple tabs, and tab rename/delete are implemented in the small grid. Return-to-document transfers use the active cell's displayed value. Whole-range insertion as a document table is not part of that shortcut.
- **Excel scope:** the supported navigation/editing shortcuts and formula subset are explicit. This build does not implement Excel's ribbon, macros, charts, pivot tables, sorting/filtering UI, merged spreadsheet cells, per-cell styles, date serials, or every Excel function. Row/column header selection covers the used portion; it does not allocate or copy an entire million-row column.
- **References:** formula copies and fill operations shift relative references while respecting `$` anchors. Worksheet renaming updates references to that worksheet. A cut/paste does not provide Excel's complete dependency-rewriting behavior for all other formulas that referred to moved cells.
- **Work limits:** a batch edit/copy/paste/fill is limited to 10,000 cells. The core supports up to 100,000 stored cells across at most 128 worksheets, and Markdown export caps the total used table rectangles at 100,000 cells. Sparse data placed extremely far apart may therefore exceed the Markdown export limit even when few cells are populated.
- **Undo:** spreadsheet changes use a bounded history of at most 80 operations and approximately 4 MiB of serialized history data. An individual change above that history budget clears the prior spreadsheet undo history and produces a notice. Raw and formatted document editing currently have separate histories; switching modes does not provide one seamless undo timeline, and entering Raw mode resets its earlier raw history.
- **Numbers:** cells retain their original input strings, but numeric display/evaluation uses JavaScript numbers rather than arbitrary-precision decimal arithmetic. Selected numeric text sent to the sheet is converted to its numeric value, so `00123` becomes `123`; enter a leading apostrophe when literal text and its leading zeros are required. The parser's documented arithmetic rules apply consistently, including percentages as division by 100.
- **Source preservation:** extended Markdown and sufficiently large documents can open in Raw mode to retain their source and responsiveness. Formatted edits may normalize supported Markdown syntax. A no-edit save should retain the original source. An externally modified managed spreadsheet appendix is kept as document source with a warning instead of silently restoring stale formulas over it.

The isolated spreadsheet renderer checks in `SPREADSHEET_VERIFICATION.md` establish only the behaviors they exercised. The production bundle, native Windows behavior, document/sidebar selection handling, filesystem lifecycle, and resource measurements require their own verification.
