---
title: Privacy and network
description: What ICAP sends, where it sends it, and where it keeps your keys.
sidebar:
  order: 5
---

ICAP sends your requests only to the model provider that you choose. ICAP has no server, no account, no telemetry and no analytics. It does not upload your vault.

## Where requests go

Each task sends a request to the model of the task. The provider is the one that you set up in **Model providers**: a provider that you logged in to, a provider of an API key, or a custom endpoint. The provider bills you directly.

ICAP itself makes no other network calls, with these exceptions:

| Call | When | To |
|---|---|---|
| Login | You select **Log in…** on a computer. | The provider's login page. |
| Endpoint check | You save an endpoint on a phone or tablet. | The endpoint that you typed. ICAP checks one time if the server lets the app stream the reply. |
| **Get a key** | You select it on a phone or tablet. | The provider's key page, in your browser. |

:::caution
With the agent setup **Your Pi setup + ICAP** on a computer, the agent uses your own Pi extensions, MCP servers and shell. These can connect to their own services. ICAP does not control them. To prevent this, select **ICAP only (isolated)** in **Agent setup**.
:::

Interactive visuals have no network access. A visual cannot load scripts, fonts or images from the internet. It can open only a link in the vault, and only after you use the visual.

## What a task sends

A task sends the context of the note that you work in. ICAP collects this context from the note:

- the name and the path of the note,
- the headings above the cursor,
- the note properties,
- the names of the notes that the note links to (up to 30),
- the paragraphs around the cursor or the selection,
- the section that holds the cursor,
- the note, cut to about 9000 characters around the cursor,
- the selected text, if there is one.

Each kind of task uses only some of these parts. An explanation, for example, sends the passage, the part of the note around it and the selection.

A task also sends:

- the text in **Your background** and **How you like to learn**, from the settings,
- the vault's `AGENTS.md`, if there is one,
- for a request block, the conversation of the block, as it shows in the note,
- for a recall, check or quiz, your answers.

On a computer, with **Your Pi setup + ICAP**, the agent also gets Pi's global `AGENTS.md`. ICAP never loads an `AGENTS.md` from a folder above the vault.

### What the agent reads

The agent can use tools to read more of the vault: search, links, backlinks, notes and documents. What it reads goes to the provider. With **ICAP only (isolated)**, the agent can read only the vault and the folders in **Folders outside the vault**. On a phone or tablet, the agent can read only the vault.

When **Section summaries** is on, the model reads each document one time to write summaries. This sends the text of the documents in the vault to the provider.

## Where your keys are

| Device | Where the key is |
|---|---|
| Computer | Pi's file `~/.pi/agent/auth.json`, or an environment variable in your shell profile. A custom endpoint is in `~/.pi/agent/models.json`. ICAP does not keep a copy. |
| Phone or tablet | Obsidian's secret storage on that device. A key is not in the vault and does not sync. |

:::caution
A key in `models.json` is plain text. To keep it out of the file, type `$NAME` in place of the key. Pi then reads the environment variable `NAME`.
:::

On a computer, ICAP runs your login shell one time, the first time it starts the agent. It reads the environment variables that Obsidian does not have, for example a provider key in `~/.zshrc`. It does not replace a variable that Obsidian already has.

## What stays in the vault

| What | Where |
|---|---|
| Settings and the state of live blocks | `.obsidian/plugins/icap-agent/data.json` |
| Saved sessions of request blocks (computer only) | `.obsidian/plugins/icap-agent/sessions/` |
| The document cache | `.obsidian/plugins/icap-agent/docs/` |
| Task notes and the Activity base, only if **Record tasks as notes** is on | `ICAP/` |

If you sync your vault, these files sync with it. Keys on a phone or tablet do not sync.
