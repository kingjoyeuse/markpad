# Markpad - Project Plan

## Source Of Truth

This plan is derived from the embedded design document in task `codex-manager-20260616-plan-markpad-2`.

## Product Goal

Build Markpad: a lightweight local desktop Markdown editor that feels familiar like Notepad, shows readable live Markdown formatting, offers approachable formatting buttons for users who do not know Markdown syntax, and preserves plain `.md` file ownership.

## North Star

Keep Markdown editing as immediate and familiar as Notepad while making formatting visible and approachable.

## Product Boundaries

- Local single-user desktop app.
- Plain `.md` documents remain the document format.
- Not a full IDE, cloud document suite, collaborative editor, or publishing platform.
- Interface should stay lightweight, familiar, and fast.

## Implementation Stack Decision

- Desktop shell: Electron.
- App code: JavaScript, HTML, and CSS.
- Initial scaffold work should create `package.json` and `src\` application files without requiring dependency installation.
- Dependency installation, launch smoke testing, and packaging are separate setup/verification work.

## Phase 0 - Planning Baseline

Goal: Convert the design document into worker-ready planning artifacts.

Acceptance checklist:

- [x] Design goals, constraints, audience, and done definition are captured in the plan.
- [x] First playable deliverable is defined.
- [x] Status and handoff files tell the next manager, dev, and QA workers what to do without chat context.

## Phase 1 - First Playable: Local Markdown Editor Loop

Goal: Deliver the minimum usable Markpad loop: create/edit Markdown, see live readable formatting, apply basic formatting from toolbar buttons, and save/open `.md` files locally.

Expected user experience:

1. User launches Markpad into a familiar text-editor window.
2. User starts a new document or opens an existing `.md` file.
3. User edits text in a primary editor area.
4. User sees Markdown formatting update live in the same document surface, with a Raw Text toggle available when they want to see Markdown syntax continuously.
5. User applies common formatting using toolbar buttons.
6. User saves the document as a plain `.md` file and can reopen it with content preserved.

Acceptance checklist:

- [x] App launches locally into a lightweight desktop window.
- [x] Main window presents a familiar editor-first layout with no landing page or cloud workflow.
- [x] User can create a new untitled Markdown document.
- [x] User can type and edit plain text.
- [x] User can open an existing `.md` file from local disk.
- [x] User can save current content to a `.md` file on local disk.
- [x] User can save changes back to an opened `.md` file without changing the file type.
- [x] Live formatting visibly reflects Markdown changes while editing.
- [x] Toolbar buttons can apply at least bold, italic, heading, link, unordered list, and code formatting.
- [x] Toolbar actions insert or update valid Markdown text rather than storing proprietary document data.
- [x] Open-save-reopen preserves Markdown source content.
- [x] Interface remains simple enough for a Notepad user to identify where to type, open, save, and format.

## Phase 2 - Editing Usability And Document Safety

Goal: Make the first playable comfortable and safer for regular short writing sessions.

Acceptance checklist:

- [x] Unsaved changes are indicated in the window or document title.
- [x] User receives a clear prompt before closing, opening another file, or creating a new file when unsaved changes exist.
- [x] Save As is available for untitled documents and for writing a copy.
- [x] Keyboard shortcuts cover common editor actions: new, open, save, save as, undo, redo, cut, copy, paste, select all, bold, italic.
- [ ] Toolbar button states and disabled states are clear where applicable.
- [x] Basic error messages are shown for failed open/save operations.
- [ ] Large ordinary Markdown files remain responsive enough for local editing.

Accepted evidence for completed items: `node C:\aiteam\temp\markpad-document-safety-smoke.js` verified the initial title, dirty `* Untitled - Markpad` title marker, canceled New preserving dirty content after confirmation, accepted New clearing content and removing the dirty marker, and placeholder restoration. Source evidence shows Open/New call the same discard confirmation path, close uses `beforeunload`, Save As remains routed through `saveAsMarkdownFile`, and failed open/save calls display alerts.

Shortcut evidence: Electron's native File menu defines accelerators for New, Open, Save, and Save As; Electron's native Edit menu supplies Undo, Redo, Cut, Copy, Paste, and Select All. `node C:\aiteam\temp\markpad-shortcuts-smoke.js` verified Ctrl+B and Ctrl+I produce valid Markdown source.

## Phase 3 - Markdown Coverage And Formatting Controls

Goal: Broaden Markdown authoring support while keeping controls approachable.

Acceptance checklist:

- [ ] Live formatting handles headings, bold, italic, links, inline code, code blocks, blockquotes, ordered lists, unordered lists, horizontal rules, and basic tables.
- [x] Toolbar includes controls for the supported common formats without overwhelming the editor surface.
- [ ] Formatting commands work with selected text and with an empty cursor position.
- [ ] Link insertion offers a user-friendly path for entering link text and URL.
- [ ] List controls produce valid Markdown and maintain predictable cursor placement.
- [ ] Markdown source remains human-readable after toolbar formatting.

## Phase 4 - Polished Local Desktop App

Goal: Make Markpad feel like a dependable local productivity tool.

Acceptance checklist:

- [ ] Recent or current file identity is clear to the user.
- [ ] Window title reflects document name and unsaved state.
- [ ] App has a restrained desktop-app visual style suitable for repeated work.
- [ ] Editor text, toolbar controls, and preview/formatted content are readable at common desktop sizes.
- [ ] App startup, open, save, and basic editing flows have focused QA coverage.
- [ ] Packaging or launch instructions are documented for the selected local desktop runtime.

## Done Definition

Markpad is done when a user can create or open a `.md` document, edit text, apply formatting with buttons, see live Markdown formatting, and save the document as a plain local Markdown file.

## First Playable Deliverable

The first playable deliverable is Phase 1: a local desktop Markpad window that completes the core loop of new/open, edit, toolbar formatting, live Markdown readability, save, and reopen with plain `.md` preservation.

First playable acceptance criteria:

- [x] Launches as a local desktop app.
- [x] Supports new, open `.md`, save, and save as.
- [x] Provides an editor area for typing Markdown text.
- [x] Shows live readable Markdown formatting as content changes.
- [x] Provides toolbar buttons for bold, italic, heading, link, unordered list, and code.
- [x] Toolbar buttons produce valid plain Markdown.
- [x] Reopening a saved file shows the saved Markdown content.
- [x] No proprietary or cloud-backed document format is required.

## Phase 5 - Backlog Expansion: Atomize Phase 1 first playable into implementation tasks

<!-- backlog-breakdown:bl-1781598185679-94jf -->

This phase was generated from backlog request `bl-1781598185679-94jf` so every requested deliverable is visible before implementation.

- [ ] Discovery/refinement: Atomize Phase 1 first playable into implementat....

## Phase 6 - Backlog Expansion: Strict native manager atomization pass for Markpad Phase 1 after cont...

<!-- backlog-breakdown:bl-1781600338754-8fie -->

This phase was generated from backlog request `bl-1781600338754-8fie` so every requested deliverable is visible before implementation.

- [x] Select local desktop technology stack for Markpad.
- [x] Scaffold app window and editor area.
- [x] Implement new document creation and text editing.
- [x] Implement open existing .md file and display content.
- [x] Implement save and save-as to .md files.
- [x] Implement live Markdown formatting display.
- [x] Implement toolbar formatting buttons.
- [x] Final first-playable integration & acceptance check.

## Phase 7 - Backlog Expansion: Implement save and save-as to .md files

<!-- backlog-breakdown:bl-1781600569982-5-plvm -->

This phase was generated from backlog request `bl-1781600569982-5-plvm` so every requested deliverable is visible before implementation.

- [x] Implement save and save-as for Markdown files.

## Phase 8 - Backlog Expansion: Final first-playable integration & acceptance check

<!-- backlog-breakdown:bl-1781600569983-8-ajpv -->

This phase was generated from backlog request `bl-1781600569983-8-ajpv` so every requested deliverable is visible before implementation.

- [x] Integration test and bug fix for first-playable loop.

Accepted evidence: Electron dependency installation completed and Electron reports `v42.4.1`. The Phase 8 smoke verified the Markpad renderer title, file actions, formatting controls, live rendered Markdown, New clearing the editor, and preload/main save IPC writing exact Markdown to `C:\aiteam\temp\markpad-electron-save.md`. A native-dialog smoke then verified the full first-playable loop: Save As wrote exact Markdown to `C:\aiteam\temp\markpad-native-save-as-output.md`, Open loaded `C:\aiteam\temp\markpad-native-open-input.md`, Save overwrote the opened file, reopening the Save As output restored exact Markdown source, and rendered the reopened heading/bold content.

## Phase 9 - Direct UX Correction: Single-pane live formatting and File menu

This phase was created from direct user correction after Phase 1 acceptance.

- [x] Replace split editor/preview with one document surface.
- [x] Default to live Markdown formatting, with a header toggle for Raw Text.
- [x] Clicking/editing rendered live content exposes the underlying Markdown source, then returns to rendered formatting after typing pauses.
- [x] Move New/Open/Save/Save As out of the toolbar and under the File menu.

Accepted evidence: `npm.cmd --prefix C:\aiteam\projects\markpad-2 run syntax-check` passed. `node C:\aiteam\temp\markpad-live-mode-smoke.js` passed against Electron remote debugging with headless flags; it verified no `#preview` split pane exists, live mode is default, File menu actions are present, rendered Markdown output is shown, live content editing exposes Markdown source, idle editing returns to rendered output, and the Raw Text toggle keeps Markdown syntax visible.

