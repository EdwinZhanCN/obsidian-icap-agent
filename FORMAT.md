# What ICAP writes into notes

Format version **1** (2026-11-06). This is the contract between ICAP and any tool that reads a vault ICAP has worked in. Kept output is plain Obsidian Markdown: it must read well without the plugin, and nothing here depends on plugin data (`data.json`), whose shape is private and may change without notice.

Readers must ignore what they do not know: unknown callout types, unknown keys in a comment, unknown `kind:` values. A new key or kind is an additive change; removing or renaming one, or changing a meaning, bumps the version.

## Provenance: who wrote what

| Marker | Meaning |
|---|---|
| note property `generated-by: icap-agent` (legacy `icpa-agent`) | the note was created by the agent (`create_note`). Its text is not evidence of what the learner knows. The learner can turn this marker off in settings |
| `> [!gloss] term` | an explanation the agent gave and the learner kept. Agent text, not evidence of understanding. A `**Plainly.**` section means the learner asked for a plainer version, `**Deeper.**` for more; implicit feedback on depth |
| `> [!request] topic` | a kept record of requests to the agent: the learner's `**Request:**` lines are theirs, the replies are the agent's |
| everything else | the learner's own writing, unless it is inside one of the callouts above |

## Live blocks

A recall, check, quiz, agent question or request in progress is an ```` ```icap-ask ```` fence (legacy ```` ```icpa-ask ````, still read, never written):

````
```icap-ask
id: q7f3a2
kind: recall
---
Explain RAII in your own words.
```
````

The header is `key: value` lines; `id` and `kind` are required. `kind` is one of `recall`, `check`, `quiz`, `agent`, `request`. `authored: yes` marks a block a person wrote by hand (for example in the guide); its body is the first question, with `- [ ] option` lines for a quiz and `choose: many` for multi-select. Live state (answers, feedback) is not in the file. A tool should treat a live block as "in progress" and read nothing from it.

Rewriting a legacy block upgrades its fence to `icap-ask`.

## Evidence: kept recalls, checks and quizzes

On *keep*, the fence is replaced in place by the record below. The comment line and the callout are one unit: the comment is always the line directly above the callout.

**Recall.** The learner's final words, then the feedback:

```markdown
RAII ties a resource's lifetime to an object's lifetime, so the destructor releases it.

<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds -->
> [!feedback] RAII · 2026-11-06 · ✓
> Right. One gap: …
```

**Check** (*Check what I wrote*). The learner's text was already in the note; the record is only the callout, placed **directly after the paragraph that was checked**. Readers pair the two by adjacency.

```markdown
A covariance matrix holds the variance of each variable on its diagonal and …

<!-- icap check id=c1 date=2026-11-06 verdict=partly -->
> [!feedback] Covariance matrix · 2026-11-06 · ≈
> The diagonal is right; the off-diagonal …
```

**Quiz.** One callout for the whole exercise. Each answered question carries its own mark; the comment carries the counts.

```markdown
<!-- icap quiz id=z1 date=2026-11-06 holds=2 partly=0 reconsider=1 -->
> [!practice] Understanding check — RAII · 2026-11-06
> **1.** What releases the lock?
> *My answer:* the destructor ✓
>
> **2.** …
> *My answer:* … ?
```

### The comment

```
<!-- icap <kind> id=<block id> date=YYYY-MM-DD [verdict=holds|partly|reconsider] [holds=N partly=N reconsider=N] -->
```

| Key | Present for | Meaning |
|---|---|---|
| `id` | all | the block's id, as in its fence while it was live |
| `date` | all | the local calendar day the block was kept. Interactions are short, so this is the day of the recall; the turns themselves carry no clock |
| `verdict` | recall, check | the last verdict the agent gave: `holds`, `partly`, `reconsider`. Absent when the agent gave none |
| `holds`, `partly`, `reconsider` | quiz | how many answered questions got each verdict |

The callout title repeats `date` and the verdict as a mark (`✓` holds, `≈` partly, `?` reconsider) after ` · ` separators, for the reader. When the two disagree, the comment wins: the title is for people and may be edited.

### What is evidence of what

| Text | Evidence of | Strength |
|---|---|---|
| the learner's words above a recall callout | what they could produce from memory, judged by the verdict | strong |
| the paragraph above a check callout | what they wrote and had checked | strong |
| a quiz callout | recognition, per question | medium |
| notes the learner wrote (no markers) | exposure and some understanding | medium |
| `[!gloss]` with *Plainly.* / *Deeper.* | the depth that suited them | weak |
| agent-written text (`[!gloss]`, `[!request]` replies, `generated-by` notes) | nothing about the learner | none |

Records kept before format 1 have the callout without the comment and without the date in the title. Read them as evidence with an unknown date and, for recalls and checks, an unknown verdict.

## Visuals

An interactive visual is an ```` ```icap-ui ```` fence containing an HTML document, in an agent reply or an agent-created note. It is never evidence. Its state is not saved.

## Changes

| Version | Date | Change |
|---|---|---|
| 1 | 2026-11-06 | kept recall, check and quiz callouts carry the date and verdict in the title and in an `<!-- icap … -->` comment |
