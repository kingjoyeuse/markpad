# Windows releases and GitHub publishing

## Layouts

The source repository contains `src`, `desktop`, `assets`, `vendor`, `scripts`,
`installer`, `tests`, documentation, and build metadata. Generated `app`, `bin`,
`dist`, recovery data, logs, and binaries are ignored. Keep the source project
at `C:\Repos\markpad`. Build and publish from that checkout. Install consumer releases in a separate folder.

The portable ZIP puts `Markpad.exe` at its root with its required runtime files,
`locales/en-US.pak`, `resources/app`, and licenses. `markpad-portable.json` selects
local `data` storage before Electron creates the profile/single-instance lock.
Remove no runtime DLLs. Do not discard `data` when upgrading an existing copy.

The installer embeds a native x64 launcher, the setup script, and a verified ZIP.
Its setup UI uses Windows PowerShell 5.1 and .NET Windows Forms, not an additional
installed framework. It is per-user, requires no elevation, registers a Start
menu shortcut and uninstall entry, and brands its own and the app's EXE icons.

## Completion-page choices

1. **Add Markpad to my PATH** appends the installation directory to HKCU's PATH
   only when absent, remembers ownership, and preserves unrelated entries and
   expandable variables. It also registers HKCU `App Paths\Markpad.exe`, allowing
   Win+R `markpad` to resolve immediately. New terminals inherit the updated PATH;
   terminals already running may still have the older environment.
2. **Use Markpad for .md files** opens the supported Windows Default Apps UI. The
   app registers its friendly name, icon, ProgID, capabilities, and open command.
   It never writes the protected UserChoice hash or silently forces a default.
   Windows 11 supports an app-specific deep link; Windows 10 uses the general
   Default Apps page, with instructions to select Markpad for `.md`.
3. **Launch Markpad** is separate from both integrations.

Both integration choices default unchecked on a first installation. An upgrade
remembers the PATH choice. The program is registered as an available `.md` editor
without claiming the existing default. Only `.md` is advertised by setup.

## Safe updates and removal

Setup verifies the embedded ZIP and per-file SHA-256 hashes, stages the new
runtime, retains user-added files on upgrade, and swaps into place with a rollback
copy. It rejects drive roots, portable folders, source-project folders, unknown
nonempty target folders, and reparse-point/junction traversal. It does not kill
Markpad processes; users must close the installed app before updating/removing.

Uninstall removes only files named in the installation manifest, registered
entries that still belong to this installation, and a PATH entry owned by setup.
It leaves `%APPDATA%\Markpad`, documents, and unknown user-added files untouched.
A short-lived cleanup child waits for the uninstaller launcher to exit before
removing that one executable. There is no background updater, service, or telemetry.

## Build

Pinned renderer dependencies are available in `vendor`, so `build-offline.mjs`
can regenerate app code without npm network access. Release packaging uses an
existing matching Electron Windows x64 runtime, not arbitrary DLLs from a machine.

Requirements: Node; Python 3.10+; LLVM clang and lld-link. On Windows, install LLVM
in its standard folder or put its tools on PATH. The builder locates that folder.

```powershell
python scripts/build-releases.py --runtime bin
```

A new source-only clone can first run `npm ci` and `npm run package:win`, then use
`--runtime dist/Markpad-win32-x64`. The packaged app requires none of the build tools.
The PE resource writer updates icon/version resources on either Linux or Windows.
It deliberately removes any invalidated executable signature; it does not claim
to sign the app. Arrange real code signing separately before a broad stable release.

Output: installer EXE, portable ZIP, `SHA256SUMS.txt`, and `release-manifest.json`
under `dist/releases`. The latter records exact runtime-source hashes so the
publisher will refuse to upload older binaries beside edited source.

## Publish

Git and GitHub CLI are required only for publishing. Install missing tools with
`winget install --id Git.Git --exact` and/or
`winget install --id GitHub.cli --exact`, then reopen the publisher.

Run `Publish-Markpad.cmd` in the project root. It uses your local authenticated
GitHub CLI session; no credentials are requested in chat or embedded in files.
It checks the owner login, creates a private `kingjoyeuse/markpad` repository when
absent, and pushes committed source on `main`. After reviewing the build, run
`Publish-Markpad.cmd -Release` to tag the version and create a prerelease with
both binaries and checksums. Use `-Visibility public`
only as an explicit decision to publish publicly. No source license is chosen for
you. The default source push does not require binaries.

The script stops on a different origin, an unexpected tracked runtime/personal
file, a non-main branch, conflicting remote history/tag, an existing release, or
a hash mismatch. It never force-pushes or deletes releases. If GitHub rejects a
workflow upload due to an older CLI login's permissions, run
`gh auth refresh -h github.com -s workflow`, then retry.

A `Source checks` workflow handles ordinary commits/PRs. `Build Windows release`
is manually triggered from GitHub Actions and uploads a build artifact for review;
it does not automatically publish or overwrite the release made by the publisher.

## Platform references

- Microsoft application registration / per-user App Paths:
  https://learn.microsoft.com/en-us/windows/win32/shell/app-registration
- Windows app default choices must be confirmed in system UI:
  https://learn.microsoft.com/windows/apps/develop/windows-integration/default-apps-platform
- Default Apps deep links and Windows-version support:
  https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings
- GitHub repository and release CLI commands:
  https://cli.github.com/manual/gh_repo_create
  https://cli.github.com/manual/gh_release_create