## Phase 10 - Direct Deliverable Correction: Windows executable

This phase was created from direct user correction after Phase 1 acceptance.

- [x] Add a reproducible local Windows executable build command.
- [x] Produce `dist\Markpad-win32-x64\Markpad.exe` from the installed Electron runtime without adding a new packaging dependency.
- [x] Keep generated build output ignored so the source commit stays reviewable.

Accepted evidence: `npm.cmd --prefix C:\aiteam\projects\markpad-2 run build:win` produced `C:\aiteam\projects\markpad-2\dist\Markpad-win32-x64\Markpad.exe`. `node C:\aiteam\temp\markpad-packaged-exe-smoke.js` then launched the packaged executable and verified the Markpad title, live formatting default, File menu actions, rendered Markdown, and Raw Text toggle.

## Phase 11 - Direct UX Correction: Native File menu only

This phase was created from direct user correction after executable review.

- [x] Move New/Open/Save/Save As into Electron's native File menu.
- [x] Remove the duplicate in-window File button/menu.
- [x] Keep the header bar limited to the Raw Text / Live Formatting toggle.
- [x] Rebuild `dist\Markpad-win32-x64\Markpad.exe` after the native menu correction.

Accepted evidence: `npm.cmd --prefix C:\aiteam\projects\markpad-2 run syntax-check` passed. `node C:\aiteam\temp\markpad-native-menu-smoke.js` verified no DOM File button/menu remains, the preload menu listener exists, and live formatting still renders. A source assertion verified the Electron native File menu includes New, Open, Save, and Save As accelerators. `npm.cmd --prefix C:\aiteam\projects\markpad-2 run build:win` rebuilt the executable, and `node C:\aiteam\temp\markpad-packaged-exe-smoke.js` verified the packaged executable has no duplicate DOM File menu.

