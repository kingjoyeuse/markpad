# Spreadsheet renderer verification

Observed run: **2026-11-09 15:46 EST** (20:46 UTC).

Result: the isolated spreadsheet renderer suite passed all 11 scenario groups listed below. This is an observed test result for the `SpreadsheetView` source. It is not a claim that the full acceptance matrix or the packaged Windows application passed.

## Environment and source identity

| Item | Observed value |
| --- | --- |
| Operating system | Linux 6.18.57, x86-64, glibc 2.41 |
| Electron | 45.2.3 |
| Python | 3.12.14 |
| Driver | Python Playwright connected to Electron's local debugging endpoint |
| Viewport | Explicit 900 × 700 emulated viewport |
| Worksheet fixture area | 400 × 500 pixels |
| Tested module | `src/ui/spreadsheet.js` |
| Module SHA-256 | `6b47d348db694ef1b8237155d301012841bce1bf55ca2e0c1c1aa714adee46da` |

The test bundles the actual spreadsheet source and its core modules into a temporary fixture and uses the application's stylesheet. It runs in an isolated Electron window with its own temporary user-data directory. It does not load the production desktop coordinator or modify the user's recovery records.

Headless Electron initially reported a 1 × 1 viewport despite ordinary BrowserWindow dimensions. Setting the explicit viewport resolved the harness's pointer hit-testing issue. The successful run includes real pointer clicks and keyboard events, not just model inspection.

## Passed scenario groups

| Group | What was observed |
| --- | --- |
| Typing and formula entry | Entering `12` in A1 and `=A1*2` in A2 displayed 24; Enter committed and moved to A3. |
| Relative fill and history | Ctrl+D filled A2:A5 with adjusted references. A5 became `=A4*2`, evaluated to 192, disappeared on Undo, and returned on Redo. |
| Formula bar | Entering `=SUM(A1:A5)` into B1 through the formula field evaluated to 372. |
| Cell pointer editing | Double-clicking C1 opened its inline editor. Escape discarded an uncommitted replacement. |
| Worksheet rename | Double-clicking the Data tab opened an inline name field; Enter renamed it to Costs. |
| Editing/navigation keys | F2 opened a cell editor; Tab/Shift+Tab moved right/left; Shift+Arrow extended a rectangular selection. |
| Clipboard events | A two-row TSV payload populated a 2 × 2 rectangle. Copying a formula from A2 to B3 adjusted `=A1*2` to `=B2*2`. |
| Document-to-cell conversion | `A1-1` became an editable formula; `1/0` remained a formula producing a visible error; `00123` became the numeric input `123`; ordinary prose remained text. |
| Multiple tabs and references | Adding/switching tabs preserved their data. Renaming Costs to Rates updated a formula in Totals to `='Rates'!A1`, retaining its value of 12. |
| Delete and undo | Explicitly deleting Totals removed the tab; Undo restored its name and formula data. |
| Distant cells and virtual rendering | Row 600 was editable. Ctrl+Home moved to A1 and Ctrl+End to D600. A 1,000 × 52 grid had only 102 cell DOM nodes at the final viewport. |

The final run recorded 21 committed changes, zero renderer exceptions, and no user-facing error notices.

## Reproduce

The project npm dependencies must be installed. The verification driver additionally needs Python with the `playwright` package. It uses the project's Electron executable and does not require a separately downloaded Playwright browser.

From the project root:

```text
python tests/sheet-smoke.py --output test-results/sheet-smoke
```

If Electron is installed elsewhere:

```text
python tests/sheet-smoke.py --electron /path/to/electron --output test-results/sheet-smoke
```

The script records a JSON result, current source hash, runtime versions, actual observed values, and the Electron log in the chosen output directory. Its paths are derived from the checkout, so it does not depend on the original scratch directory. Each run uses a temporary profile and available local debugging port. The fixture files are removed after the run.

Supporting files:

- `tests/sheet-smoke.py`: driver, assertions, result capture, and process cleanup.
- `tests/sheet-smoke-build.mjs`: bundles the current grid source into the isolated fixture.
- `tests/sheet-smoke.cjs`: starts the isolated Electron window.
- `docs/evidence/sheet-smoke-result.json`: observed result from the run above.

## Scope and limitations

- Clipboard checks dispatch DOM ClipboardEvents carrying DataTransfer payloads. Interoperation with the operating-system clipboard or an installed copy of Excel was not tested by this suite.
- The isolated fixture does not test document-to-sidebar selection bookmarks, application-wide modifier shortcuts, native menus, file dialogs, recovery checkpoints, or closing/reopening production document windows.
- The DOM cell count verifies that the grid is virtualized. It is not a benchmark of startup time, total memory, idle CPU, or typing latency.
- The tests ran against a temporary bundle of the source hash above. Rebuilding the final application bundle and packaging it occur separately. Changes to this module or the core after that hash require rerunning the suite before carrying these results forward.
- The full `ACCEPTANCE.md` remains an unclaimed acceptance specification. Broader application and Windows checks belong in their own verification records.
