# Markpad 0.1.3 release verification

## Performed in this build session

- Reconstructed the latest delivered 0.1.2 source from the original project and
  cumulative delivered patches, preserving the working editor/table/sidebar code.
- Added portable-profile selection and caller-working-directory handling before
  packaging. Existing installed/development profile behavior remains unchanged.
- All **61 Node core/regression checks passed**, including three focused checks
  for installed/portable profile separation and invalid-marker failure behavior.
- Compiled the native x64 setup/uninstall launchers with clang and lld-link.
- Branded Markpad.exe and launchers with the supplied black-and-white multi-size
  icon and Markpad name/version resource. PE structure was inspected with objdump
  and the dependency-free resource parser; icons/version resources round-tripped.
- Read every portable ZIP member and validated CRCs, runtime-only top-level layout,
  locale selection, app-source parity, version, portable marker, and resources.
- Extracted the installer's embedded script and ZIP without executing them;
  validated the payload SHA-256, every installed file's SHA-256, ZIP CRCs,
  installer options, absence of the portable marker, and included uninstaller.
- Verified public-facing SHA256SUMS.txt matches both binary artifacts and that
  the recorded source hashes match the source being delivered.

See `release-artifact-checks-0.1.3.json` for the inspection summary. These are
focused checks, not a substitute for interactive Windows use.

## Not performed here

- Windows execution of Markpad.exe, the native setup bootstrap, the Windows Forms
  installer, the installer completion options, PATH broadcast/Run command,
  Default Apps selection, actual upgrade/rollback, or uninstallation.
- Code signing or SmartScreen reputation validation. The packages are unsigned.
- Remote repository creation, authenticated push, GitHub Actions execution,
  release publication, or execution of the local GitHub publishing script.
  The available chat GitHub actions were read-only. The publisher is included
  for execution with the user's own authenticated GitHub CLI session.

## First Windows check

Install to the proposed per-user application directory, not the source folder.
Confirm the two integration checkboxes are initially unchecked, select them,
finish, choose Markpad for `.md` in Windows Settings, then test Win+R `markpad`
and a Markdown file whose path contains spaces. Close/reopen an unsaved note.
Try uninstalling and confirm documents/drafts remain. For the separate portable
ZIP, confirm the `data` folder appears beside the EXE and survives moving the
whole portable folder. No personal recovery data should be used for destructive
checks.
