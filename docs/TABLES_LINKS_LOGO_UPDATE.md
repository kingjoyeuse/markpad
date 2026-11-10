# Markpad 0.1.2: tables, live cells, updated logo

Release: `tables-links-logo-2026-11-09`.

## Installation

Close every Markpad window. Extract into `C:\repos\markpad` (not `bin`), overwrite,
run `Apply-Markpad-Icon.cmd`, then relaunch. This updates existing EXE resources
and matching root shortcuts without downloading the Electron executable again.
It notifies Windows to refresh affected icons without restarting Explorer or
changing the chosen default application. Source and both runtime layouts match.

## Spreadsheet selection and sizing

Ctrl-click row/column headers to toggle individual selections; Shift-click selects
the inclusive interval from the latest plain/Ctrl anchor. Ctrl+Shift adds a range.
Rows/columns are separate modes. Copy, clear, insert/delete, sizing and document
insertion respect these selections. Nonadjacent selected columns remain separate.

Double-click the left/right edge inside a column header or top/bottom edge inside
a row header to auto-fit the header under the pointer. With multiple selected
headers, all selected columns share the widest required width; selected rows
share the tallest required height. All stored content counts, including offscreen
cells, multiline values and evaluated formulas. Row fitting accounts for wrapping.
Sizes are bounded: columns 36–10,000 px; rows 18–10,000 px.

Dragging immediately left of A sets all column widths; dragging immediately above
row 1 sets all row heights. These use sparse sheet-wide defaults, clear individual
overrides, and affect distant/future cells too. Size/structure edits are undoable.

## Linked insertion

The bottom **Insert cell(s)** button (also Alt+Ctrl+Left / Alt+Ctrl+NumpadEnter)
inserts at the remembered document caret or replaces its selection. One cell is
accent-colored linked text; several cells become a Markdown table with linked
values. Nonadjacent selections are packed in order without unselected gaps. Header
selections export the occupied opposite-axis extent, not a million empty cells.
An insertion is limited to 10,000 cells.

Edit a linked label in Formatted mode or its text in Raw mode to update its original
spreadsheet cell. Spreadsheet edits update all occurrences and formula dependents.
**Editing a formula result in the document replaces its formula with the entered
value**; this is not reverse-solving. Edit formulas in the spreadsheet to retain
them. Deleting a whole occurrence removes that occurrence, not the worksheet cell.

Inserting rows/columns moves link targets; deleting a target shows `#REF!` rather
than linking to a different cell. Undo restores it. New ghost-created document
cells are ordinary unlinked cells until explicitly populated via Insert cell(s).

## Document tables

The WYSIWYG button creates **one column with one empty header and one empty body
cell**, with the caret in the header. While editing a rectangular unmerged table,
a faint ghost row and column appear. Typing/pasting makes a ghost real. Navigation
alone does not create saved cells. Ghosts hide when the caret/focus leaves the table.

Right at the end of the final real column enters its ghost column; another Right
wraps to the next row (the ghost row when beyond the final real row). Down from the
last real row enters the ghost row, and another Down leaves the table. Clearing
all entered contents of a row/column removes it. Fresh blank starters and blank
rows already present on load are preserved. Clearing the entire table leaves a
paragraph. These edits support undo.

Only tables overlapped by an open calculator/spreadsheet narrow into the remaining
left space, including room for ghosts. Nonoverlapping tables retain their widths.
Merged imported tables retain content but do not offer ghost expansion. Raw mode
is direct source editing, without ghost widgets.

## What is stored in the Markdown file

The file stays UTF-8 Markdown. Visible document values are ordinary anchor links,
for example `[25](#markpad-cell-example)`. Markpad styles registered values with
the accent color; other Markdown viewers display the labels with their own styling,
without synchronization. Multiple cells use normal Markdown table syntax.

A managed appendix at the bottom contains a heading for each worksheet tab and a
readable table of evaluated values. Hidden HTML comments contain **URI-encoded
JSON** describing the extra behavior. Version 2 is used for links or sheet-wide
sizes; existing v1 worksheet files still load. The markers are:

```text
<!-- markpad:workbook:v2:start -->
<!-- markpad:workbook:v2:data ... -->
...readable worksheet headings and Markdown tables...
<!-- markpad:workbook:v2:end -->
```

The ellipses above are schematic. Actual comments contain encoded JSON with sheet
IDs/names/order, exact cell inputs and formulas, row heights/column widths, default
sizes, active sheet, and link IDs mapped to a sheet and cell. The last displayed
linked label helps distinguish a label edit from recalculation. Stable IDs survive
sheet renaming; structural edits adjust cell coordinates. Metadata is validated
and the bindings reconstructed when Markpad opens the file.

A consistency hash protects externally edited appendix tables from being silently
overwritten using stale metadata. Such conflicts preserve the raw source instead.
URI encoding prevents arbitrary cell text from terminating the hidden comment.

No separate workbook file is needed. Ghost cells, temporary selections and calculator
state are not saved in the workbook. Removing comments/link targets in another
editor loses the extra behavior, but the visible values/tables remain readable.
Moving the intact .md file carries sheets, dimensions and bindings to another
Markpad installation. `examples/linked-cells-demo.md` is a real generated example.

## Verification

See TABLES_LINKS_LOGO_VERIFICATION.md for executed checks. Chromium-on-Linux tests
use an isolated desktop bridge and are not Windows-native execution. The icon
source and all ICO resolutions are checked; actual Windows appearance and the
Windows EXE resource updater still require target-machine verification.
