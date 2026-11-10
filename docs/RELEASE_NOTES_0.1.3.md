# Markpad 0.1.3 — Windows packaging preview

This release contains the existing Markdown editor, calculator, worksheets,
linked cell/table editing, independent panel tabs, large-file staging, and current
black-and-white branding, with dedicated consumer packages.

- **Installer:** per-user setup with optional completion-page PATH/Run integration
  and `.md` default-editor selection. Windows confirmation is required for defaults.
- **Portable ZIP:** runtime-only, with settings and drafts in `data` beside the EXE.
- Proper Markpad executable metadata, multi-resolution icons, and `.md` registration.
- Source/build/publish scripts are separate from runtime downloads.
- No Node.js/Python needed by end users; setup uses built-in Windows PowerShell/.NET.

Both packages are **unsigned**. This is an early prerelease, not a claim of full
Windows validation. The build session validated core behavior and package contents
but did not execute the Windows installer, UI, shell integration, or uninstall.
Existing Windows/SmartScreen policy may warn or prevent running an unsigned build.

Installed/development recovery data remains under the existing Windows user profile.
The portable copy has an independent profile; it does not automatically migrate
existing unsaved drafts. Uninstall preserves documents and recovery data.

Download `Markpad-0.1.3-Setup-x64.exe` to install or
`Markpad-0.1.3-Portable-x64.zip` to extract and run. Compare with SHA256SUMS.txt
when checking transfer integrity. Source has no selected open-source license yet.
