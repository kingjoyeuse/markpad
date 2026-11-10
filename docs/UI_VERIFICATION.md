# Markpad UI verification

Verified 2026-11-09 against the built Markpad 0.1.0 renderer.

**Result: 15 test groups passed, 0 failed, with no uncaught renderer errors.**
The machine-readable evidence is [ui-smoke-results.json](ui-smoke-results.json).
The executable test is [tests/ui-smoke.py](../tests/ui-smoke.py).

## What was exercised

| Test group | Verified behavior |
| --- | --- |
| Typed Markdown and mode toggle | Heading, bold, italic, strikethrough and inline code become formatted while typing. Ctrl+Tab switches modes and preserves the same Markdown through the round trip. |
| List and quote input | Unordered lists continue on Enter; blockquote syntax becomes a quote. |
| Additional Markdown input | Ordered lists, unchecked and checked task items, Markdown links, a code fence followed by a space, and a horizontal rule become formatted. |
| Formatting toolbar | Toolbar actions affect the selected document range after the toolbar receives a click. |
| Calculator and raw document selection | Currency text is evaluated; changing the calculator and inserting its result replaces exactly the earlier selected line. Show, hide and ribbon toggles work. |
| Calculator and formatted document selection | The selected rich-text content is replaced correctly. Moving the caret to the end, using the calculator, and inserting again inserts at the caret instead of replacing the previous result. |
| Calculator keypad and inline shortcuts | Alt+Shift+keypad Enter inserts a calculator result; the main Enter key does not substitute for the keypad key. Alt+Ctrl+Shift+Right appends ` = result` without opening either pane. |
| Numeric context menu | Send to calc is disabled for nonnumeric text and enabled for a valid currency value. |
| Spreadsheet transfers and document source | Alt+Ctrl+Right stores a selected equation as a formula. Left and keypad Enter transfer the active cell value to the document. Calculator sits above spreadsheet. Generated Markdown includes worksheet data and excludes temporary calculator state. |
| Spreadsheet editing and history | Relative fill down, dependent formulas, SUM, undo, redo, F2, Escape and double-click editing work. The grid renders fewer than 200 cell elements for the tested viewport instead of rendering the entire sheet. |
| Named worksheet tabs | Rename, add, cross-sheet formulas, Ctrl+PageUp/Down, and named Markdown sections work. |
| Spreadsheet clipboard | Copy/paste of a two-cell range preserves the numeric cell and adjusts the formula's relative reference. |
| Unsupported Markdown preservation | HTML and unused link-reference definitions remain unchanged in raw mode. HTML-looking text inside inline code can return to formatted mode and remains intact. |
| Raw spreadsheet conflict | Directly changing a generated Markdown table does not silently restore stale sidebar values or append a duplicate workbook. The edited source remains intact and a warning is shown. |
| Themes and draft recovery | Explicit light/dark choices work. Reloading the same browser draft restores its text, and the draft appears in Recent. |

## Runtime and method

The runner used the installed Electron 45.2.3 renderer and Python Playwright on
Linux. It created an isolated temporary browser profile, served the built `app/`
directory from a local HTTP server, and performed actual keyboard, pointer,
clipboard and form interactions. The window viewport was 1280 × 900 pixels.

The test harness has no desktop preload bridge. It runs the application's
browser development fallback, with `nodeIntegration: false`,
`contextIsolation: true` and `sandbox: true`. Its only application inspection
API is the read-only `window.markpadInspect` surface. The tests do not inject
workbook or editor state through that API.

The HTTP server, Electron subprocess and CDP connection run within the same
test invocation. This accommodates environments where separate command
invocations have isolated loopback networking. All test subprocesses and
temporary profiles are cleaned up on exit.

## Reproduce

Install the project's npm dependencies and Python Playwright, then run:

```sh
npm run build
python3 tests/ui-smoke.py --report docs/ui-smoke-results.json
```

To repeat one group, pass a distinctive fragment of its name:

```sh
python3 tests/ui-smoke.py --only "rich document" --report caret-results.json
```

`--screenshots` also renders a realistic note with calculator and worksheet data
in light and dark system-theme states at 1280 × 860. Those captures are internal
QA artifacts in `tests/artifacts/`; they are excluded from the distributed
source package.

## Scope of the evidence

This is renderer and interaction validation. Browser draft recovery here uses
the development fallback's localStorage. Native atomic file writes, native
recovery snapshots, file dialogs and close handshakes are separate desktop-host
verification concerns; this report does not claim to test those through the
browser fallback.

The tests do not establish Windows launch behavior, physical Windows keyboard
routing, operating-system process locking, hardware IME behavior, or a measured
CPU/RAM/startup target. IME shortcut guards were reviewed in source, but a real
IME session was not exercised by this keyboard harness. Spreadsheet coverage is
for Markpad's implemented functions and shortcuts, not full Excel compatibility.
