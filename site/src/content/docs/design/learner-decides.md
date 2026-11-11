---
title: You decide what changes
description: The agent proposes. You apply. Each file change is recorded with its task.
sidebar:
  order: 2
---

The agent does not change your existing notes without your approval. Your answers stay your own words. You can see which task changed which file. Your notes belong to you, so the plugin lets you control them.

## What the plugin writes

The plugin writes only these things:

- Its own blocks, into the note where you started the task.
- Only if you turn on **Record tasks as notes**: a task note in `ICAP/Tasks/` for each task, and the file `ICAP/Activity.base`, one time.

The setting is off by default. Many vaults have their own folders and rules, so the plugin does not add files that you did not ask for. The plugin keeps its cache in its own folder, not in the vault.

The plugin writes a task note only when the state of the task changes. It sets only its own `icap-*` properties. It does not change the body of a task note after it creates it. If you delete a task note, it stays deleted. To write it again, run **Rebuild task notes from recent activity**.

`Activity.base` belongs to you after the plugin creates it. The plugin does not write it again. There is one exception: a base from an earlier version gets the activity view one time, as its first view.

## Changes to an existing note are proposals

To change a note that exists, the agent proposes a change. The block shows the change as a diff: the changed lines, with two lines of context. Then you choose:

- **apply change**: the plugin writes the change into the note.
- **leave the note as is**: the note does not change.

The plugin refuses some proposals before you see them. A proposal cannot add an ```` ```icap-ui ```` visual to a note. A proposal cannot change an ICAP block. The agent can put a visual in its reply instead.

The agent can create a new note without a proposal, because a new note changes nothing that you wrote. The activity lists each new note. The plugin also adds `generated-by: icap-agent` to its properties. To stop this, turn off **Settings → ICAP Learning Agent → Files → Mark notes the agent creates**.

## Your answer stays your own

In a recall, a check or a quiz, the agent writes feedback below your answer. It does not change your answer. If the feedback shows a gap, you revise your own text. When you keep the result, the plugin writes your words, not the agent's words.

This rule protects the difference between two kinds of work. To write an explanation yourself is constructive work. To read an explanation from the agent is passive work. If the agent rewrote your answer, you could not tell the two apart.

## Each file change has a task

For each task, the plugin records the files that the agent creates, changes, deletes or renames. Each task note lists the files that its task created or changed. The activity shows the same list.

On a computer, the default agent setup is **Your Pi setup + ICAP**. Your own Pi tools can then change files directly, for example through the shell. The plugin does not stop these changes. It records each change on the task whose agent was in a tool call at that time, or ended one less than three seconds before. The plugin does not record these files:

- the note of the task itself,
- task notes and `Activity.base`,
- notes that you are typing in.

For more control, set **Settings → ICAP Learning Agent → Advanced → Agent setup** to **ICAP only (isolated)**. The agent then has only ICAP's tools and Pi's read-only tools. It can create a note, or propose a change, and nothing more. On a phone the agent always works this way.
