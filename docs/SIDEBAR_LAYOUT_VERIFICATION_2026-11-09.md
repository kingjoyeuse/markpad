# Independent sidebar tabs — revision 2

## Scope
Only sidebar-tab markup/positioning and regression coverage change. The calculator icon remains the supplied simple calculator SVG. The spreadsheet tab stays at the bottom. No editor model, spreadsheet data, executable, or recovery format is changed.

## Fix
The calculator and spreadsheet tabs are now separate direct children of `#workspace`. The old shared `#ribbon` element and its accumulated CSS rules have been removed. Each control is independently positioned using its own `aria-expanded` state. A closed tab sits immediately before the document scrollbar; an open tab sits 4 pixels left of its own panel. Nothing shifts a common ancestor when either tool opens.

Both current `bin/resources/app/app/` and legacy `resources/app/app/` HTML/CSS copies are included. Their contents are byte-identical to the preview/source files. This avoids leaving an older runtime location with different sidebar behavior.

## Executed checks
- All 39 Node regression tests passed.
- 156 real Chromium renderer geometry checks passed, with no page errors.
- Checked all four panel states, both opening orders, closing in either order, light/dark themes, three deployed/preview locations, blank and scrollable content, narrower windows, panel-width changes, window resizing, and Raw/Formatted mode switching.
- Explicitly asserted the OTHER tab's horizontal position does not change on each click.
- Injected an obsolete shared-ribbon CSS rule and verified it cannot affect the new markup.
- Inspected screenshots for spreadsheet-only and calculator-only states.

The renderer tests use the actual bundled application code with an isolated in-memory substitute for Electron's native bridge. They do not access real notes or recovery profiles. The Windows EXE/native window was not executed here.

## Reproduce
`npm test`

`python tests/sidebar-layout-smoke.py --chromium /path/to/chromium`

Python Playwright is required only for this development test, not to run Markpad. Omit `--chromium` to use Playwright's installed browser.

## Future changes
Keep the two buttons as independent children of `#workspace`. Do not reintroduce a shared translated/inset ribbon. Test geometry in the running renderer rather than relying only on matching CSS strings. Refresh the application's deployed assets whenever changing source.
