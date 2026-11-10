# Native desktop verification

Verified on **2026-11-09**, using Electron **45.2.3** on Linux x64 (kernel 6.18.57, glibc 2.41). These are results from the actual Markpad desktop host, preload bridge, bundled renderer, and filesystem operations. They are not Windows execution results.

## What passed

The reproducible smoke test in `tests/native-smoke.py` passed all nine checks:

| Check | Observed result |
| --- | --- |
| Open and render | An existing UTF-8 Markdown file opened in a real Electron BrowserWindow and its heading rendered in formatted mode. |
| Ctrl+Tab | A synthesized Ctrl+Tab changed mode exactly once and retained the original Markdown source. |
| Save | Calling the real preload Save API wrote the exact supplied UTF-8 Markdown bytes back to the opened file. |
| Clipboard | The narrowly scoped desktop clipboard API wrote and read the same text. |
| Immediate close and recovery | An unsaved window closed before its debounce elapsed; the renderer’s close handshake persisted its latest text, and Recent restored it exactly. |
| Theme | Selecting Dark updated all six windows; System could be selected again. |
| Independent documents | Six windows had six distinct document/recovery IDs. |
| Multiwindow close | Five windows closed independently and remained as five recoverable unsaved drafts. |
| Exit | Closing the final window completed the recovery handshake and the desktop process exited successfully. |

The separate `tests/recovery.test.mjs` suite passed **10/10** tests. It covers independent drafts across restart; dirty saved-file recovery without changing the original; recovery from a corrupted latest record; ordered final snapshots; merging Save completion with newer edits; explicit draft deletion without deleting the original file; exact UTF-8 atomic saves and external-change fingerprints; theme persistence; invalid-record guards; and strict UTF-8 decoding that preserves a UTF-8 BOM and CRLF while rejecting malformed UTF-8 and typical UTF-16 input.

## Measured resource use

Five samples were taken three seconds apart with **six small Markdown notes open**, the calculator and spreadsheet panes closed, and no active typing. The test used headless rendering, disabled GPU acceleration, and an attached CDP test client. The production launch does not apply those test switches.

| Sample (UTC) | Summed RSS | Summed PSS | Private memory | Electron-reported CPU |
| --- | ---: | ---: | ---: | ---: |
| 20:45:16 | 1,128.55 MiB | 373.53 MiB | 231.30 MiB | First sample: no prior interval |
| 20:45:19 | 1,128.87 MiB | 373.92 MiB | 231.68 MiB | 0.333% |
| 20:45:22 | 1,106.88 MiB | 361.29 MiB | 228.45 MiB | 0.333% |
| 20:45:25 | 1,105.84 MiB | 360.13 MiB | 227.29 MiB | 0.259% |
| 20:45:28 | 1,105.95 MiB | 360.24 MiB | 227.39 MiB | 0.370% |

The figures sum the **nine processes returned by Electron’s `app.getAppMetrics()`**: one browser/main process, one GPU process, one utility process, and six renderers. Auxiliary processes outside that list are not counted. PSS and private memory were read from those processes’ Linux `/proc/<pid>/smaps_rollup` records.

RSS counts shared pages once per process, so its sum substantially double-counts memory. PSS apportions shared pages and is the more useful of these measurements for assessing physical memory attributed to the measured processes. PSS can vary when other applications share the same mapped runtime files. This sample is an illustrative Linux baseline, not a Windows memory promise or a claim of Notepad-level memory use. Electron still contributes a significant fixed runtime footprint.

The first opened note became available in the renderer at **227 ms of main-process uptime**, with **151 ms on the renderer’s performance clock** in this run. This is one warm-environment observation, including the test harness, not a controlled cold-start benchmark or a measurement of launching the packaged Windows executable.

## Scope and limitations

- The container disallows Unix-domain singleton sockets. The smoke launcher explicitly replaced `app.requestSingleInstanceLock()` with a test-only successful return. **Production code was unchanged.** Creating multiple independent windows through the actual application API was tested; OS-level second-launch forwarding was not verified in this run.
- The Electron process and Playwright CDP client run inside the same command invocation. This is necessary in command runners that isolate loopback networking between invocations.
- Save to an already opened path was tested through real IPC and filesystem code. The native **Open/Save As picker UI**, native external-change confirmation dialog, and physical menu interactions were not exercised headlessly.
- The Windows portable runtime can be downloaded, SHA-256 checked against Electron’s packaged checksums, and assembled from this environment. **The Windows executable has not been run here.** Windows-specific menus, DPI, physical keypad Enter, file association, and actual Windows RAM/startup measurements remain target-machine checks.
- The renderer’s synthetic Ctrl+Tab fallback was exercised. Production also intercepts physical Ctrl+Tab before Chromium consumes it and suppresses the duplicate native menu action.
- The recovery write queue and Save merge logic have focused automated coverage. Tests do not establish immunity to power loss, hardware failure, every disk-full situation, or all outside programs editing a file concurrently.

Raw measurements and per-check flags are recorded in `docs/NATIVE_VERIFICATION.json`.

## Reproduce

From the project root, after installing dependencies and the Python Playwright package:

```sh
npm run build
node --test tests/recovery.test.mjs
python3 tests/native-smoke.py --skip-singleton --output-dir /tmp/markpad-native-results
```

Use `--skip-singleton` only in a sandbox that denies the OS singleton socket. Omit it on an ordinary machine so the test does not stub that operation. The test does not need to download a Playwright Chromium browser; it attaches to the installed Electron runtime. `--headful` removes the headless/sandbox/GPU test switches when running on a real desktop.

The test creates a new isolated user-data profile for every run and never opens the user’s actual Markpad recovery folder. The output directory contains the test Markdown file, recovery profile, Electron log, and JSON results. No test profile or log is part of the portable application.