## Phase 12 - Direct UX Correction: Toolbar row and production menu cleanup

This phase was created from direct user correction after executable review.

- [x] Put the Raw Text / Live Formatting toggle on the same toolbar row as the WYSIWYG controls.
- [x] Remove the separate header row that only contained Raw Text.
- [x] Remove developer-oriented View menu actions from the production menu.
- [x] Remove the redundant Window menu.

Accepted evidence: `npm.cmd --prefix C:\aiteam\projects\markpad-2 run syntax-check` passed; source checks verified the toolbar owns `#viewModeToggle`, `#headerBar` is absent, and the native menu no longer defines View, Window, or `toggleDevTools`.

## Phase 13 - Backlog Expansion: Manager refinement: Link insertion offers a user-friendly path for en...

<!-- backlog-breakdown:mr-plan-1781950138430-jh04 -->

This phase was generated from backlog request `mr-plan-1781950138430-jh04` so every requested deliverable is visible before implementation.

- [ ] Manager refinement: Link insertion offers a user-friendly path for en.

## Phase 14 - Backlog Expansion: Manager refinement: Link insertion offers a user-friendly path for en

<!-- backlog-breakdown:bl-1781950608438-1-drej -->

This phase was generated from backlog request `bl-1781950608438-1-drej` so every requested deliverable is visible before implementation.

- [ ] Discover current link insertion and design user-friendly dialog.

## Phase 15 - Backlog Expansion: Manager refinement: List controls produce valid Markdown and maintain...

<!-- backlog-breakdown:mr-plan-1781950711028-inos -->

This phase was generated from backlog request `mr-plan-1781950711028-inos` so every requested deliverable is visible before implementation.

- [ ] Manager refinement: List controls produce valid Markdown and maintain.

## Phase 16 - Backlog Expansion: Manager refinement: Markdown source remains human-readable after tool...

<!-- backlog-breakdown:mr-plan-1781951532382-42gh -->

### Child Backlog Rows

