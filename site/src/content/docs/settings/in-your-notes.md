---
title: In your notes
description: Choose what ICAP shows in the editor and how its output looks.
sidebar:
  order: 3
---

The group **In your notes** in **Settings → ICAP Learning Agent** controls what ICAP shows while you read and write.

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Selection mark** | Shows **explain** and **check my words** next to selected text. | on | both |
| **Veil the note during recall** | Blurs the rest of the note while you answer from memory. | on | both |
| **ICAP style** | Uses ICAP's ink and ICAP's look for kept output. | on | both |
| **Interactive visuals** | When the agent can add a visual to a reply or a new note. | **When it helps** | both |

## Selection mark

When you select text, the mark shows next to it. Select **explain** to get an explanation. Select **check my words** to check the understanding that you wrote.

If you turn it off, use the commands and the editor menu in its place. The mark shows only in Live Preview and Source mode.

## Veil the note during recall

During a recall, you write what you remember of a section. With this setting on, the plugin blurs the rest of the note while you write, so you cannot read the answer. One key lifts the veil. Read [Explain from memory](/learn/recall/).

## ICAP style

- On: ICAP's ink is a warm madder colour. Kept explanations and kept feedback use ICAP's look.
- Off: the ink is your theme's accent colour. Kept explanations and kept feedback use your theme's callouts.

The setting changes only the look. The Markdown in the note is the same.

## Interactive visuals

A visual is a chart, a diagram or an exercise that you can try. It runs in a sandbox, with no network access.

| Option | What the agent does |
|---|---|
| **When it helps** | It adds a visual only when you understand better by trying it than by reading. |
| **Only when I ask** | It adds a visual only when you ask for a visual, a diagram, a chart or a simulation. |
| **Never** | It does not add visuals. |

A visual can be in a reply to a request or in a note that the agent makes. It is never in an explanation, in feedback or in a question. A change that the agent proposes to an existing note cannot add a visual.
