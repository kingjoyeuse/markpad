# Design Document: Markpad

## Project Basics

Project name: Markpad

Project directory: C:\aiteam\projects\markpad-2

Project type: tool

Target platform(s): Local desktop app

Genre / category: Markdown text editor / productivity tool

Concurrent users: single-user

## Description

Markpad, a text editor window very similar to Notepad, but which shows live markdown formatting, has WYSIWYG buttons for people unfamiliar with markdown code, and opens/saves .md documents.

## Target Audience

Primary audience: People who want to edit Markdown documents without memorizing Markdown syntax

Comparable products: Notepad, Typora, Obsidian, Mark Text

What the audience already likes: Fast local editors, plain files, visible formatting, simple controls

Fantasy or function fulfilled: Write and edit plain-text documents while seeing the formatted result immediately.

Not trying to be: A full IDE, cloud document suite, or collaborative publishing platform.

## Product Direction

Hook / differentiator:

Notepad-like editing with live formatting feedback and approachable formatting controls.

Goal:

Let users create, edit, format, open, and save Markdown documents in a familiar text-editor window.

North star:

Keep Markdown editing as immediate and familiar as Notepad while making formatting visible and approachable.

Design pillars:

Notepad-like simplicity
Live readable formatting
Plain local document ownership
Approachable controls for non-Markdown users

Core experience loop:

Open or create a document
Write or edit text
Apply formatting with toolbar buttons
See Markdown formatting update live
Save the document
Repeat

Session length: A few minutes to an hour

## Technical Intent

Required languages: JavaScript, HTML, CSS

Required engines: Electron

Main features:

Open documents
Save documents
Live Markdown formatting
WYSIWYG formatting buttons
Plain .md document support

Constraints:

Preserve plain .md documents. Keep the interface familiar and lightweight. Do not require users to know Markdown syntax. Electron is approved as the desktop shell; dependency installation and packaged launch verification still need their own explicit setup/verification step.

Done definition:

A user can create or open a .md document, edit text, apply formatting with buttons, see live Markdown formatting, and save the document.

## Support Files

None
