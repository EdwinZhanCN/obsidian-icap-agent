---
title: Files and documents
description: Choose where ICAP puts notes, and how it prepares your PDFs, EPUBs and Word files.
sidebar:
  order: 4
---

Two groups in **Settings → ICAP Learning Agent** are about files: **Files** and **Documents**.

## Files

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Folder for new notes** | The folder for the notes that the agent makes. | empty: the agent chooses | both |
| **Mark notes the agent creates** | Adds `generated-by: icap-agent` to the properties of a new note. | on | both |
| **Record tasks as notes** | Writes a note for each task, and `Activity.base`. | off | both |
| **ICAP folder** | The folder for `Activity.base` and for the task notes. It shows only when **Record tasks as notes** is on. | `ICAP` | both |

### Folder for new notes

If the setting is empty, the agent chooses a folder for each new note. It follows the rules in the `AGENTS.md` of your vault, if there are rules. If not, it puts the note in the folder of related notes. If no folder fits, it puts the note in the same folder as the current note.

To use one folder for all new notes, type a folder path in the vault, for example `Learning/Concepts`.

In a request, you can always tell the agent where to put a note. Your request has priority over this setting.

### Mark notes the agent creates

With this setting on, a note that the agent makes has the property `generated-by: icap-agent`. The agent uses the property to tell its own notes from your notes. A note that you wrote is evidence of what you understand. A note that the agent wrote is not.

Keep this setting on, unless you do not want the property in your notes.

### Record tasks as notes

With this setting off, the plugin writes nothing about tasks into your vault. The activity then shows in the plugin's own list. Select the mark in the status bar to see it.

With this setting on, the plugin writes a note for each task that does real work, and makes `Activity.base`. You can then filter and sort tasks in Bases. When you turn the setting on, the plugin also writes the notes of your recent tasks. Read [Task notes](/reference/task-notes/).

If your vault has `Activity.base` from an earlier version, this setting is on.

### ICAP folder

This folder holds `Activity.base`. Task notes go into its `Tasks` folder, for example `ICAP/Tasks/`. If you clear the setting, the plugin uses `ICAP`.

The plugin makes `Activity.base` one time, and then does not change it. ICAP finds a task note by its `icap-id` property, so you can move task notes. Read [Activity](/learn/activity/).

## Documents

The agent can read the PDF, EPUB and Word (DOCX) files in your vault. It reads a document like a person: first the table of contents, then the chapters that it needs.

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Prepare documents ahead of time** | Indexes the documents in the vault in the background. | on | both |
| **Section summaries** | The model writes a one-sentence summary of each part of a document. | off | both |

### Prepare documents ahead of time

With this setting on, the plugin reads each document before a task needs it. It finds the chapters and headings and keeps the result in the plugin's own folder, `.obsidian/plugins/icap-agent/docs/`. Your vault does not get a new folder. No model reads the document, so this costs nothing.

The plugin can always make the cache again. If a device does not have the cache, that device prepares its own documents.

If the setting is off, the plugin reads a document when a task first needs it.

:::note
The plugin cannot read a scanned PDF that has no text layer.
:::

### Section summaries

With this setting on, the model writes a summary of each part of a document, one time. The agent then sees the summaries in the table of contents.

:::caution
Summaries cost tokens. The input is about as many tokens as the document has words.
:::

## Folders outside the vault

On a computer, the agent can also read documents in folders outside the vault. This setting is in the group **Advanced**, and it shows only when **Agent setup** is **ICAP only (isolated)**. Read [Agent setup](/settings/agent/).
