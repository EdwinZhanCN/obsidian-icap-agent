---
title: Task notes
description: The notes that record tasks, their properties, and the Activity base.
sidebar:
  order: 4
---

A task note is a note in `ICAP/Tasks/` that records one task. Obsidian's Bases, and other tools, can list tasks by the properties of these notes. The list is the activity, in `ICAP/Activity.base`.

ICAP writes task notes only when **Record tasks as notes** is on (**Settings → Files**). The setting is off by default. When you turn it on, ICAP writes the notes of your recent tasks and makes `Activity.base`.

## When ICAP writes a task note

| Task | Task note |
|---|---|
| A note-making task (**Create a concept note from selection**, **Collect key concepts of this note into notes**, **Write a comparison note…**) | Always. |
| A request block | Only when the conversation becomes a task: the agent used a tool, the agent made, changed or deleted a file, the agent asked you a question, or the block has more than one round. |
| A request block with one question and one answer | Never. |
| An explanation, recall, check or quiz | Never. |

The slash commands `/model`, `/thinking` and `/compact` are not rounds. For a request block, all rounds update the same task note.

ICAP finds a task note by its `icap-id`, not by its path. You can rename a task note or move it to a different folder.

## Where task notes go

Task notes go to `ICAP/Tasks/`. To use a different folder, change **ICAP folder** in the settings. The folder holds `Activity.base`, and the task notes are in its `Tasks` folder.

If you delete a task note, ICAP does not write it again by itself. To write it again, run **Rebuild task notes from recent activity**. This command knows only the latest 60 tasks.

## Properties

| Property | Type | Meaning |
|---|---|---|
| `icap` | text | Always `task`. A tool finds task notes by this property. |
| `icap-id` | text | The id of the task. For a request block, it is the id of the block. |
| `icap-status` | text | The status of the task. See the next table. |
| `icap-source` | list of links | The note that the task is about: the note with the request block, or the note where the task started. |
| `icap-changed` | list of links | The files that the task made or changed. |
| `icap-started` | date and time, local | When the latest run started. |
| `icap-ended` | date and time, local | When the latest run ended. It is absent while the status is `running`, `needs-you` or `review`. |
| `icap-cost` | number, or the text `unknown` | The cost of all runs of the task, in US dollars. |
| `icap-tokens` | number | The tokens in and out of all runs, cached tokens included. |
| `icap-cache` | number, 0 to 100 | The percentage of the prompt that the provider read from its cache. |
| `icap-model` | text, `provider/id` | The model of the latest run. |

If a property has no value, ICAP does not write it. ICAP changes only these properties. It does not change other properties, and it does not change the body of a task note after it makes the note.

### Status values

| `icap-status` | Meaning |
|---|---|
| `running` | The agent works on the task. |
| `needs-you` | The agent asked you a question and waits for the answer. |
| `review` | The agent proposed an edit to a note. You did not apply it or decline it yet. |
| `done` | The task is complete. |
| `failed` | The task stopped because of an error. |
| `cancelled` | You stopped the task, or Obsidian closed while the task ran. You can continue it from its block. |

`draft` and `queued` are reserved. This version does not write them.

The status shows only what the task is. What the task does at this second, for example which file it reads, is not in the note.

### The cost

`icap-cost` is an estimate from the list prices of the model. If the provider reports what it billed, ICAP uses that number.

:::note
`icap-cost` is never `0` for "not known". When ICAP cannot tell the cost, it writes `unknown`. This occurs for a model without list prices, for example a custom endpoint, and for a task from before ICAP recorded costs. A task that has ended always has `icap-cost`.
:::

If you log in with a subscription, the provider does not bill per token. The number then shows what the same use costs at list prices.

## The Activity base

ICAP makes `ICAP/Activity.base` one time. After that, the file is yours, and ICAP does not write it again. There is one exception: a base made by an earlier version gets the **Activity** view as its first view, one time.

The base shows all notes where `icap` is `task`. It has these views:

| View | What it shows |
|---|---|
| **Activity** | ICAP's own view (`icap-activity`), newest first. It needs the plugin. |
| **Needs me** | A table of tasks with the status `needs-you` or `review`. |
| **In progress** | A table of tasks with the status `queued` or `running`. |
| **All** | A table of all tasks, grouped by status. The cost and the tokens have a sum. |

The three tables work without the plugin. If you uninstall the plugin, Bases says that the view type of **Activity** is unknown. The tables still work.

The **All** table has a **Minutes** column, from `icap-started` to `icap-ended`. A sum of the cost does not include `unknown`.

### Property names in a base

The property names have a hyphen. Bases reads a hyphen in an expression as a minus sign. Write the names in two different ways:

| Where | Write |
|---|---|
| In a filter or a formula | `note["icap-status"]` |
| As a column, a group, or a display name | `note.icap-status` |

:::caution
In a filter or a formula, always write `note["icap-status"]`. Bases reads a bare `icap-status` as `icap` minus `status`.
:::

To see the activity, see [Activity](/learn/activity/).
