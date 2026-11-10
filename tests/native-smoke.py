"""Exercise the real Electron host, renderer, preload, files, and recovery.

Requires a built app, the installed Electron runtime, and Python Playwright.
The Electron child and its CDP client deliberately share one parent process;
cloud command runners may isolate loopback networking between tool invocations.
Native Save As dialogs and Windows-only behavior are outside this headless test.
"""

from pathlib import Path
import argparse
import json
import os
import platform
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="Keep logs/results here; defaults to a new temporary directory")
    parser.add_argument("--port", type=int, default=9231)
    parser.add_argument("--skip-singleton", action="store_true", help="Test-only opt-out for containers that deny Unix singleton sockets")
    parser.add_argument("--headful", action="store_true", help="Show real desktop windows instead of using Linux headless mode")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    base = args.output_dir.resolve() if args.output_dir else Path(tempfile.mkdtemp(prefix="markpad-native-"))
    base.mkdir(parents=True, exist_ok=True)
    # Never reuse a profile from a previous test, even in the same output folder.
    profile = Path(tempfile.mkdtemp(prefix="profile-", dir=base))
    opened = base / "opened.md"
    original = "# Native host smoke\n\nOriginal file content.\n"
    opened.write_text(original, encoding="utf-8")
    executable = root / "node_modules" / "electron" / "dist" / ("electron.exe" if os.name == "nt" else "electron")
    environment = os.environ.copy()
    environment["MARKPAD_SMOKE_PROFILE"] = str(profile)
    environment["MARKPAD_SMOKE_SKIP_SINGLETON"] = "1" if args.skip_singleton else "0"
    arguments = [str(executable)]
    if not args.headful:
        # Sandbox limitations of the test host only. Production launch scripts
        # do not disable sandboxing or hardware acceleration.
        arguments += ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"]
    arguments += [f"--remote-debugging-port={args.port}", str(root / "tests" / "native-smoke-launch.cjs"), str(opened)]
    endpoint = f"http://127.0.0.1:{args.port}"
    results = {
        "environment": {
            "platform": platform.platform(),
            "electron": json.loads((root / "node_modules" / "electron" / "package.json").read_text())["version"],
            "headless": not args.headful,
            "test_only_singleton_stub": args.skip_singleton,
            "native_file_dialogs_tested": False,
        },
        "checks": {},
    }
    log = (base / "electron.log").open("w", encoding="utf-8")
    process = subprocess.Popen(arguments, cwd=root, env=environment, stdout=log, stderr=log)

    def ready(page):
        page.wait_for_function('!!window.markpad && !!document.querySelector(".tiptap")')

    def new_page(context, controller):
        with context.expect_page() as creation:
            controller.evaluate("window.markpad.newWindow()")
        page = creation.value
        ready(page)
        return page

    def edit_raw(page, text):
        if not page.locator("#raw-editor").is_visible():
            page.locator("#mode-toggle").click()
        page.locator("#raw-editor").fill(text)
        page.locator("#raw-editor").press("End")

    def close_page(page):
        with page.expect_event("close", timeout=10000):
            page.evaluate("window.markpad.close()")

    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(f"Electron exited with code {process.returncode}; see {base / 'electron.log'}")
            try:
                urllib.request.urlopen(endpoint + "/json/version", timeout=0.2).close()
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("Electron's CDP endpoint did not become ready")

        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            for _ in range(100):
                if context.pages and context.pages[0].url.startswith("file:"):
                    break
                time.sleep(0.05)
            page = context.pages[0]
            ready(page)
            boot = page.evaluate("window.markpad.bootstrap()")
            assert boot["path"] == str(opened)
            assert boot["markdown"] == original
            assert page.locator(".tiptap h1").inner_text() == "Native host smoke"
            results["checks"]["real_boot_open_and_formatted_render"] = True

            before = page.locator("#mode-label").inner_text()
            page.keyboard.press("Control+Tab")
            page.wait_for_function('(before) => document.querySelector("#mode-label").textContent !== before', arg=before)
            assert page.locator("#raw-editor").input_value() == original
            results["checks"]["ctrl_tab_toggles_once_preserving_source"] = True

            source = "# Native save\n\nEdits saved through the real preload and main process.\n"
            edit_raw(page, source)
            saved = page.evaluate("(markdown) => window.markpad.save({markdown})", source)
            assert saved["saved"] and opened.read_text(encoding="utf-8") == source
            results["checks"]["real_save_existing_file_exact"] = True

            page.evaluate('window.markpad.writeClipboard("Markpad clipboard 123")')
            assert page.evaluate("window.markpad.readClipboard()") == "Markpad clipboard 123"
            results["checks"]["native_clipboard_roundtrip"] = True

            other = new_page(context, page)
            other_id = other.evaluate("window.markpad.bootstrap()")["id"]
            draft = "# Window two\n\nThis unsaved draft must survive close.\n"
            edit_raw(other, draft)
            # Close immediately, before the debounce: the actual renderer's
            # prepare-close handler must flush its current document snapshot.
            close_page(other)
            records = page.evaluate("window.markpad.listRecents()")
            assert any(record["id"] == other_id and record["dirty"] for record in records)
            with context.expect_page() as restored_event:
                page.evaluate("(id) => window.markpad.openRecent(id)", other_id)
            restored = restored_event.value
            ready(restored)
            restored_boot = restored.evaluate("window.markpad.bootstrap()")
            assert restored_boot["markdown"] == draft
            assert restored_boot["recovered"]
            results["checks"]["immediate_close_flush_and_recent_restore"] = True

            for number in range(4):
                target = new_page(context, page)
                edit_raw(target, f"# Independent note {number + 3}\n\nSample text for six-window resource measurement.\n")
            assert len(context.pages) == 6
            page.evaluate('window.markpad.setTheme("dark")')
            for target in context.pages:
                target.wait_for_function('document.documentElement.dataset.theme === "dark"')
            results["checks"]["theme_synced_across_six_windows"] = True
            page.evaluate('window.markpad.setTheme("system")')
            ids = [target.evaluate("window.markpad.bootstrap()")["id"] for target in context.pages]
            assert len(set(ids)) == 6
            results["checks"]["six_independent_document_sessions"] = True

            # The test-only launcher emits five process/memory samples, at three
            # second intervals. There is no polling timer in the production app.
            time.sleep(16)
            for target in list(context.pages)[1:]:
                close_page(target)
            results["checks"]["five_windows_closed_without_losing_independent_drafts"] = True
            entries = page.evaluate("window.markpad.listRecents()")
            assert len([entry for entry in entries if entry["dirty"]]) == 5
            close_page(page)
            process.wait(timeout=10)
            assert process.returncode == 0
            results["checks"]["graceful_last_window_exit"] = True
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        log.close()
        lines = (base / "electron.log").read_text(encoding="utf-8").splitlines()
        results["metrics"] = [json.loads(line.split("MARKPAD_METRICS ", 1)[1]) for line in lines if "MARKPAD_METRICS " in line]
        results["startup"] = [json.loads(line.split("MARKPAD_STARTUP ", 1)[1]) for line in lines if "MARKPAD_STARTUP " in line]
        (base / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps({key: value for key, value in results.items() if key != "metrics"}, indent=2))
        print(f"Full results: {base / 'results.json'}")


if __name__ == "__main__":
    main()
