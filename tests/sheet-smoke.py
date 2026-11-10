"""Exercise the real SpreadsheetView DOM inside an isolated Electron fixture.

Requires the project npm dependencies and Python's playwright package. No
Playwright browser download is needed: the installed Electron runtime is used.

Usage: python tests/sheet-smoke.py --output /path/to/verification-output
An optional --electron path overrides the project's installed runtime.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--electron', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
    runtime = root / 'node_modules' / 'electron' / 'dist'
    executable = args.electron or (
        runtime / 'electron.exe' if sys.platform == 'win32' else
        runtime / 'Electron.app' / 'Contents' / 'MacOS' / 'Electron' if sys.platform == 'darwin' else
        runtime / 'electron'
    )
    node = shutil.which('node') or os.environ.get('CODEX_PRIMARY_RUNTIME_NODE')
    if not node:
        raise RuntimeError('Node.js is required to bundle the verification fixture.')
    if not executable.is_file():
        raise RuntimeError(f'Electron executable not found: {executable}')
    source_hash = hashlib.sha256((root / 'src' / 'ui' / 'spreadsheet.js').read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='markpad-sheet-smoke-') as temporary:
        fixture = Path(temporary)
        subprocess.run([node, str(root / 'tests' / 'sheet-smoke-build.mjs'), str(fixture)], cwd=root, check=True)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        endpoint = f'http://127.0.0.1:{port}'
        environment = {**os.environ, 'MARKPAD_SHEET_FIXTURE': str(fixture)}
        arguments = [str(executable), '--disable-gpu', f'--remote-debugging-port={port}']
        if sys.platform == 'linux':
            arguments += ['--no-sandbox', '--ozone-platform=headless']
        arguments.append(str(root / 'tests' / 'sheet-smoke.cjs'))
        log_path = fixture / 'electron.log'
        with log_path.open('w') as log:
            process = subprocess.Popen(arguments, cwd=root, env=environment, stdout=log, stderr=log)
            try:
                for _ in range(150):
                    if process.poll() is not None:
                        raise RuntimeError('Electron exited before its debugging endpoint was ready.')
                    try:
                        urllib.request.urlopen(endpoint + '/json/version', timeout=0.2).read()
                        break
                    except Exception:
                        time.sleep(0.1)
                else:
                    raise RuntimeError('Electron debugging endpoint did not become ready.')
                result = run_checks(endpoint)
                result.update({
                    'timestamp_utc': datetime.now(timezone.utc).isoformat(),
                    'platform': platform.platform(),
                    'python_version': platform.python_version(),
                    'electron_version': json.loads((root / 'node_modules' / 'electron' / 'package.json').read_text())['version'],
                    'spreadsheet_source_sha256': source_hash,
                    'scope': 'Isolated SpreadsheetView Electron renderer fixture; production desktop shell and final packaged bundle are not covered.',
                })
                if args.output:
                    (args.output / 'sheet-smoke-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
                print(json.dumps(result, indent=2))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                log.flush()
                if args.output:
                    shutil.copyfile(log_path, args.output / 'sheet-smoke-electron.log')


def run_checks(endpoint):
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(endpoint)
        page = browser.contexts[0].pages[0]
        # Ozone's headless surface can otherwise report a 1x1 viewport even if
        # the BrowserWindow has normal dimensions. Explicit emulation makes
        # pointer hit testing and virtual-grid layout meaningful in this test.
        page.set_viewport_size({'width': 900, 'height': 700})
        page.wait_for_function('!!window.sheet')
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        page.locator('.sheet-grid').focus()
        page.keyboard.type('12')
        page.keyboard.press('Enter')
        page.keyboard.type('=A1*2')
        page.keyboard.press('Enter')
        initial = page.evaluate('({a2:sheet.evaluate(sheet.sheet.id,"A2"),active:sheet.activeCell})')
        assert initial == {'a2': 24, 'active': 'A3'}, initial
        checks.append('Typing numbers/formulas and Enter commits with correct recalculation')

        page.evaluate('()=>{sheet.activeCell="A2";sheet.select({row:4,col:0},true);}')
        page.keyboard.press('Control+d')
        assert page.evaluate('sheet.sheet.cells.A5') == '=A4*2'
        assert page.evaluate('sheet.evaluate(sheet.sheet.id,"A5")') == 192
        page.keyboard.press('Control+z')
        assert not page.evaluate('!!sheet.sheet.cells.A5')
        page.keyboard.press('Control+y')
        assert page.evaluate('sheet.sheet.cells.A5') == '=A4*2'
        checks.append('Relative Ctrl+D fill, undo, and redo')

        page.evaluate('sheet.activeCell="B1"')
        page.locator('.sheet-formula').fill('=SUM(A1:A5)')
        page.locator('.sheet-formula').press('Enter')
        assert page.evaluate('sheet.evaluate(sheet.sheet.id,"B1")') == 372
        checks.append('Formula bar edit and SUM range evaluation')

        page.evaluate('sheet.activeCell="C1"')
        page.locator('[data-row="0"][data-col="2"]').dblclick()
        assert page.locator('.sheet-edit').count() == 1
        page.locator('.sheet-edit').fill('cancel me')
        page.locator('.sheet-edit').press('Escape')
        assert not page.evaluate('!!sheet.sheet.cells.C1')
        checks.append('Pointer double-click starts a cell edit; Escape discards pending input')

        page.locator('.sheet-tab').dblclick()
        page.locator('.sheet-tab-rename').fill('Costs')
        page.locator('.sheet-tab-rename').press('Enter')
        assert page.evaluate('sheet.sheet.name') == 'Costs'
        checks.append('Pointer double-click and inline worksheet rename')

        page.evaluate('sheet.activeCell="D1"')
        page.locator('.sheet-grid').focus()
        page.keyboard.press('F2')
        page.locator('.sheet-edit').fill('hello')
        page.locator('.sheet-edit').press('Tab')
        assert page.evaluate('sheet.sheet.cells.D1') == 'hello'
        assert page.evaluate('sheet.activeCell') == 'E1'
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('sheet.activeCell') == 'D1'
        page.evaluate('sheet.activeCell="A1"')
        page.keyboard.press('Shift+ArrowDown')
        assert page.evaluate('sheet.range().bottom') == 1
        checks.append('F2, Tab/Shift+Tab, and Shift+Arrow selection')

        page.evaluate(r'''()=>{
          sheet.activeCell='A10'; const transfer=new DataTransfer();
          transfer.setData('text/plain','1\t2\n3\t4');
          sheet.grid.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
        }''')
        assert page.evaluate('sheet.sheet.cells.B11') == '4'
        page.evaluate(r'''()=>{
          sheet.activeCell='A2'; const transfer=new DataTransfer();
          sheet.grid.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:transfer}));
          sheet.activeCell='B3';
          sheet.grid.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
        }''')
        assert page.evaluate('sheet.sheet.cells.B3') == '=B2*2'
        checks.append('Clipboard-event TSV rectangle paste and relative formula copy/paste')

        page.evaluate(r'''()=>{
          sheet.activeCell='C10'; sheet.receiveText('A1-1');
          sheet.activeCell='C11'; sheet.receiveText('1/0');
          sheet.activeCell='D10'; sheet.receiveText('00123');
          sheet.activeCell='D11'; sheet.receiveText('ordinary text');
        }''')
        assert page.evaluate('sheet.sheet.cells.C10') == '=A1-1'
        assert page.evaluate('sheet.sheet.cells.C11') == '=1/0'
        assert page.evaluate('sheet.sheet.cells.D10') == '123'
        assert page.evaluate('sheet.sheet.cells.D11') == 'ordinary text'
        checks.append('Reference equations, error-producing equations, numeric conversion, and ordinary-text transfer')

        page.locator('.sheet-add').click()
        page.locator('.sheet-tab-rename').fill('Totals')
        page.locator('.sheet-tab-rename').press('Enter')
        page.locator('.sheet-formula').fill("='Costs'!A1")
        page.locator('.sheet-formula').press('Enter')
        assert page.evaluate('sheet.evaluate(sheet.sheet.id,"A1")') == 12
        page.get_by_role('tab', name='Costs', exact=True).click()
        page.get_by_role('tab', name='Costs', exact=True).dblclick()
        page.locator('.sheet-tab-rename').fill('Rates')
        page.locator('.sheet-tab-rename').press('Enter')
        page.get_by_role('tab', name='Totals', exact=True).click()
        assert page.evaluate('sheet.sheet.cells.A1') == "='Rates'!A1"
        assert page.evaluate('sheet.evaluate(sheet.sheet.id,"A1")') == 12
        checks.append('Add/switch worksheets; cross-sheet references survive tab rename')

        page.get_by_role('tab', name='Totals', exact=True).click(button='right')
        page.get_by_role('button', name='Delete worksheet', exact=True).click()
        assert page.evaluate('sheet.workbook.sheets.length') == 1
        page.keyboard.press('Control+z')
        assert page.evaluate('sheet.workbook.sheets.length') == 2
        assert page.evaluate('sheet.workbook.sheets.some(s=>s.name==="Totals"&&s.cells.A1==="=\'Rates\'!A1")')
        checks.append('Explicit worksheet deletion and undo restore its formula data')

        page.get_by_role('tab', name='Rates', exact=True).click()
        page.evaluate('sheet.activeCell="A600"')
        page.locator('.sheet-grid').focus()
        page.keyboard.type('9')
        page.keyboard.press('Enter')
        assert page.evaluate('sheet.sheet.cells.A600') == '9'
        page.keyboard.press('Control+Home')
        assert page.evaluate('sheet.activeCell') == 'A1'
        page.keyboard.press('Control+End')
        assert page.evaluate('sheet.activeCell') == 'D600'
        assert page.locator('.sheet-cell').count() < 200
        checks.append('Distant row edit, Ctrl+Home/End, and viewport-bounded cell DOM')
        assert not errors, errors
        return {
            'passed': True,
            'checks': checks,
            'observed': page.evaluate('({activeCell:sheet.activeCell,sheets:sheet.workbook.sheets.map(s=>s.name),renderedCells:document.querySelectorAll(".sheet-cell").length,totalRows:sheet.rows,totalColumns:sheet.cols,committedChanges:changes,notices})'),
            'limitations': [
                'Clipboard tests dispatch real DOM ClipboardEvents with DataTransfer payloads; operating-system clipboard interoperability was not exercised.',
                'This fixture does not test document/sidebar selection bookmarks, native application menus, filesystem recovery, or the final Windows package.',
                'The measured DOM cell count establishes virtual rendering, not a RAM or typing-latency benchmark.',
            ],
        }


if __name__ == '__main__':
    main()
