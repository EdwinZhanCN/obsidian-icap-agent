---
title: Slash commands
description: The commands that you type with "/" in a request block.
sidebar:
  order: 2
---

A slash command is a request that starts with `/`. Slash commands work only in a request block. In a recall, check or quiz, your text is an answer, so a `/` at the start is only text.

## Syntax

```
/name argument
```

- The request must start with `/`. The name is the first word after it.
- The argument is all the text after the name. It can be empty.
- When you type `/` at the start of a request block, ICAP shows a list of commands. When you type a space after `/model` or `/thinking`, it shows the values.

## ICAP's commands

These three commands change how the agent of this block works. They do not change other blocks or the settings.

| Command | What it does |
|---|---|
| `/model` | Shows the model of this block. |
| `/model name` | From the next request, this block uses the model `name`. Pi also accepts a part of a name, for example `sonnet`. If no model with credentials matches the name, ICAP warns that the next request may fail. |
| `/model default` | This block uses the model in the settings again. |
| `/thinking` | Shows the thinking level of this block and the available levels. |
| `/thinking level` | From the next request, this block uses the thinking level `level`. The levels are `off`, `minimal`, `low`, `medium`, `high` and `xhigh`. |
| `/thinking default` | This block uses the thinking level in the settings again. |
| `/compact` | Makes a summary of the earlier rounds for the agent. The agent continues with the summary. The note does not change. |
| `/compact instructions` | The same, and the agent uses `instructions` to write the summary. |

In place of `default`, you can also type `reset` or `-`.

:::note
`/compact` works only on a computer, and only when **Remember a request's context** is on. If the block has no saved session, ICAP replies "Nothing to compact: this block's conversation is read from the note itself each time."
:::

### What these commands leave

The reply of `/model`, `/thinking` and `/compact` shows in the block. The agent never sees these commands as part of the conversation. When you keep the block, the `[!request]` record does not include them. They are not counted as rounds of the conversation for a task note.

## Your Pi commands

On a computer, with the agent setup **Your Pi setup + ICAP**, the list also shows your own Pi commands:

- commands from your Pi extensions,
- your prompt templates,
- your skills, as `/skill:name`.

ICAP sends the request to Pi as you typed it. Pi expands the template or the skill, or runs the extension command. The agent gets the context of the note in its instructions.

These requests are normal rounds of the conversation. They show in the kept `[!request]` record.

If one of your commands has the name `model`, `thinking` or `compact`, ICAP's command is used.

:::note
With **ICAP only (isolated)**, and on a phone or tablet, the list shows only ICAP's commands. In isolated mode, the list says "Your own Pi skills and commands are off in “ICAP only” mode (settings → Agent setup)."
:::
