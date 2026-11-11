# Markpad — implementation and handoff

Revision: 2026-11-09. Initial version: 0.1.0.

## Delivered implementation

- Structured single-surface Tiptap/ProseMirror Markdown editor; live common input rules; toolbar and Formatted/Raw toggle.
- System-default light/dark appearance and synchronized desktop theme preference.
- Calculator, safe numeric-expression parser, conditional context-menu action, and exact-range transfers.
- Independent calculator/spreadsheet ribbon tabs and upper/lower sidebar placement.
- Virtual spreadsheet with named tabs, simple formulas/ranges/cross-sheet references, clipboard/navigation/fill, and bounded undo.
- Readable Markdown worksheet sections with versioned formula metadata and conflict-preserving raw fallback.
- Native menus/windows/file I/O, strict UTF-8, atomic saves, outside-change detection, and independent recoverable drafts.
- Revised shortcuts: calculator Alt+Shift; spreadsheet Alt+Ctrl; inline evaluation Alt+Ctrl+Shift+Right; mode Ctrl+Tab.
- Portable Windows runtime plus complete source in one root-level runnable Codex project package.
- `build:portable` refresh workflow for the root executable; reproducible core and focused UI/native test runners.

## Verification completed in the available environment

| Layer | Evidence | Result |
| --- | --- | --- |
| Numeric/workbook/Markdown core | `tests/core.test.mjs` | 18 passing tests |
| Recovery/UTF-8/filesystem | `tests/recovery.test.mjs` | 10 passing tests |
| Integrated renderer | `UI_VERIFICATION.md` | 15 passing groups, no renderer exceptions |
| Spreadsheet fixture | `SPREADSHEET_VERIFICATION.md` | 11 passing groups |
| Actual native host on Linux | `NATIVE_VERIFICATION.md` | 9 passing smoke checks |
| Windows runtime origin | Official Electron archive and packaged SHA-256 table | Download checksum verified during packaging |

These layers are not interchangeable. The renderer uses a browser development fallback for its UI suite; native file/recovery tests use the actual desktop host. The native sandbox test stubs only its unavailable singleton socket lock. None of these records claims execution of the Windows binary.

## Next target-machine verification

1. Extract into `C:\repos\markpad` and launch the root `Markpad.exe` on Windows.
2. Check native Open/Save As dialogs, physical Ctrl+Tab and both keypad Enter shortcuts, display scaling, and repeated EXE launches.
3. Work with six ordinary notes; close/reopen unsaved notes through Recents and check actual Windows memory/startup/idle CPU.
4. Make a small source change, run `npm test` and `npm run build:portable`, then verify the root EXE loads the rebuilt app.

## Known follow-up work

- Continuous undo history across raw/formatted modes and more exact cross-mode caret mapping.
- Reconciliation of arbitrary externally edited generated tables with formula metadata; current behavior preserves source and refuses stale overwrites.
- Broader Markdown extensions while retaining their exact source.
- A native/system-WebView shell investigation if measured Electron memory is unacceptable for this workflow.
- Optional installer, file association, signing, and shortcut customization if requested later.

Use `ACCEPTANCE.md` as the complete scenario matrix. It is a requirements checklist, not a claim that every scenario has passed. Add new evidence only after executing the relevant checks. Do not reopen historical backlog-expansion phases from the archived plan.


## Complete update — 0.1.1 / complete-2026-11-09

The earlier v2 delivery only included independent sidebar tabs. The following pending work is now integrated into a single source/runtime package:

- [x] Cancellable worker-based staged formatting with immediate editable text and preservation of concurrent typing.
- [x] Saved/current UTF-8 file sizes, including workbook metadata.
- [x] Focus destination on editor-to-calculator/spreadsheet transfers.
- [x] Row/column insertion, deletion, reference adjustment, undo, sparse resize/persistence.
- [x] Formula pointing with arrows and F4 lock cycle, including locked-reference evaluation.
- [x] Size-specific ICO frames and Windows native-window icon source; EXE icon updater included.
- [x] Independent tabs retained; all shipped runtime copies rebuilt from current source and compared.
- [x] 52 unit tests, 56 combined browser checks, 156 sidebar-layout checks executed successfully on Linux/Chromium.
- [ ] Native Windows launch/interaction and icon updater/appearance verification (not available in this environment).

Actual evidence and timing boundaries: COMPLETE_UPDATE_VERIFICATION_2026-11-09.md and verification-complete-2026-11-09/.


## Tables, linked cells, and revised logo — 0.1.2

- [x] Compact Ctrl/Shift multi-header selection, shared content auto-fit, pointer-side seam ownership, and sparse all-column/all-row sizing.
- [x] Insert cell(s) button and keyboard insertion produce registered accent-colored links or a Markdown table; edits synchronize both ways.
- [x] Versioned Markdown metadata restores formulas, dimensions, defaults and link targets; stable sheet IDs and structural target updates are preserved.
- [x] One-column header/body starter; ephemeral ghost row/column, keyboard transitions, real growth on input and contraction when previously entered rows/columns are cleared.
- [x] Document tables narrow only when overlapped by an open tool panel; independent tab geometry retained.
- [x] Revised black-and-white logo assets in source and both runtime locations; EXE/shortcut updater includes refresh notifications.
- [x] Non-historic document load prevents first Undo from clearing the reopened file.
- [x] Executed 58 core tests, 48 linked-grid checks, 34 table checks, 32 baseline browser checks, and 156 sidebar layout checks.
- [ ] Windows-native execution, icon-updater execution and appearance verification.

Evidence: TABLES_LINKS_LOGO_VERIFICATION.md. Behavior and storage: TABLES_LINKS_LOGO_UPDATE.md.

## Release distribution update — 0.1.3

Runtime-only Windows installer and portable ZIP are built separately from source.
The installer has post-install opt-in PATH/Run and `.md` default-selection controls;
defaults are confirmed by the user in Windows UI. Portable mode has adjacent data
storage. Both EXEs contain current branding. Source-side publisher targets
`kingjoyeuse/markpad`, private by default, without force-push or release replacement.

Core checks and archive/PE inspection completed; Windows execution and remote
GitHub publication remain explicitly unverified. See RELEASING.md and
RELEASE_VERIFICATION_0.1.3.md. The repository has not been claimed as created.

## Worksheet navigation and release checkout — 0.1.4

The main checkout tracks GitHub and builds both Windows distributions under
`dist/releases`. The publisher pushes committed source by default and uploads
release files only with `-Release`.

On Windows, 61 Node tests passed, including byte comparisons of the generated
app and both local runtime copies. Chrome passed 37 complete UI checks, 24 edge
checks, and 156 sidebar layout checks. The complete UI suite also passed on an
Edge rerun after the first run failed at the calculator focus assertion.
The navigation checks cover value entry, formula bar pointing, reference
highlighting, and the destination after Tab and Enter.

Both 0.1.4 packages built from Electron 45.2.3 and passed the release verifier's
archive, PE resource, embedded payload, and checksum checks. Native execution
of the new installer and portable ZIP remains unverified.

## Markdown filename placeholders

Bare filename placeholders such as `<repeat>_landscapes` now open as literal
text in Formatted mode. The Raw fallback still protects HTML such as `<br>`.
The Batch Tagger README opened formatted in Chrome on Windows, toggled both
ways with Ctrl+Tab, and retained its exact source. A larger variant also
promoted through the formatting worker. The edit-and-reopen regression passed.

All 61 Node tests, 37 complete UI checks, 32 edge checks, and 156 sidebar
layout checks passed. Both local runtime copies were refreshed and matched
the generated app. Native Windows interaction was not exercised.
