---
title: Note format
description: What ICAP writes into your notes, for people and for other tools.
sidebar:
  order: 3
---

ICAP writes plain Obsidian Markdown. If you uninstall the plugin, your notes stay readable. This page tells you what each part means. The full contract for tool authors is [FORMAT.md](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/main/FORMAT.md) in the repository.

The current format version is **5**. A tool that reads the format must ignore callout types, comment keys and `kind:` values that it does not know.

## Who wrote what

| Marker | Who wrote it |
|---|---|
| `> [!gloss] term` | The agent. It is an explanation that you kept. |
| `> [!feedback]` | The agent. It is feedback on your answer or on your text. |
| `> [!practice]` | You and the agent. It is a kept quiz: the questions, your answers and the marks. |
| `> [!request] topic` | You and the agent. The `**Request:**` lines are yours. The replies are the agent's. |
| note property `generated-by: icap-agent` | The agent made the note. To stop this marker, turn off **Mark notes the agent creates** in the settings. |
| all other text | You. |

A gloss, a reply and a note that the agent made are not evidence of what you know.

## Live blocks

A block that is in progress is an `icap-ask` fence:

````markdown
```icap-ask
id: q7f3a2
kind: recall
---
Explain RAII in your own words.
```
````

- `id` and `kind` are necessary. `kind` is `recall`, `check`, `quiz`, `agent` or `request`.
- The answers and the feedback are not in the file. They are in the plugin's data. A tool must read nothing from a live block.
- `authored: yes` marks a block that a person wrote by hand. Its body is the first question. A quiz uses `- [ ] option` lines, and `choose: many` for more than one answer.

When you keep the block, ICAP replaces the fence with a record.

## Kept records

A kept recall, check, quiz or gloss has two parts: an `<!-- icap … -->` comment, and a callout on the line directly below it.

### Recall

Your final words come first. The feedback comes below them.

```markdown
RAII ties a resource's lifetime to an object's lifetime.

<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds topic="RAII" -->
> [!feedback] RAII · 2026-11-06 · ✓
> Right. One gap: …
```

### Check

Your text was already in the note. ICAP adds only the callout, directly after the paragraph that it checked.

```markdown
<!-- icap check id=c1 date=2026-11-06 verdict=partly topic="Covariance matrix" -->
> [!feedback] Covariance matrix · 2026-11-06 · ≈
> The diagonal is right; the off-diagonal …
```

### Quiz

One callout holds the full quiz. Each answer has its own mark.

```markdown
<!-- icap quiz id=z1 date=2026-11-06 holds=2 partly=0 reconsider=1 topic="RAII" -->
> [!practice] Understanding check — RAII · 2026-11-06
> **1.** What releases the lock?
> *My answer:* the destructor ✓
```

### Gloss

```markdown
<!-- icap gloss id=g4k2 date=2026-11-07 depth=plainer topic="rule of zero" -->
> [!gloss] rule of zero
> A class that owns no resource needs no destructor, copy or move members.
>
> **Plainly.**
> …
```

A `**Plainly.**` section shows that you asked for a plainer explanation. A `**Deeper.**` section shows that you asked for more. These headings stay in English in all languages. The title is cut at 60 characters. The comment keeps the full term.

### Request

A kept request block is a `[!request]` callout with no comment above it. It has each request and its reply, and a `**Files:**` line with the files that the task made, changed or deleted.

```markdown
> [!request] Learning path for C++
> **Request:** build a learning path from Sources/
>
> Created a path and 12 notes…
>
> **Files:** created [[Learning/Path|Path]] · changed [[C++]]
```

:::note
The labels in a record follow the interface language. In Chinese, ICAP writes `理解检验 — `, `*我的回答:*`, `**请求:**` and `**文件:**`. The callout types and the comment keys are always in English.
:::

## Verdict marks

The callout title ends with the date and a mark. The comment has the same verdict as a word.

| Mark | Verdict in the comment | Meaning |
|---|---|---|
| ✓ | `holds` | Your answer is correct. |
| ≈ | `partly` | Your answer is partly correct. |
| ? | `reconsider` | Look at your answer again. |

## The comment

```
<!-- icap <kind> id=… date=YYYY-MM-DD [verdict=…] [holds=N partly=N reconsider=N] [depth=…] [paragraphs=N] [topic="…"] -->
```

| Key | Used in | Meaning |
|---|---|---|
| `id` | all | The id of the block when it was live. |
| `date` | all | The day you kept the block, in local time. |
| `verdict` | recall, check | The last verdict of the agent. It is absent if the agent gave none. |
| `holds`, `partly`, `reconsider` | quiz | The number of answers with each verdict. |
| `topic` | all | What the record is about: the selected text, the section heading or the note name. For a gloss, the full term. The plugin writes it, not the model. |
| `paragraphs` | recall | The number of paragraphs of your answer, when there is more than one. |
| `depth` | gloss | The follow-ups you asked for: `plainer`, `deeper`, or both. |

The title is for people, and you can edit it. If the title and the comment are different, a tool uses the comment.

## Visuals

An interactive visual is an `icap-ui` fence that holds an HTML document. It can be in a reply or in a note that the agent made. ICAP does not save the state of a visual. A visual is not evidence.

## Task notes

A task note records a request or a note-making task. See [Task notes](/reference/task-notes/).

## Earlier spellings

The plugin was spelled ICPA in earlier versions. ICAP still reads these spellings:

| Written now | Still read |
|---|---|
| `icap-ask` fence | `icpa-ask` fence. When ICAP writes the block again, the fence changes to `icap-ask`. |
| `generated-by: icap-agent` | `generated-by: icpa-agent` |

Records kept before format 1 have no comment and no date in the title. ICAP reads them as evidence with an unknown date.
