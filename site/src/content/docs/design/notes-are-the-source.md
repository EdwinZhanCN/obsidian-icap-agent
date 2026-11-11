---
title: The note is the source
description: Your notes hold everything that matters. The plugin and the agent only work on them.
sidebar:
  order: 1
---

Your notes are the only record of your learning. If you remove the plugin, your notes stay complete and readable. If the plugin loses its own data, you lose nothing that you kept.

## Kept output is plain Markdown

When you keep a result, the plugin writes ordinary Obsidian Markdown into the note:

| You keep | The note gets |
|---|---|
| an explanation | a `gloss` callout |
| a recall or a check | your words and a `feedback` callout |
| a quiz | a `practice` callout |
| a request block | a `request` callout with your requests, the replies and links to the files |

Each kept record also has a one-line comment above it, such as `<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds topic="RAII" -->`. Obsidian does not show the comment in Reading view. The comment gives other tools the date and the result. The callout title gives the same date and result to you.

The plugin does not need its own data to read these records. Another tool can read them too. The file `FORMAT.md` in the plugin's source code describes each record, and a change to a record changes its format version.

## Temporary things stay out of the file

Some things exist only while you work:

- An explanation that you did not keep shows in the editor, but it is not in the file. If you select **dismiss**, the file does not change, because the explanation was never in it.
- A question block in progress is a short ```` ```icap-ask ```` fence in the file. The answers and the feedback are in the plugin's data until you keep them.
- When you fold a block, only the view changes. The file stays the same.

Thus a note never contains half of a conversation in a form that only the plugin can read. If you open the note without the plugin, a live block shows as a short code block.

## The conversation is what the block shows

A request block can have many rounds. The agent knows only what the block shows: your requests and its replies, in order. The plugin makes this text from the block for each new round.

The desktop plugin also keeps the agent's Pi session for the block, so that the next round starts faster. This session is only a cache. The plugin uses it again only if it matches the block exactly. If you change the block, or the session is not there, the plugin gives the visible conversation to a new session. On a phone, the plugin always does this.

Commands such as `/model`, `/thinking` and `/compact` change how the agent works. They do not go into the conversation or into the kept record.

## Keeping is a decision

The agent's output is temporary until you keep it. To choose what stays in your note is a part of learning: you decide what is worth your notes. For this reason the plugin does not save everything automatically.
