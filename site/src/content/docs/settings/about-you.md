---
title: About you
description: Tell the agent what you know, how you like to learn, and how this vault is organised.
sidebar:
  order: 2
---

The group **About you** in **Settings → ICAP Learning Agent** tells the agent about you and about this vault. The agent uses it in every task.

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Your background** | What you already know. | empty | both |
| **How you like to learn** | Language, style and depth for every task. | empty | both |
| **This vault's conventions** | Makes `AGENTS.md` at the root of the vault, or opens it. | no file | both |

## Your background

Write what you already know, in a few short lines. For example: "Comfortable with Python; new to C++; know basic linear algebra."

The agent builds an explanation only on two things: what you write here, and what is in your notes. If this setting is empty, the agent does not guess your level. It can read related notes in the vault.

## How you like to learn

Write the language, the style and the depth that you want. For example: "Explain in Chinese; keep English terms; prefer small code examples."

The agent follows this text in every task.

## This vault's conventions

This setting writes a note, `AGENTS.md`, at the root of the vault. The note tells the agent what you study in this vault and how your notes are organised. The agent reads it before every task, in both agent setups. You can change the note at any time.

If `AGENTS.md` does not exist, the button is **Set up…**. If it exists, the button is **Open**.

### Make AGENTS.md

1. Select **Set up…**.
2. Select the kind of study:
   - **A course**: lectures, slides, problem sets, exams.
   - **Reading a book**: one or a few books, chapter by chapter.
   - **Research / papers**: reading papers, literature reviews.
   - **A language**: vocabulary, grammar, reading.
   - **Programming / tech**: languages, frameworks, systems.
   - **Start blank**: you write the rules yourself.
3. In **What do you study here?**, type one or two sentences.
4. Optional: in **Where is your study material?**, select the folder with your books, slides or papers.
5. Optional: in **A folder the agent must not change?**, select a folder. The agent can still read it.
6. Select **Preview**.
7. Read the text, and change it if necessary.
8. Select **Create AGENTS.md**.

The plugin makes the note and opens it. The agent reads it from the next task.

Each kind of study adds its own rules. For example, **A course** tells the agent to give a hint before a full solution. All kinds also add general rules:

- Look for a note on the same subject before you make a new note.
- Link only to notes that exist, or that the same task makes.
- Do not invent sources, quotations or numbers.

:::note
The wizard never overwrites a file. If `AGENTS.md` already exists, the plugin does not change it.
:::

### Which AGENTS.md files the agent reads

The agent reads the `AGENTS.md` files inside the vault. With **Your Pi setup + ICAP**, it also reads Pi's global `~/.pi/agent/AGENTS.md`. It never reads an `AGENTS.md` in a folder above the vault, because that file is for other work. Read [Agent setup](/settings/agent/).
