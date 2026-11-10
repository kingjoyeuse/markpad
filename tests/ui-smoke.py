#!/usr/bin/env python3
"""Real DOM/keyboard smoke tests; no application state is modified through JS.

Uses the installed Electron renderer with a minimal browser-fallback harness.
The app's native filesystem/recovery host has separate desktop smoke tests.
An HTTP server, Electron and CDP connection live in one process invocation so
this runner also works in environments with isolated loopback namespaces.
Requires Python Playwright and npm dependencies/build output.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
import uuid

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = []
ERRORS = []


def equal(actual, expected, description=""):
    assert actual == expected, f"{description}: expected {expected!r}; got {actual!r}"


def source(page):
    return page.evaluate("window.markpadInspect.source()")


def state(page):
    return page.evaluate("window.markpadInspect.state()")


def selected_line(page, line=0):
    raw = page.locator("#raw-editor")
    raw.focus()
    page.keyboard.press("Control+Home")
    for _ in range(line):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Home")
    page.keyboard.press("Shift+End")


def raw_text(page, text):
    if state(page)["mode"] != "raw":
        page.locator("#mode-toggle").click()
    raw = page.locator("#raw-editor")
    raw.fill(text)
    return raw


def select_all_raw(page, text):
    raw = raw_text(page, text)
    raw.press("Control+a")
    return raw


def workbook_cells(page, sheet=0):
    return state(page)["sheets"][sheet]["cells"]


def grid_cell(page, address, value):
    # Address navigation uses the visible grid's standard keyboard shortcuts.
    grid = page.locator(".sheet-grid")
    grid.focus()
    grid.press("Control+Home")
    col = ord(address[0].upper()) - ord("A")
    row = int(address[1:]) - 1
    for _ in range(row):
        grid.press("ArrowDown")
    for _ in range(col):
        grid.press("ArrowRight")
    grid.press("F2")
    page.locator(".sheet-edit").fill(value)
    page.locator(".sheet-edit").press("Enter")


def check_rich_input(page):
    rich = page.locator(".tiptap")
    rich.click()
    page.keyboard.type("# Heading", delay=5)
    page.keyboard.press("Enter")
    page.keyboard.type("A **bold** *italic* ~~strike~~ `code` word", delay=5)
    expect(rich.locator("h1")).to_have_text("Heading")
    expect(rich.locator("strong")).to_have_text("bold")
    expect(rich.locator("em")).to_have_text("italic")
    expect(rich.locator("s")).to_have_text("strike")
    expect(rich.locator("code")).to_have_text("code")
    before = source(page)
    page.keyboard.press("Control+Tab")
    expect(page.locator("#raw-editor")).to_be_visible()
    assert "**bold**" in source(page)
    page.keyboard.press("Control+Tab")
    equal(state(page)["mode"], "formatted")
    equal(source(page), before, "Mode toggle round trip")
    expect(rich.locator("strong")).to_have_text("bold")


def check_block_input(page):
    rich = page.locator(".tiptap")
    rich.click()
    page.keyboard.type("- item", delay=5)
    expect(rich.locator("ul li")).to_have_text("item")
    page.keyboard.press("Enter")
    page.keyboard.type("second", delay=5)
    equal(rich.locator("ul li").count(), 2)
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.keyboard.type("> quote", delay=5)
    expect(rich.locator("blockquote")).to_have_text("quote")


def check_more_markdown_input(page):
    base=page.url.split('?')[0]
    failures=[]
    cases=[
        ("1. first","ol li","first"),
        ("- [ ] todo",'ul[data-type="taskList"] li[data-checked="false"] > div',"todo"),
        ("- [x] done",'ul[data-type="taskList"] li[data-checked="true"] > div',"done"),
        ("[site](https://example.com)","a","site"),
        ("```js ","pre code",None),
        ("--- ","hr",None),
    ]
    for text,selector,expected in cases:
        page.goto(base+"?session=syntax-"+uuid.uuid4().hex)
        page.wait_for_function("Boolean(window.markpadInspect)")
        rich=page.locator('.tiptap');rich.click()
        page.keyboard.type(text,delay=5)
        try:
            if expected is not None: expect(rich.locator(selector)).to_have_text(expected)
            else: expect(rich.locator(selector)).to_have_count(1)
        except Exception:
            failures.append({"typed":text,"selector":selector,"actual":rich.inner_html()})
    assert not failures,json.dumps(failures)


def check_toolbar_bookmark(page):
    raw_text(page, "before\nselected\nafter")
    selected_line(page, 1)
    page.locator('[data-format="bold"]').click()
    equal(source(page), "before\n**selected**\nafter", "Raw toolbar selection")
    page.locator("#mode-toggle").click()
    page.locator(".tiptap").focus()
    page.keyboard.press("Control+Home")
    page.keyboard.press("Control+a")
    page.locator('[data-format="italic"]').click()
    assert "selected" in page.locator(".tiptap em").all_text_contents()[0] or page.locator(".tiptap em").count() >= 1


def check_calculator_bookmark(page):
    raw_text(page, "before\n$1,234.50\nafter")
    selected_line(page, 1)
    page.keyboard.press("Alt+Shift+ArrowRight")
    equal(state(page)["calculator"], 1234.5)
    equal(state(page)["calcShown"], True)
    page.locator("#calc-expression").fill("2+3*4")
    expect(page.locator("#calc-result")).to_have_text("14")
    page.locator("#calc-insert").click()
    equal(source(page), "before\n14\nafter", "Calculator preserves document replacement range")
    page.keyboard.press("Alt+Shift+ArrowDown")
    equal(state(page)["calcShown"], False)
    page.keyboard.press("Alt+Shift+ArrowUp")
    equal(state(page)["calcShown"], True)
    page.locator("#calc-tab").click()
    equal(state(page)["calcShown"], False)


def check_rich_calculator_bookmark(page):
    rich=page.locator(".tiptap")
    rich.click()
    page.keyboard.type("123")
    page.keyboard.press("Control+a")
    page.keyboard.press("Alt+Shift+ArrowRight")
    page.locator("#calc-expression").fill("99")
    page.locator("#calc-insert").click()
    equal(rich.inner_text().strip(), "99", "Rich selection survives pane focus")
    rich.focus()
    page.keyboard.press("Control+End")
    page.wait_for_function("window.getSelection()?.isCollapsed === true")
    page.locator("#calc-expression").fill("7")
    page.locator("#calc-insert").click()
    equal(rich.inner_text().strip(), "997", "Rich caret insertion survives pane focus")


def check_calc_keypad_and_inline(page):
    select_all_raw(page, "replace me")
    page.keyboard.press("Alt+Shift+ArrowUp")
    page.locator("#calc-expression").fill("42")
    page.keyboard.press("Alt+Shift+Enter")
    equal(source(page), "replace me", "Main Enter is not keypad Enter")
    page.keyboard.press("Alt+Shift+NumpadEnter")
    equal(source(page), "42", "Keypad Enter transfers calculator result")
    page.keyboard.press("Alt+Shift+ArrowDown")
    raw_text(page, "before\n6*7\nafter")
    selected_line(page, 1)
    page.keyboard.press("Alt+Control+Shift+ArrowRight")
    equal(source(page), "before\n6*7 = 42\nafter")
    equal(state(page)["calcShown"], False, "Inline evaluation leaves calculator closed")
    equal(state(page)["sheetShown"], False, "Inline evaluation leaves spreadsheet closed")


def check_context_menu(page):
    raw=select_all_raw(page, "letters")
    raw.click(button="right",position={"x":45,"y":35})
    option=page.locator("#popup-menu button").filter(has=page.locator('span',has_text="Send to calc"))
    expect(option).to_be_disabled()
    page.keyboard.press("Escape")
    raw=select_all_raw(page, "$1,200.50")
    raw.click(button="right",position={"x":45,"y":35})
    expect(option).to_be_enabled()
    option.click()
    equal(state(page)["calculator"],1200.5)


def check_spreadsheet_transfers(page):
    raw_text(page,"before\n2+3\nafter")
    selected_line(page,1)
    page.keyboard.press("Alt+Control+ArrowRight")
    equal(state(page)["sheetShown"],True)
    equal(workbook_cells(page).get("A1"),"=2+3")
    expect(page.locator("#sheet-cell-0-0")).to_have_text("5")
    page.locator(".sheet-formula").fill("=6*7")
    page.locator(".sheet-formula").press("Enter")
    # Formula Enter advances to A2, so restore A1 through regular grid keys.
    page.locator(".sheet-grid").press("Control+Home")
    page.keyboard.press("Alt+Control+ArrowLeft")
    assert source(page).startswith("before\n42\nafter"), source(page)
    # Keypad alternative uses the selected cell, preserving a document selection.
    selected_line(page,1)
    page.locator(".sheet-grid").focus()
    page.keyboard.press("Alt+Control+NumpadEnter")
    assert source(page).startswith("before\n42\nafter"), source(page)
    page.keyboard.press("Alt+Control+ArrowDown")
    equal(state(page)["sheetShown"],False)
    page.keyboard.press("Alt+Control+ArrowUp")
    equal(state(page)["sheetShown"],True)
    page.keyboard.press("Alt+Shift+ArrowUp")
    calc=page.locator("#calculator").bounding_box()
    sheet=page.locator("#spreadsheet").bounding_box()
    assert calc["y"]+calc["height"] <= sheet["y"]+1
    page.locator("#calc-expression").fill("987654321")
    assert "987654321" not in source(page), "Temporary calculator state leaked into Markdown"
    assert "## Data" in source(page)
    assert "markpad:workbook:v1" in source(page)


def check_sheet_grid(page):
    page.locator("#sheet-tab").click()
    grid_cell(page,"A1","12")
    grid_cell(page,"A2","=A1*2")
    grid=page.locator(".sheet-grid")
    grid.press("Control+Home")
    grid.press("ArrowDown")
    for _ in range(3): grid.press("Shift+ArrowDown")
    grid.press("Control+d")
    equal(workbook_cells(page).get("A5"),"=A4*2")
    expect(page.locator("#sheet-cell-4-0")).to_have_text("192")
    grid.press("Control+z")
    assert "A5" not in workbook_cells(page)
    grid.press("Control+y")
    equal(workbook_cells(page).get("A5"),"=A4*2")
    grid_cell(page,"B1","=SUM(A1:A5)")
    expect(page.locator("#sheet-cell-0-1")).to_have_text("372")
    grid.press("Control+Home")
    grid.press("F2")
    page.locator(".sheet-edit").fill("999")
    page.locator(".sheet-edit").press("Escape")
    equal(workbook_cells(page).get("A1"),"12")
    page.locator("#sheet-cell-0-0").dblclick()
    expect(page.locator(".sheet-edit")).to_be_visible()
    page.locator(".sheet-edit").press("Escape")
    assert page.locator(".sheet-cell").count()<200, "Grid renders too many offscreen cells"


def check_sheet_tabs(page):
    page.locator("#sheet-tab").click()
    grid_cell(page,"A1","12")
    page.locator(".sheet-tab").dblclick()
    rename=page.get_by_label("Worksheet name")
    rename.fill("Budget")
    rename.press("Enter")
    equal(state(page)["sheets"][0]["name"],"Budget")
    page.get_by_label("Add worksheet").click()
    rename=page.get_by_label("Worksheet name")
    rename.fill("Other")
    rename.press("Enter")
    equal(len(state(page)["sheets"]),2)
    grid_cell(page,"A1","=Budget!A1*2")
    expect(page.locator("#sheet-cell-0-0")).to_have_text("24")
    page.locator(".sheet-grid").press("Control+PageUp")
    expect(page.locator(".sheet-tab.active")).to_have_text("Budget")
    page.locator(".sheet-grid").press("Control+PageDown")
    expect(page.locator(".sheet-tab.active")).to_have_text("Other")
    assert "## Budget" in source(page) and "## Other" in source(page)


def check_sheet_clipboard(page):
    page.locator("#sheet-tab").click()
    grid_cell(page,"A1","10")
    grid_cell(page,"B1","=A1*2")
    grid=page.locator(".sheet-grid")
    grid.press("Control+Home")
    grid.press("Shift+ArrowRight")
    grid.press("Control+c")
    grid.press("Control+Home")
    grid.press("ArrowDown")
    grid.press("Control+v")
    equal(workbook_cells(page).get("A2"),"10")
    equal(workbook_cells(page).get("B2"),"=A2*2")


def check_preservation(page):
    original='<span data-x="keep">HTML text</span>\n\n[unused]: https://example.com "Keep this title"\n'
    raw_text(page,original)
    page.locator("#mode-toggle").click()
    equal(state(page)["mode"],"raw")
    equal(source(page),original)
    expect(page.locator("#document-alert")).to_be_visible()
    supported="Use `<span>` as an example, not as HTML."
    page.locator("#raw-editor").fill(supported)
    page.locator("#mode-toggle").click()
    equal(state(page)["mode"],"formatted")
    expect(page.locator(".tiptap code")).to_have_text("<span>")
    equal(source(page),supported)


def check_raw_workbook_conflict(page):
    page.locator("#sheet-tab").click()
    grid_cell(page,"A1","=2+3")
    page.locator("#mode-toggle").click()
    original=source(page)
    edited=original.replace("| 5 |","| 9 |")
    assert edited!=original
    page.locator("#raw-editor").fill(edited)
    page.locator(".sheet-grid").click()
    # A safe conflict policy may hide/lock the grid or show a warning. It must
    # preserve the externally edited source, not restore 5 or append a workbook.
    equal(source(page),edited)
    equal(source(page).count("markpad:workbook:v1:start"),1)
    expect(page.locator("#document-alert")).to_be_visible()


def check_theme_and_recovery(page):
    raw_text(page,"A recoverable note")
    expect(page.locator("#document-state")).to_have_text("Draft preserved",timeout=5000)
    page.locator("#theme-button").click()
    page.locator("#popup-menu button").filter(has_text="Dark").click()
    equal(page.locator("html").get_attribute("data-theme"),"dark")
    page.locator("#theme-button").click()
    page.locator("#popup-menu button").filter(has_text="Light").click()
    equal(page.locator("html").get_attribute("data-theme"),"light")
    page.reload()
    page.wait_for_function("Boolean(window.markpadInspect)")
    equal(source(page),"A recoverable note")
    page.locator('[data-action="recent"]').click()
    expect(page.locator(".recent-row")).not_to_have_count(0)


def capture_layout(page,origin):
    page.goto(origin+"/?session=layout-"+uuid.uuid4().hex)
    page.wait_for_function("Boolean(window.markpadInspect)")
    page.set_viewport_size({"width":1280,"height":860})
    raw_text(page,"# Workshop notes\n\nA quieter place to write, with **numbers close at hand**.\n\n## Friday checklist\n\n- [x] Confirm the parts order\n- [ ] Review the revised budget\n- [ ] Send the final estimate\n\n## Cost estimate\n\nParts subtotal: **$161.00**\n\nAllow 15% for small extras and delivery.\n\n> Keep the note simple. Save the working figures alongside it.\n")
    page.locator("#mode-toggle").click()
    page.locator("#sheet-tab").click()
    for address,value in [("A1","Item"),("B1","Cost"),("A2","Boards"),("B2","125"),("A3","Cables"),("B3","36"),("A4","Total"),("B4","=SUM(B2:B3)")]: grid_cell(page,address,value)
    page.locator("#calc-tab").click()
    page.locator("#calc-expression").fill("161 * 1.15")
    page.locator("#theme-button").click()
    page.locator("#popup-menu button").filter(has_text="System").click()
    page.locator(".tiptap").focus()
    folder=ROOT/"tests"/"artifacts";folder.mkdir(exist_ok=True)
    for theme in ["light","dark"]:
        page.emulate_media(color_scheme=theme)
        expect(page.locator("html")).to_have_attribute("data-theme",theme)
        page.screenshot(path=str(folder/f"markpad-{theme}.png"))


TESTS=[
    ("typed Markdown and Ctrl+Tab source roundtrip",check_rich_input),
    ("list and quote input rules",check_block_input),
    ("ordered list, task, link, code fence and rule input",check_more_markdown_input),
    ("toolbar preserves selected document range",check_toolbar_bookmark),
    ("calculator transfer and raw replacement bookmark",check_calculator_bookmark),
    ("rich document selection and caret bookmark",check_rich_calculator_bookmark),
    ("keypad Enter and inline calculation shortcuts",check_calc_keypad_and_inline),
    ("context-menu numeric validation",check_context_menu),
    ("spreadsheet transfers, layout and Markdown source",check_spreadsheet_transfers),
    ("spreadsheet fill, formulas, undo and editing",check_sheet_grid),
    ("spreadsheet named tabs and cross-sheet formulas",check_sheet_tabs),
    ("spreadsheet multicell clipboard and relative references",check_sheet_clipboard),
    ("unsupported Markdown remains intact in raw mode",check_preservation),
    ("raw table edit conflict retains user changes",check_raw_workbook_conflict),
    ("light/dark themes and browser draft recovery",check_theme_and_recovery),
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--report",default=str(ROOT/"tests"/"ui-smoke-results.json"))
    parser.add_argument("--only",default="")
    parser.add_argument("--screenshots",action="store_true")
    args=parser.parse_args()
    server=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(QuietHandler,directory=str(ROOT/"app")))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f"http://127.0.0.1:{server.server_port}"
    with tempfile.TemporaryDirectory(prefix="markpad-ui-") as temporary:
        temp=Path(temporary)
        with socket.socket() as endpoint:
            endpoint.bind(("127.0.0.1",0)); port=endpoint.getsockname()[1]
        harness=temp/"browser-harness.cjs"
        harness.write_text("const {app,BrowserWindow}=require('electron');\n"
            +"app.setPath('userData',"+json.dumps(str(temp/"profile"))+");\n"
            +"app.disableHardwareAcceleration();\n"
            +"app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadURL("+json.dumps(origin)+");});\n",encoding="utf-8")
        binary=ROOT/"node_modules"/"electron"/"dist"/("electron.exe" if sys.platform=="win32" else "electron")
        with (temp/"electron.log").open("w") as log:
            process=subprocess.Popen([str(binary),"--no-sandbox","--disable-gpu","--ozone-platform=headless",f"--remote-debugging-port={port}",str(harness)],stdout=log,stderr=log)
            try:
                endpoint=f"http://127.0.0.1:{port}"
                deadline=time.monotonic()+20
                while True:
                    try:
                        with urllib.request.urlopen(endpoint+"/json/version",timeout=.5) as response: json.load(response)
                        break
                    except Exception:
                        if process.poll() is not None or time.monotonic()>deadline:
                            raise RuntimeError("Electron harness did not start:\n"+(temp/"electron.log").read_text())
                        time.sleep(.15)
                with sync_playwright() as playwright:
                    browser=playwright.chromium.connect_over_cdp(endpoint)
                    context=browser.contexts[0]
                    context.set_default_timeout(7000)
                    try: context.grant_permissions(["clipboard-read","clipboard-write"],origin=origin)
                    except Exception: pass
                    page=context.pages[0] if context.pages else context.wait_for_event("page",timeout=15000)
                    page.set_viewport_size({"width":1280,"height":900})
                    page.on("pageerror",lambda error: ERRORS.append(str(error)))
                    for label,check in TESTS:
                        if args.only and args.only.lower() not in label.lower(): continue
                        started=time.monotonic(); error_start=len(ERRORS)
                        try:
                            page.goto(origin+"/?session=smoke-"+uuid.uuid4().hex)
                            page.wait_for_function("Boolean(window.markpadInspect)")
                            check(page)
                            if len(ERRORS)>error_start: raise AssertionError("Uncaught renderer errors: "+repr(ERRORS[error_start:]))
                            result={"test":label,"passed":True,"seconds":round(time.monotonic()-started,3)}
                            print("PASS",label,flush=True)
                        except Exception as error:
                            result={"test":label,"passed":False,"seconds":round(time.monotonic()-started,3),"error":str(error),"traceback":traceback.format_exc()}
                            print("FAIL",label,str(error),flush=True)
                        RESULTS.append(result)
                    if args.screenshots: capture_layout(page,origin)
            finally:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)
                server.shutdown()
    report={"tests":RESULTS,"passed":sum(row["passed"] for row in RESULTS),"failed":sum(not row["passed"] for row in RESULTS),"rendererErrors":ERRORS,"runtime":"Electron browser-fallback harness; real keyboard/DOM operations; read-only markpadInspect"}
    Path(args.report).write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({"passed":report["passed"],"failed":report["failed"],"report":args.report}),flush=True)
    return 1 if report["failed"] else 0


if __name__=="__main__":
    raise SystemExit(main())
