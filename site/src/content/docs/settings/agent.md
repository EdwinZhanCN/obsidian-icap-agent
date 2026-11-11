---
title: Agent setup
description: Choose what the agent can use on a computer, and the other advanced settings.
sidebar:
  order: 5
---

The group **Advanced** in **Settings → ICAP Learning Agent** sets what the agent can use and how it runs.

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Agent setup** | Which tools and files the agent can use. | **Your Pi setup + ICAP** | computer |
| **Folders outside the vault** | Folders outside the vault that the agent can read. | none | computer, only with **ICAP only (isolated)** |
| **Remember a request's context** | A follow-up continues the agent's session. | on | computer |
| **Parallel tasks** | How many tasks can run at the same time, from 1 to 6. | 3 | both |

## Agent setup

On a computer, the agent is [Pi](https://pi.dev). Pi is a general agent. You can also use it from the command line, with your own skills and extensions. **Agent setup** decides if ICAP uses that setup.

| | **Your Pi setup + ICAP** | **ICAP only (isolated)** |
|---|---|---|
| Models and credentials | Pi's (`~/.pi/agent/`) | Pi's (`~/.pi/agent/`) |
| ICAP's tools | yes | yes |
| Read files in the vault | yes | yes |
| Change files directly | yes | no |
| Shell commands | yes | no |
| Your skills, extensions, prompt templates and MCP servers | yes | no |
| Pi's global `~/.pi/agent/AGENTS.md` | yes | no |
| `AGENTS.md` files inside the vault | yes | yes |
| The vault's `.pi/` folder | if the vault is trusted | no |
| Folders outside the vault | through Pi's shell | only the folders that you allow |

### Your Pi setup + ICAP

This is the default. The agent has all of your Pi setup, and ICAP adds its own tools and its rules for teaching. This is the same as when you run Pi in the vault yourself.

The agent can change files directly, without a proposal that you apply. ICAP does not block these changes. It records each change on the task that made it. You see the changes in the [activity](/learn/activity/).

:::caution
In this setup, text in your vault can influence the agent, and the agent can change files. Your extensions and MCP servers can also connect to their own services. If you do not want this, select **ICAP only (isolated)**.
:::

### ICAP only (isolated)

The agent has only ICAP's tools and Pi's tools that read files. It can make new notes, but it cannot change an existing note directly. To change an existing note, it proposes a change, and you apply it or not. It can read only the vault and the folders in **Folders outside the vault**.

Use this setup if you want the agent to behave the same each time, or if you do not use Pi yourself.

### Project trust

The vault can have its own Pi folder, `.pi/`, with extensions, skills and settings. Pi loads some of these files only from a trusted project.

ICAP does not ask you about trust. It uses the decision that you made in the Pi command line. If you made no decision, ICAP loads the vault's `.pi/` only when it has nothing that needs trust. With **ICAP only (isolated)**, ICAP never loads it.

## Folders outside the vault

This setting shows only when **Agent setup** is **ICAP only (isolated)**. With your Pi setup, Pi's own permissions apply.

Type one absolute path on each line, for example `/Users/me/Books`. A path starts with `/`, `~` or a drive letter such as `C:\`. The plugin ignores other lines.

The agent can then read the files and documents in these folders. It cannot change them.

## Remember a request's context

A request block can have more than one round. With this setting on, a follow-up continues the agent's session from the last reply. The agent then does not read the full conversation again.

The note is always the record of the conversation. If you change the turns in the block, the session no longer matches the block. The agent then starts again from the text in the block. If you turn the setting off, every follow-up starts again from the block.

When you keep or clear the block, the plugin deletes the session.

## Parallel tasks

This is the largest number of tasks that run at the same time. A task after that waits until a task ends.
