# Markpad 0.1.2 verification

Release: `tables-links-logo-2026-11-09`. Checked 2026-11-09 21:53 EST.

## Executed

- `npm run build`: rebuilt from the current source using the pinned offline editor dependency snapshot. No runtime dependency installation or upgrade.
- `npm test`: 58 passed, 0 failures. Includes formula/reference operations, persistence validation, linked metadata/escaping, compact axis selections, icon masks, and byte agreement between source-generated assets and both deployed runtime folders.
- `python tests/linked-ui-smoke.py --chromium /usr/bin/chromium`: 48 passing checks including renderer boots, real header clicks, Ctrl/Shift selection, pointer-side seam targeting, shared auto-fit with offscreen content, global sizing and persistence, linked text/table insertion and bidirectional edits, whole-label multi-character replacement, undo immediately after fresh reopen, structural target moves and deletion/undo, and linked save/reopen.
- `python tests/table-editing-smoke.py`: 34 passing checks using system Chromium: blank header/body starter, caret placement, ghost navigation without serialization, growth from typed input, row/column removal and undo, focus visibility, panel-overlap narrowing and restoration, save/reopen.
- `python tests/complete-ui-smoke.py --chromium /usr/bin/chromium --fixture baseball_rules_atlas(1).md`: 32 passing baseline checks including tool focus, formula pointing/F4, structural edits and sizing, file sizes, retained tab independence, staged atlas editing and preservation during formatting. Browser fixture only; no Windows performance claim.
- `python tests/sidebar-layout-smoke.py --chromium /usr/bin/chromium`: 156 layout checks passed across source and both runtime locations; no renderer exceptions.
- Supplied revised black-and-white PNG copied byte-for-byte as the icon source. Generated ICO frames at 16, 20, 24, 32, 40, 48, 64, 128, and 256 pixels decoded successfully. Small-frame DIB masks validated. Native-size and enlarged previews visually reviewed.
- Actual table overlap screenshot visually reviewed.

JSON results and core-test output are in `verification-tables-links-logo/`. Counts include boot/no-exception assertions; they are not counts of distinct new features.

## Fix found during verification

Loading content had been able to join the first typed change in undo history, so the first Undo after reopening could clear the loaded document. Loading and formatted promotion now set `addToHistory=false` and close the history group. The first linked edit after a fresh reload and its Undo are covered by the focused browser test. Peer synchronization also preserves stored typing marks.

## Target-platform limits

All browser checks ran on Linux/Chromium with an isolated desktop-bridge stub. They do not establish that native Electron file dialogs, Windows titlebar/taskbar rendering, the PowerShell executable-resource updater, registry updates, or Windows icon-cache notifications ran successfully on Windows. No real user drafts or chosen default applications were changed.

The Windows updater is included and must be run locally with every Markpad window closed to embed the icon in the existing EXE and update matching root shortcuts. The ZIP includes no replacement Electron EXE.
