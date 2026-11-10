# Markpad

A Windows-first local Markdown notepad with live formatted editing, a calculator,
worksheets, and recoverable unsaved drafts. Intended repository: **kingjoyeuse/markpad**.

## Run a release

**Installer:** run `Markpad-0.1.3-Setup-x64.exe`. It installs for the current Windows
user, normally under `%LOCALAPPDATA%\Programs\Markpad`, without an administrator
prompt. The completion page offers independent, optional checkboxes:

- Add Markpad to your user PATH and register `markpad` for the Windows Run dialog.
- Use Markpad for `.md` files. This opens Windows Default Apps for your confirmation.
- Launch Markpad.

Markpad appears by its own name and black-and-white icon, not as Electron. The
installer registers `.md` support but does not forcibly replace existing defaults.
Uninstall from Windows Apps or `Uninstall Markpad.exe`. Settings, drafts, and your
Markdown files are retained. Only a PATH entry added by this installer is removed.

**Portable:** extract the entire `Markpad-0.1.3-Portable-x64.zip` to a writable
folder and run `Markpad.exe`. Keep all included support files together. Settings
and drafts live in the `data` folder created beside the EXE. Keep that folder
when upgrading or moving the app. Portable mode does not change PATH or file
associations, and does not silently import your installed/development profile.

Both distributions contain runtime and license files only: no source checkout,
Git history, tests, old updates, build tools, dependency cache, or personal notes.
The UI is English; these minimal releases retain only Electron's `en-US` locale.
No Node.js or Python installation is needed to run either distribution. The
installer itself uses the Windows PowerShell 5.1/.NET components built into
Windows 10/11. Restrictive corporate policies can block that setup mechanism.

**Release status:** unsigned early release. Windows installer UI, PATH, uninstall,
and Default Apps behavior have not been executed on Windows in this build session.
Package integrity, PE resource checks, and core regression checks are distinct
from target-platform execution. See `docs/RELEASE_VERIFICATION_0.1.3.md`.

## Editor features

Formatted/Raw editing (`Ctrl+Tab`), common formatting shortcuts, syntax-colored
code blocks, editable Markdown tables, document/selection statistics, zoom, word
wrap, and Light/Dark/System appearance. Large files become editable before the
full formatting pass completes. Calculator and spreadsheet panels toggle
independently; every fresh app launch opens another document window.

Calculator transfers use **Alt+Shift** and spreadsheet transfers use **Alt+Ctrl**:
Right sends the current document selection, Left or NumpadEnter inserts the tool
value, Up shows, and Down hides. Alt+Ctrl+Shift+Right evaluates a selected equation
inline. Spreadsheet formulas, selections, row/column operations, autofit, and
live cell/table insertions are supported. Extended worksheet data is preserved
in versioned Markdown metadata; ordinary Markdown remains readable elsewhere.

## Development

The local project may remain at `C:\repos\markpad`, with its development runtime
under `bin\` and a root shortcut. Release installers belong in a separate app
folder, not in the source checkout.

```powershell
npm ci
npm test
npm run build:portable
```

An offline source build is also available without installing npm dependencies:

```powershell
node scripts/build-offline.mjs
npm test
```

`npm run build:portable` refreshes the existing `bin\resources\app` deployment.
A fresh source checkout without `bin` can create a runtime with
`npm run package:win`, then pass that runtime to the release builder:

```powershell
python scripts/build-releases.py --runtime dist/Markpad-win32-x64
```

For an existing development folder, double-click `Build-Releases.cmd`. Release
building needs Node, Python 3.10+, and LLVM (`clang`, `lld-link`); end users do not.
No compiler downloads or unverified remote scripts are performed by the release
builder. The source includes the small native installer launcher, setup UI, PE
branding code, packaging script, and focused checks.

## Publish on GitHub

The publishing kit contains the release artifacts under `dist\releases`. With
Git and GitHub CLI installed, run `Publish-Markpad.cmd`. It verifies the source
and artifact hashes, guides GitHub browser sign-in when needed, checks the
account is `kingjoyeuse`, creates `kingjoyeuse/markpad` if absent, pushes source,
and uploads the installer, portable ZIP, checksums, and build manifest as an
initial prerelease. **New repositories default to private.**

To deliberately create a public repository, run:

```powershell
.\Publish-Markpad.cmd -Visibility public
```

The publisher never force-pushes, changes an existing repository's visibility,
or replaces a published release. Existing remote/history conflicts stop safely.
It does not upload runtime files into Git history. Full instructions and known
Windows limitations are in `docs/RELEASING.md`.

## Licensing

No license for Markpad-authored source has been selected (`UNLICENSED` in package
metadata). No open-source license is granted by creating the private repository.
Third-party code retains its upstream licenses; see `THIRD_PARTY_NOTICES.md` and
`THIRD_PARTY_LICENSES.txt`. Electron's runtime `LICENSE` is not Markpad's license.
