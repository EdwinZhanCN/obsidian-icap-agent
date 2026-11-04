# icpa-agent — Interaction Design

> Document as Interface, Agent as Runtime.

This note records the directions explored before implementation, why one was chosen,
and the design language that came out of it. README.md remains the source of truth for scope.

---

## 1. What the interface has to do (from ICAP)

| ICAP mode | What the learner is actually doing | What the interface must make cheap | What it must NOT make cheap |
|---|---|---|---|
| Passive | reading | getting past a blocking concept without leaving the paragraph | replacing the reading with AI text |
| Active | selecting, keeping, rearranging | deciding *what* stays in the note | auto-saving everything |
| Constructive | producing an explanation from memory | writing in your own words, without peeking | having the agent rewrite your answer |
| Interactive | reasoning back and forth | responding to a pointed follow-up, revising | drifting into open-ended chat |

Two consequences shaped every decision:

1. **Agent text and learner text must be visually distinct, but share one page.**
   The learner should always be able to tell "what I wrote" from "what I was told" —
   that is the difference between Constructive and Passive.
2. **Persistence is a learning act.** Keeping an explanation, or keeping a corrected
   understanding, is an Active decision. So the default for anything the agent produces is
   *transient*; the learner promotes it into the note.

---

## 2. Directions explored

### A. Marginalia (Tufte side-notes)

Explanations and questions live in the right margin, aligned with the line they annotate.
The text column is never interrupted.

- **+** Reading flow is untouched (great for Passive).
- **+** Strong, recognisable identity — a tutor's pencil in the margin.
- **−** Obsidian's readable line width, split panes and narrow windows leave no reliable margin;
  it collapses into popovers, which is exactly the "separate AI surface" we are avoiding.
- **−** Writing an answer in a 220px column is miserable. Constructive work is penalised —
  the mode ICAP values most gets the worst ergonomics.
- **−** Margins cannot hold code blocks or math comfortably.

### B. Interleaved passages ("the note grows in place")  ← chosen

Agent output appears *between* paragraphs of the note, typeset as a secondary voice of the same
document: same text column, same fonts, a hairline ink rule that sits out in the gutter, a quiet
small-caps label. Questions appear where they are asked; the learner answers on a writing line that
looks like the note's own body text. Feedback is set as an annotation beneath the learner's words.

