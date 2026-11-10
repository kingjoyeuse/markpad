# Markpad — current project brief

Revision: 2026-11-09. Owner: Joy. Target project path: `C:\repos\markpad`.

Build a Windows-first, local Markdown notepad that can replace the user's typical five or six separate Notepad windows. Writing should happen directly in the formatted result, with a familiar compact formatting toolbar, a raw toggle, and system-default light/dark appearance.

Two independently toggled right-sidebar tools support working with numbers beside the text: a transient calculator at the upper-right and a small multi-tab spreadsheet at the lower-right. Text selections and tool values transfer to remembered destinations without disturbing the document selection. The calculator uses Alt+Shift shortcuts; the spreadsheet uses Alt+Ctrl. Inline equation completion uses Alt+Ctrl+Shift+Right.

Plain Markdown remains the document format. Populated spreadsheets append readable named table sections and hidden formula metadata. Closed unsaved documents remain recoverable in Recents. Keep startup, memory, and idle work small; measure rather than assume performance.

Deliver one ZIP that extracts directly into the project folder, with `Markpad.exe` at its root, all runtime support files, full source, a local Git repository, `AGENTS.md`, build commands, current specification, and actual verification evidence.

The current implementation retains the older brief's approved Electron/JavaScript/HTML/CSS stack. Its resource baseline is a known compromise compared with native Notepad. The full current requirements and limitations are in `PROJECT_DESIGN.md` and `../README.md`; historical inputs are archived separately and are not implementation proof.
