---
title: What the agent knows about you
description: The agent judges what you know from your notes, and explains from there.
sidebar:
  order: 3
---

The agent explains at the level that you need, not at a fixed beginner or expert level. It finds what you know in your notes. There is no hidden profile of you: all of the evidence is Markdown that you can read, change and delete.

## Why the level matters

An explanation that helps a beginner can slow down an expert. Learning research calls this the expertise reversal effect. Thus the agent must know something about you before it explains. It must also not claim to know more than it does. The protocol of the plugin tells the agent to adapt to your knowledge only from evidence that it actually read. If it uses a note as evidence, it must say which note.

## The evidence, from weak to strong

| Evidence | What it shows | Strength |
|---|---|---|
| material in your vault, such as books and clippings | you saw the topic | weak |
| **Your background** in the settings | what you think you know | weak |
| **plainer** and **deeper** parts in kept explanations | which depth suited you | weak, but it adds up |
| notes that you wrote yourself | you may understand parts of the topic | medium |
| kept recalls and checks: your words, the result and the date | what you really understand | strong |

A kept quiz is between these levels: it shows what you recognize, question by question. A recent ✓ counts more than an old ≈.

## Who wrote what

The evidence is useful only if the agent can tell your text from its own text. If it read its own notes as your notes, it would see proof of understanding that is not there. So the plugin marks each thing that the agent wrote:

- A note from the agent has `generated-by: icap-agent` in its properties.
- A kept explanation is a `gloss` callout.
- A reply in a kept request is in a `request` callout. Only the **Request:** lines in it are yours.
- Feedback is in a `feedback` or `practice` callout. Your words are outside the callout, directly above it.

The agent counts none of its own text as evidence of what you know. A task note is also not evidence.

## Each record has its date and result

A kept recall or check has the date and a mark in its callout title: ✓ holds, ≈ partly, ? look again. The comment above the callout gives the same date and result, and the topic. A kept quiz counts the marks for its questions. Thus each record has its date without the plugin's data, and the agent can see how old the evidence is.

## What the agent gets for a task

For each task, the plugin gives the agent a context from the note:

- the path and the title of the note, and its properties,
- the headings above the focus,
- the paragraphs around the focus, the section and a part of the note around it,
- the links in the note,
- **Your background** from the settings.

The agent finds more only when it needs it. For example, before it explains a term, it can look at the backlinks of the term and look for your own notes on it. The plugin does not scan the whole vault. It has no vector database and no knowledge graph.

## Light diagnosis

The explanation always comes first. The agent does not test you before it explains. If there is no evidence, and the explanation for a beginner is very different from the explanation for an expert, the agent writes for the level of the note. Then it adds one short line for the other level, such as "If you already know X: …".

The agent judges your level for one concept or one note at a time. There is no global level and no score that follows you.

## The ICAP framework in the plugin

The ICAP framework sorts what a learner does into four modes. The deeper modes usually give better learning. The plugin makes each mode easy, but it does not make the wrong thing easy:

| Mode | The plugin makes this easy | The plugin does not make this easy |
|---|---|---|
| Passive | to understand a difficult term without leaving the paragraph | to replace your reading with the agent's text |
| Active | to decide what stays in the note | to save everything automatically |
| Constructive | to write in your own words without the text | to let the agent rewrite your answer |
| Interactive | to answer a follow-up question and revise | to drift into an open chat |

A mode is what you do, not the name of a control. To select an option is not interactive learning. A conversation is interactive only when you and the agent both reason about the content, reply to each other and revise.

Thus the agent gives a hint or a question for a wrong answer, not the correct answer. A recall, a check or a quiz is always an offer. You can always read and ask without one.