- [ ] Child 1: Audit existing formatting commands for Markdown source readability
  - Files: All JavaScript files under `src/` that handle toolbar formatting (e.g., `src/formatting.js`, `src/editor.js`)
  - Bounded discovery: Identify any formatting function that introduces extra whitespace, line breaks, or invalid Markdown.
  - Non-goals: Do not change UI or add features.
  - Acceptance criteria: Existing formatting produces valid Markdown with no extraneous blank lines or spaces.
  - QA evidence: Review formatted source output for each toolbar button.
  - Route: Implementation
  - Risk: Low
  - Approval: Not required
  - Reasoning: Understand current state.

- [ ] Child 2: Normalize formatting output to preserve clean Markdown source
  - Files: Same as Child 1 plus `src/utils.js` if helpers exist.
  - Change: Adjust formatting functions to output minimal Markdown tokens without trailing spaces, redundant line breaks, or other artifacts.
  - Non-goals: No change to rendered preview.
  - Acceptance criteria: After formatting, the source code is clean and follows common Markdown conventions.
  - QA evidence: Before/after source comparison for each action.
  - Route: Implementation
  - Risk: Low
  - Approval: Not required
  - Reasoning: Core requirement.

- [ ] Child 3: Automated validation test for Markdown source readability
  - Files: `test/` directory (create if not exists)
  - Change: Add tests that apply each formatting command and verify the produced Markdown is valid and clean (no trailing whitespace, minimal line breaks).
  - Non-goals: Not testing rendered HTML.
  - Acceptance criteria: Tests pass for all formatting actions.
  - QA evidence: Test results.
  - Route: Test
  - Risk: Low
  - Approval: Not required
  - Reasoning: Regression prevention.

This phase was generated from backlog request `mr-plan-1781951532382-42gh` so every requested deliverable is visible before implementation.

- [ ] Manager refinement: Markdown source remains human-readable after tool.

## Phase 17 - Backlog Expansion: Manager refinement: List controls produce valid Markdown and maintain

<!-- backlog-breakdown:bl-1781951507857-1-6hp7 -->

This phase was generated from backlog request `bl-1781951507857-1-6hp7` so every requested deliverable is visible before implementation.

- [ ] Unordered list toolbar cursor fix.
- [ ] Ordered list toolbar button and handler.
- [ ] Enter key list continuation.

## Phase 18 - Backlog Expansion: Manager refinement: Recent or current file identity is clear to the user

<!-- backlog-breakdown:mr-plan-1781953615809-60z3 -->

This phase was generated from backlog request `mr-plan-1781953615809-60z3` so every requested deliverable is visible before implementation.

- [x] Manager refinement: Recent or current file identity is clear to the user.
  - [ ] Window title shows current file name (`src/main.js`)
  - [ ] Unsaved state indicator in title (`src/main.js`, renderer IPC)
  - [ ] File name/display in toolbar or status bar (`src/renderer/index.html`)

## Phase 19 - Backlog Expansion: Manager refinement: Window title reflects document name and unsaved s...

<!-- backlog-breakdown:mr-plan-1781953771101-z138 -->

This phase was generated from backlog request `mr-plan-1781953771101-z138` so every requested deliverable is visible before implementation.

- [ ] Verify window title shows document name and unsaved indicator.

## Phase 20 - Backlog Expansion: Manager refinement: App has a restrained desktop-app visual style sui...

<!-- backlog-breakdown:mr-plan-1781954051166-zll4 -->

This phase was generated from backlog request `mr-plan-1781954051166-zll4` so every requested deliverable is visible before implementation.

- [ ] Discovery: Inventory existing CSS/HTML assets defining visual appearance (src/styles/, src/index.html).
- [ ] Define restrained color palette and typography suitable for repeated work.
- [ ] Apply consistent spacing, subdued borders, and low-contrast chrome to application shell.
- [ ] Ensure visual style persists across editor states (active, unsaved, error).

## Phase 21 - Backlog Expansion: Ordered list toolbar button and handler

<!-- backlog-breakdown:bl-1781953703139-2-6wgd -->

This phase was generated from backlog request `bl-1781953703139-2-6wgd` so every requested deliverable is visible before implementation.

- [ ] Add ordered list toolbar button markup.
- [ ] Implement ordered list toolbar button handler.

## Phase 22 - Backlog Expansion: Verify window title shows document name and unsaved indicator

<!-- backlog-breakdown:bl-1781954025473-1-i0xv -->

This phase was generated from backlog request `bl-1781954025473-1-i0xv` so every requested deliverable is visible before implementation.

- [ ] Verify window title for new unsaved document.
- [ ] Verify title reflects saved document name.
- [ ] Verify unsaved changes indicator appears.
- [ ] Verify title clears unsaved indicator after save.
