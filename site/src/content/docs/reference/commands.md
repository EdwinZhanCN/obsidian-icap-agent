---
title: Commands
description: Every command of the plugin, the editor menu entries, and the ribbon and status bar entries.
sidebar:
  order: 1
---

To run a command, open the command palette and type its name. ICAP has no default hotkeys. To give a command a hotkey, open **Settings → Hotkeys** and search for "ICAP".

## Editor commands

An editor command works only when a note is open in an editor (Live Preview or Source mode). It does not work in Reading view.

Each editor command has an icon. On a phone or tablet, add these commands to the mobile toolbar in Obsidian's settings.

| Command | What it does | Icon |
|---|---|---|
| **Ask the agent here** | Adds a request block below the cursor. If text is selected, the agent gets the selection as context. | `message-circle-question` |
| **Explain selection in context** | Shows an explanation of the selected text, beside the passage. | `lightbulb` |
| **Recall from memory (this section)** | Adds a recall block for the section at the cursor. | `brain` |
| **Check what I wrote (selection or paragraph)** | Adds a check block for the selected text, or for the paragraph at the cursor. | `spell-check` |
| **Check my understanding of this section** | Adds a quiz block for the section at the cursor. | `list-checks` |
| **Check my understanding of this note** | Adds a quiz block for the whole note. | `clipboard-check` |
| **Create a concept note from selection** | Starts a task that writes a new note about the selected concept. If nothing is selected, ICAP shows "Select the concept first." | `file-plus-2` |
| **Collect key concepts of this note into notes** | Starts a task that writes a note for each key concept of the note. | `files` |
| **Write a comparison note…** | Opens the **Compare concepts** dialog. Type the two concepts in **This** and **With**, then select **Write comparison**. The selected text, if any, is the first concept. | `columns-2` |
| **Move into the nearest explanation or question** | Moves the focus into the first explanation or block at or below the cursor. If the note has none, ICAP shows "No explanation or question in this note yet." | `corner-down-right` |

## Other commands

These commands work from any view.

| Command | What it does | Icon |
|---|---|---|
| **Show activity** | Opens `ICAP/Activity.base`. If a task waits for your answer and has no task note, it shows that task. If the Bases core plugin is off, it opens the activity list. | `activity` |
| **Rebuild task notes from recent activity** | Writes again the task notes that are missing for the latest 60 tasks. Use it after you delete a task note by mistake. | `list-restart` |
| **Open the guide** | Opens the guide note. If you deleted it, ICAP makes it again. | `book-open` |
| **This vault's conventions (AGENTS.md)** | Opens the `AGENTS.md` at the vault root. If there is none, it opens the dialog that writes one. | `scroll-text` |

## Editor menu

Right-click in a note to open the editor menu.

These entries show only when text is selected:

| Entry | Same as | Icon |
|---|---|---|
| **Explain in context** | **Explain selection in context** | `book-open` |
| **Check what I wrote** | **Check what I wrote (selection or paragraph)** | `pen-line` |
| **Create a concept note** | **Create a concept note from selection** | `file-plus` |

These entries always show:

| Entry | Same as | Icon |
|---|---|---|
| **Ask the agent here** | **Ask the agent here** | `message-square-text` |
| **Recall from memory** | **Recall from memory (this section)** | `brain` |
| **Check my understanding** | **Check my understanding of this section** | `list-checks` |

## Status bar and ribbon

- **On a computer**, ICAP adds a mark to the status bar. Its tooltip is **Learning activity**. The mark shows the state of the tasks, for example "working" or "2 questions for you". Select it to do the same as **Show activity**.
- **On a phone or tablet**, Obsidian has no status bar. ICAP adds a ribbon button, **Show activity**, with the icon `activity`.

## In a block

In a block, press <kbd>Mod</kbd>+<kbd>Enter</kbd> to submit or send. <kbd>Mod</kbd> is <kbd>Cmd</kbd> on macOS and <kbd>Ctrl</kbd> on other systems. Each block also shows a button for each action, for touch screens.