- **+** Proximity: the gloss is directly under the paragraph that caused the confusion.
- **+** Works at any width; code, math, links and embeds render exactly like the note
  (Obsidian's own renderer).
- **+** The learner's answer *is* note text — Constructive output is first-class, not a form field.
- **+** Continuity: question → answer → feedback → follow-up → revision is one vertical passage,
  read top to bottom like a worked example, not a message list.
- **−** Inserting content pushes text down. Mitigated by: explanations start short by default,
  are transient until kept, collapse to one line, and expand only on request.

### C. Anchored threads (comment-style dialogue)

Each interaction is a thread pinned to a text range, opened as a floating card.

- **+** Natural for Interactive back-and-forth.
- **−** It is a chat panel in disguise: bubbles, timestamps, a reply box. Pulls attention off
  the note and invites open-ended conversation instead of focused reasoning.
- **−** Results live in the thread, not in the note — the knowledge does not settle.

### D. Study mode (a separate recall surface)

A dedicated mode where the note disappears and the learner writes from memory, then sees feedback.

- **+** Excellent retrieval practice — no peeking possible.
- **−** Leaves the document. Feels like an app inside the app.

### Comparison against ICAP

How well each direction supports what the learner is actually doing in each mode
(●  strong · ◐  workable · ○  works against it):

| | Passive (read a gloss) | Active (choose what stays) | Constructive (write from memory) | Interactive (respond, revise) | Knowledge settles in the note |
|---|---|---|---|---|---|
| A. Marginalia | ● | ◐ | ○ narrow column | ◐ | ◐ |
| **B. Interleaved** | ● | ● keep / dismiss in place | ● answer is body text | ● one vertical passage | ● |
| C. Threads | ◐ | ○ | ◐ | ● but drifts into chat | ○ lives in the thread |
| D. Study mode | ○ leaves the note | ○ | ● no peeking | ◐ | ◐ copied back |

B is the only direction without a "works against it" cell; its weak spot (Constructive recall can
peek at the source) is closed by borrowing D's one strength.

**Decision:** B, borrowing one idea from D — the **recall veil**. When the learner writes from
memory, the rest of the note is softly veiled *in place* (blurred, not hidden), so retrieval is
honest without leaving the document. Lifting the veil is one keystroke.

---

## 3. Design language

**Two voices on one page.**
- *Learner voice* — the note's own body text. Answers are typed on a borderless writing line in
  `--font-text` at body size. When kept, they become plain Markdown paragraphs.
- *Agent voice* — same column, `--font-text` at ~0.95em, a 1.5px **ink rule** set into the left
  gutter, a small-caps label (`gloss · RAII`, `question`, `note`). No card, no background fill,
  no avatar.

**One ink.** The plugin's identity is a single annotation colour — a warm madder/terracotta, like a
tutor's pencil — derived per theme from Obsidian variables (lighter in dark mode). It is used only for:
the ink rule, the explained-term underline, selection marks on choices, and verdict glyphs. Everything
else is inherited from the theme so community themes keep working. A setting switches the ink to the
theme accent.

**Verdicts without shame.** Feedback marks are glyphs in the gutter, not red/green:
`✓ holds` · `≈ partly` · `? reconsider`. Errors are framed as something to look at again.

**State is a sentence, not a badge.** Each block ends with a caption line in the interface font:
"waiting for your answer · ⌘↵ to submit", "reading your answer…", "done — keep · clear".
No status pills.

**Waiting is the ink being drawn.** While the agent works, the ink rule draws downward in a slow
loop (a single gradient, not a spinner, not a glow). Text streams in under it. With
`prefers-reduced-motion`, the rule is simply dashed.

**Choices are marked like paper.** Options are a lettered list (a. b. c.). Selecting draws an ink
circle around the letter (single) or a tick (multiple). Keys `a`–`h` select, `Enter` submits.

**Activity is a ledger, not a feed.** A tiny status-bar mark (`○` idle, `◔` working, `●` needs you).
Clicking unfolds a ledger: one line per task in past tense ("Explained ‘RAII’ in *C++ Memory*",
"Created 3 notes"), with links to what changed. Waiting tasks float to the top with a jump link.
No tool calls, no model thoughts.

---

## 4. Flows

### Explanation (Passive → Active)
1. Select a term or passage. A small ink mark appears at the selection end after a short pause
   (or use the command / context menu / hotkey).
2. The term gets a dotted ink underline; a gloss opens *after the paragraph*, label `gloss · term`,
   the ink rule drawing while it streams.
3. The gloss ends with quiet actions: **keep** · *deeper* · *example* · *compare…* · dismiss.
   Follow-ups append to the same gloss as sub-passages.
4. **Keep** turns it into a native Obsidian callout `> [!gloss]` — plain Markdown that still renders
   (and still reads well) without the plugin. Dismiss leaves the file untouched; the gloss was never
   in the file.

### Recall & feedback (Constructive → Interactive)
1. "Recall from memory" on a heading/selection inserts a question in place; the note is veiled.
2. The learner writes. ⌘↵ submits.
3. Feedback appears under the learner's words with a verdict glyph; the agent may ask one pointed
   follow-up (a counter-example, a contrast). The learner answers or **revises** their own text —
   the agent never rewrites it.
4. On completion: **keep** writes the learner's final words as plain Markdown plus the feedback as a
   `> [!feedback]` callout; **clear** removes the whole interaction.
5. "Check what I wrote" on a selected paragraph does the same for text already in the note.

### Interactive learning (quiz / discussion)
The agent poses questions one at a time through the same block — choice, multiple choice, free text,
confirm — each answer flowing straight into analysis and the next step, ending with a short summary.

### Agent-assisted notes
Commands ask the agent to create a concept note, collect key concepts, compare concepts, or turn a
finished interaction into a note. New notes are created directly and listed in the ledger. Edits to
existing notes are always proposed inline as a reviewable diff and applied only on approval.

---

## 5. Motion — "ink and paper"

Motion is part of the interaction, not decoration: it says *who* is writing, *where* something
belongs, and *what just changed*. Implemented with [Motion](https://motion.dev) (vanilla
`animate`, springs, `press`) in `src/ui/motion.ts`; every component uses the same few tokens.

| Token | Spring | Used for |
| --- | --- | --- |
| `settle` | critically damped, ~0.4 s, no bounce | content arriving, the page making room, panels |
| `hand` | ~0.34 s, bounce 0.22 | the learner's marks: ring/tick strokes, verdict stamp, the status dot |
| `quick` | ~0.2 s, no bounce | captions, presses, small swaps |
| `leave` / `fade` | faster than arriving | dismissing, folding, closing |

**Principles**

1. *Ink before words.* An agent passage arrives the way a tutor annotates: the ink rule is drawn
   down the gutter (a registered `--icpa-rule-scale` property feeding `scaleY`), then the label and
   paragraphs settle in under it, staggered; a verdict glyph is *stamped* into the margin (scale +
   a small rotation on `hand`). Streaming keeps finished paragraphs' DOM nodes, so only the
   growing tail changes under the reader's eyes.
2. *The page makes room.* Glosses and blocks sit in a frame whose height follows its content on
   `settle`: inserting, streaming, a follow-up, feedback, folding, a section going away — the note
   below glides, never jumps, never wobbles. Interrupted changes retarget from the current height.
3. *The learner's marks are hand-drawn and reversible.* Choosing draws an SVG ring (single) or box +
   tick (multiple) with `pathLength`; changing your mind erases it from wherever the pen is. On
   submit the same list locks in place — the chosen option keeps its ring, the others recede — so
   question → choice → submit → feedback is one continuous surface, not a swap of components.
4. *Leaving retreats into the ink.* Dismiss: words fade, the rule retracts upward, the gap closes.
   Keep: actions fade, the file is written, and the native callout is carried from where the gloss
   stood (FLIP), so the explanation never appears to leave. Applying a proposed edit: removed lines
   fold away and the wash leaves the added lines — they are simply the note now (played *before* the
   file is written, since writing re-renders the block).
5. *Activity is continuous with the work.* The ledger rises out of the status-bar mark and sinks
   back into it (reversible mid-way); rows that change while it is open settle in; a finished task's
   tick is drawn once; the dot is stamped when the agent hands you the turn or finishes. No
   breathing glows, no loops other than the working indicator itself.

**Engineering rules.** Only frames animate `height`; everything else is `transform`/`opacity` (or the
registered property). Keyframes always end at the element's natural state, so reduced motion keeps
only a 140 ms opacity fade and the layout is exactly right. Entrances play once per thing — keys are
remembered, and what existed when Obsidian started is acknowledged on load — so CodeMirror
re-creating a widget, Obsidian re-rendering a code block, or a plugin reload never replays them. A
turn takes one answer (double clicks and repeated ⌘↵ are ignored). After a frame settles,
CodeMirror is asked to re-measure.

**Guidance — where to look next.** Micro-motion stays quiet; the moments that hand attention back to
the learner are marked deliberately, each once, never with a glow or a loop:

| Moment | What the learner sees |
|---|---|
| The agent finishes a passage (explanation, final feedback) | the margin rule is *pressed* once — a wider stroke of full ink that fades back (~1.1 s) — then the next steps settle in and the primary one (*keep in note*, …) has its underline drawn |
| The agent hands over the turn | the question is pressed and the answer surface rises in after it |
| It happens off screen | an edge cue at the top or bottom of the editor — "↓ your turn", "↑ explanation ready" — nudges once towards it; clicking goes there, focuses the answer and presses the passage again; it leaves when the place scrolls into view or the question is resolved |
| Something is written into the note | a highlighter pass: the new text (or callout) is washed with ink and fades within ~3 s. Keep / write it up stay in view; an applied edit elsewhere doesn't move you — a cue "edit applied" points to it |

The keyboard is only taken when the learner is already at the interaction; if it is off screen
they may be writing elsewhere, so focus and scroll are left alone and the cue does the pointing.

## 6. The guide — the first interaction is a real note

On first install the plugin creates and opens *Learning with ICAP* (*用 ICAP 学习* for a Chinese UI).
It is not a welcome page: its subject is ICAP itself, and each step is the learner doing that
kind of engagement on that subject —

1. **Explanation** — select *scaffolding* in the text and choose *explain*; keep it as a callout.
2. **Interaction** — an authored single-choice question; the agent responds to the answer (without
   giving it away if it is wrong) and continues with one or two more.
3. **Recall & feedback** — explain *constructive vs. interactive* from memory (the veil comes down
   when you start writing); feedback, a follow-up, then *write it up*.
4. **Activity** — the agent writes a concept note on ICAP and proposes linking it from the guide;
   the ledger shows the task, the note it created and the note it edited.

Steps 2–4 are *authored Interactive Blocks*: ```` ```icpa-ask ```` fences with `authored: yes` that
come alive the first time they render. Anyone can write them into their own notes:

````markdown
```icpa-ask
id: modes-check
kind: quiz            # quiz · recall · agent
authored: yes
topic: The four modes
---
Which of these is constructive?
- [ ] Re-reading the chapter
- [ ] Explaining it to yourself in new words
```
````

*start over* resets an authored block in place; *keep* turns it into the learner's Markdown like any
other block. Afterwards the guide is simply the learner's first study note.
