# Complete update verification — November 9, 2026

Release: **0.1.1 / complete-2026-11-09**. This supersedes the tab-only v2 patch.

## Scope actually included

| Requested change | Implementation | Evidence |
|---|---|---|
| Edit large files before full formatting finishes | Editable fast-text surface above 64 Ki characters; cancellable worker prepares Markdown JSON and applies it after typing settles | Actual atlas opened and edited during preparation; edits/tail preserved |
| Current and changed file sizes | Last disk byte size plus prospective UTF-8 save size, including worksheet metadata; exact bytes in tooltip | UTF-8 unit tests and UI before/after worksheet edits |
| Transfer focus | Calculator expression input / spreadsheet grid receives focus | Real keyboard transfer followed by Down Arrow or calculator input |
| Row/column insert and delete | Header right-click menu; transaction updates values, formulas, dimensions; undo/redo | Unit and UI structure/undo/cross-sheet/locked-reference tests |
| Resize rows/columns | Drag header boundary; sparse dimension overrides saved in Markdown metadata; double-click resets | Actual pointer drag changes rendered dimensions; metadata round-trip tests |
| Formula pointing and F4 | `=` then arrows highlights reference, retains origin cell; F4 cycles A1 → $A$1 → A$1 → $A1 → A1 | C1, =, Left, Left test plus all four F4 states, evaluation and reopen |
| Tiny title-bar icon | Size-specific 16/20/24/32/40/48/64 DIB icon frames with validated alpha masks; native Windows window uses ICO | Binary/alpha consistency test and decoded small-frame preview; native Windows appearance NOT tested |
| Independent sidebar tabs | Prior v2 geometry retained unchanged | 156 rendered layout checks across app, bin runtime and legacy runtime |
| No source/runtime mismatch | All deployed app/desktop files and icon assets byte-compared across both runtime folders | Package equality regression test |

## Executed checks

- **52 Node unit/regression tests passed** (Node 22.16.0, Linux).
- **32 complete-update browser checks passed**, including the timing record.
- **24 additional browser safety/interaction checks passed**: formatting shortcuts, code indentation, manual formatting cancellation, focus retention after promotion, exact CRLF no-edit round-trip, locked-reference calculation, deletion/undo, and worksheet reopen.
- **156 sidebar rendered-layout checks passed** with zero renderer exceptions.
- `npm run build` succeeded through the offline source builder. `app/main.js` is rebuilt from current `src/`, not an older generated application bundle.
- Actual packaged app files are included in `bin/resources/app/` and the legacy `resources/app/` path. The ZIP contains no replacement Electron executable or runtime DLLs.

## Repeated load comparison

Fixture: user's `baseball_rules_atlas(1).md`, **632,478 bytes**, 8,679 source lines. The fixture is NOT redistributed in this update.

Three old-bundle runs and three updated runs, same headless Chromium fixture:

| Metric | Previously delivered renderer | Updated renderer |
|---|---:|---:|
| Median time to editable document | 4211.1 ms | 337.0 ms |
| Individual editable times | 4211.1, 4184.4, 4337.9 ms | 337.0, 351.2, 310.6 ms |
| Median completion of full formatting | 4213.2 ms | 4038.3 ms |

The updated renderer became editable **12.5 times sooner** in this controlled fixture. Full formatting still took roughly four seconds. The main improvement is responsiveness while parsing, not a claim that all formatting became twelve times faster.

This measures renderer initialization after passing in already-read text. It does **not** measure Windows EXE cold launch, disk reading, antivirus delays, physical keyboard handling, or GPU/OS rendering on the user's laptop. Browser scripts were injected into an isolated fixture because this environment blocks file/localhost navigation. The same shipped worker code was loaded through an in-memory Blob for the test; production uses the local worker file and retains its original CSP and Electron sandbox.

## Safety and known limits

- The worker is terminated/restarted when text changes. Outdated results cannot replace newer typing. Promotion waits for a brief typing pause and preserves a tool's current keyboard focus.
- No-edit source is preserved exactly, including CRLF line endings. Changing raw text can normalize line endings, as indicated by the changed save size. Raw and formatted undo histories remain separate; cross-mode undo unification is not part of this update.
- Unsupported/ambiguous Markdown stays Raw to avoid lossy conversion. Documents above 8 MiB of JavaScript source characters also remain Raw. There is no promise of a fully virtualized rich editor for arbitrarily large documents.
- Applying the ready rich-document tree still requires a short main-thread DOM update (about 155–166 ms in the three no-edit runs). Worker parsing doesn't make that step zero-cost.
- Spreadsheet dimensions are stored for populated worksheets; an entirely empty workbook still contributes no Markdown appendix. This remains a bounded Excel-style subset, not full Excel compatibility.
- Windows-native execution, native titlebar appearance, Explorer's icon cache, and the Windows EXE-resource update script have **not** been executed here. The existing updater is included with regenerated icon assets and synchronized main-process code.

## Reproduce

```text
npm test
npm run build
python tests/complete-ui-smoke.py --chromium PATH --fixture PATH_TO_ATLAS.md --output tests/artifacts/complete
python tests/complete-edge-smoke.py --chromium PATH --output tests/artifacts/edges
python tests/sidebar-layout-smoke.py --chromium PATH
```

Python browser checks need Playwright plus Chromium. Node core tests need no npm packages. After source edits, `npm run build:portable` refreshes the installed runtime. `npm run build:offline` explicitly selects the pinned dependency snapshot when npm dependencies are unavailable; that command alone refreshes `app/`, not `bin/`.
