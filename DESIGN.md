# Design

> Document as Interface, Agent as Runtime.

How ICAP behaves and why. What users can do is in [README.md](README.md); how the code does it is in [AGENTS.md](AGENTS.md).

## 1. The idea

Most AI note tools put the AI in a chat panel. The learner asks, the answer appears in another window, and the learner copies what they want into a note:

**Learner → chat → generated answer → copied into notes**

ICAP removes the panel. The Markdown note is the agent's workspace, its output and its interface:

**Learner ↔ Markdown note ↔ agent runtime**

Explanations, questions, feedback and requests appear in the note, where the reading happened. The goal is not more AI-written notes. The goal is to make understanding cheaper, to invite the learner to do the thinking, and to let what was learned settle into notes the learner owns.

## 2. ICAP and what the interface owes each mode

The ICAP framework (Chi & Wylie, 2014) sorts engagement into four observable modes, and predicts that, other things equal, the deeper ones produce better learning:

| Mode | What the learner is doing | The interface makes cheap | The interface must not make cheap |
|---|---|---|---|
| Passive | reading | getting past a blocking concept without leaving the paragraph | replacing the reading with AI text |
| Active | selecting, keeping, rearranging | deciding *what* stays in the note | saving everything automatically |
| Constructive | producing an explanation from memory | writing in your own words without peeking | having the agent rewrite your answer |
| Interactive | reasoning back and forth | answering a pointed follow-up and revising | drifting into open-ended chat |

The modes describe what the learner actually does, not what a widget is called: clicking an option is not Interactive learning. A conversation counts as Interactive only when both sides reason about the content, respond to each other and revise.

**Principles**

1. **Explanations are easy to get; understanding is the learner's own work.** The agent clears reading blocks quickly, but it doesn't restate, reason or organise on the learner's behalf.
2. **Invite deeper engagement; never force it.** Reading and asking are always free. Recall, self-explanation and discussion are offered, never required before an explanation.
3. **Explain from what the learner knows.** An explanation uses the note, the topic and the learner's evidenced knowledge, not a fixed beginner or expert level.
4. **Stay in the note.** No separate AI workspace, no window switching.

Two consequences shape every interaction:

- **Two voices on one page.** Agent text and learner text are visibly different but share one column. The learner can always tell "what I wrote" from "what I was told", and that is the difference between Constructive and Passive.
- **Keeping is a learning act.** Everything the agent produces is transient until the learner keeps it. Choosing what stays is an Active decision, and kept output is plain Markdown.

## 3. Where the agent's work appears

Agent output is **interleaved** between the note's paragraphs, set as a secondary voice of the same document. It uses the same column and fonts, with a hairline ink rule in the gutter and a quiet small-caps label. A question appears where it is asked. The answer is typed on a writing line that looks like body text, and feedback is set beneath the learner's words. Question, answer, feedback, follow-up and revision read top to bottom as one passage, like a worked example, not a message list.

Three alternatives were weighed against the ICAP modes:

- **Margin notes** leave no reliable room in narrow panes, and writing an answer in a narrow column penalises Constructive work.
- **Comment threads** are a chat panel in disguise, and what is learned stays in the thread.
- **A separate study mode** is honest recall but leaves the document.

Interleaving was the only option that works against no mode. Its one weakness is that recall could peek at the text above. That is closed by borrowing the study mode's strength: the **recall veil**. While the learner writes from memory, the rest of the note is blurred in place, and one key lifts it.

Inserted passages push text down. To limit that, explanations start short, stay transient until kept, and expand only on request. The page also makes room smoothly (see Motion).

What is finished folds; what needs the learner stays open. In a block, earlier rounds fold to one line each (a request and what followed it, or one question with the answer and verdict), but while the learner is answering, the round just before stays open, because its feedback is what they answer from. A proposed change shows only the changed lines with two lines of context, and longer unchanged stretches fold; once decided it folds to its outcome (*accepted · +7 −0*). More than three touched files fold to their counts. The learner can fold a whole block to its header line, which lasts across reloads, and it opens itself when it needs them. Folding is view state only: nothing in the file changes.

## 4. The interactions

### Explanation: Passive → Active

1. The learner selects a term or passage. A small ink mark appears at the end of the selection after a short pause; there is also a command, a context-menu item and a hotkey.
2. The term gets a dotted ink underline. A gloss opens after the paragraph, labelled `gloss · term`, and streams in.
3. The gloss ends with quiet actions: **keep in note**, *deeper*, *example*, *plainer*, *compare…*, *dismiss*. Follow-ups add sub-passages to the same gloss.
4. *Keep* turns it into a native `> [!gloss]` callout that reads well without the plugin. *Dismiss* leaves the file untouched: the gloss was never in it.

### Recall and check: Constructive → Interactive

1. *Recall from memory* on a section inserts a question in place and veils the note.
2. The learner writes and submits.
3. Feedback appears under the learner's words with a verdict glyph. The agent may ask one pointed follow-up, such as a counter-example or a contrast. The learner answers or **revises their own text**; the agent never rewrites it.
4. *Write it up* keeps the learner's final words as plain Markdown with the feedback as a `> [!feedback]` callout, its title ending in the date and the verdict mark (✓ ≈ ?), under a one-line `<!-- icap … -->` comment that says the same for tools. *Clear* removes the whole interaction.

*Check what I wrote* does the same for a paragraph already in the note.

### Questions

The agent asks one question at a time in the same block: single or multiple choice, free text, or confirm. Each answer flows into analysis and the next step. A wrong answer gets a hint or a question that leads the learner to the answer, not the answer itself. The block ends with a short summary.

### Requests

A request block (*Ask the agent here*) is the general way to reach the learner's agent; the fixed actions above are requests written in advance. The learner's words go to the agent verbatim with a minimum of location: the note, the heading and the selection.

- **The process is temporary; the result belongs to the document; the learner decides what stays.** The block shows phases, replies and the files touched. Tool calls appear only in Activity, folded into "n steps". *Keep a record* turns the block into plain Markdown: requests, replies and file links.
- **The note is the source of truth; the agent's session is a cache.** What the agent knows of the conversation is what the block shows. A follow-up resumes the previous session only while it matches the block exactly; otherwise the visible turns are replayed into a fresh session. Keeping is the human form of compaction; `/compact` is the machine form and never touches the note.
- **`[[` or `@` points at files.** They insert ordinary wikilinks. The agent receives the resolved paths, never the contents, and reads what it needs with its own tools. A kept record's links become real outgoing links, so the graph shows which sources a study plan came from.
- **`/` offers commands**, like an editor's palette: the learner's own Pi skills, prompt templates and extension commands, plus ICAP's runtime commands (`/model` and `/thinking` for this block, `/compact`). A runtime command answers with a quiet line and stays out of the conversation and the record. Commands exist only in request blocks: in a recall, check or quiz the learner's words are an answer, and a leading `/` is just text.
- **Dialogs from the learner's extensions** (a confirmation, a choice) appear as questions in the block and are answered in the document.

### Notes the agent writes

Commands ask the agent to create a concept note, collect a note's key concepts, compare concepts, or turn a finished interaction into a note. New notes are created directly and listed in Activity. Edits to existing notes are proposed inline as a diff and written only when the learner applies them.

### Activity

Activity is a status surface, not a chat. A small mark in the status bar shows `○` idle, `◔` working or `●` needs you. It unfolds into a ledger: one line per task in past tense ("Explained 'RAII' in *C++ Memory*", "Created 3 notes"), its state, and links to every file the agent created, changed, deleted or renamed. Waiting tasks float to the top with a jump link. Each task's tool calls are available folded ("n steps"). Model reasoning and internal messages are never shown.

## 5. The agent

### It is the learner's own Pi

Pi is a general agent runtime, not a product UI. ICAP bundles Pi's SDK and runs it inside Obsidian, but the configuration belongs to the learner. The plugin reads the same `~/.pi/agent/` the Pi CLI uses, plus the vault's `.pi/`.

| Belongs to | What |
|---|---|
| The learner's Pi | models, credentials, built-in tools (including the shell), skills, extensions, MCP, `AGENTS.md`, project trust |
| ICAP's tools | `ask_learner`, `create_note`, `propose_edit`, the vault tools, `read_document`, `documents` |
| ICAP's protocol | appended to the learner's system prompt: the learning rules, never rewriting the learner's answer, preferring `propose_edit` for existing notes, the evidence guide below |
| The plugin | rendering, blocks, requests, edit review, file-change records, Activity |

**By default** every task runs with the learner's full Pi setup plus ICAP's tools, with the protocol appended rather than replacing anything. Each fixed action hides the ICAP tools it doesn't need and never restricts the learner's own. This means the agent can edit files without `propose_edit`, and content in the vault can influence it. That is the same position as running Pi in the vault directly, and it is the learner's choice.

**Transparency instead of restriction.** For every task, the plugin records the files the agent creates, changes, deletes or renames, and attributes each change to the task whose agent was running a tool. The plugin records changes; it does not block them.

**Isolated mode**, for predictable behaviour, registers only ICAP's tools and Pi's read-only ones: no shell, no extensions, skills, MCP or prompt templates, no global `AGENTS.md`. The protocol becomes the whole system prompt. Reading is limited to the vault and the folders the learner allows. The vault's own `AGENTS.md` still loads, because it belongs to the vault, not to the learner's Pi.

**Credentials stay with Pi.** Login (OAuth or API key) goes through Pi and is stored in Pi's `auth.json`; keys exported in the shell are found even when Obsidian is launched from the Dock. The model list shows only models with credentials, and probing it sends no prompt and costs nothing.

### Knowledge comes from the vault, on demand

There is no import step and no separate source library. The vault is the source. Finding knowledge is something the agent does while working, not a stage the learner starts: before explaining a term, it might check the term's backlinks and whether the learner has written about it. Nothing scans the whole vault, and there is no vector database or knowledge graph.

ICAP adds what an agent can't easily get right on its own, which is Obsidian's semantics:

- the read-only `obsidian` tool: search with Obsidian's operators, read, links and backlinks, outline, properties, aliases, tags, files
- `read_document`: a PDF, EPUB or Word document as a tree of numbered parts with page or section ranges (after PageIndex): the structure first, then one part or a page range, cited as `[[book.pdf#page=12]]`
- `documents`: every document the agent may read, with its chapters (and summaries when they are on), and search across their text

These are capabilities, not a required procedure.

**Many documents, read like a person reads them.** The agent opens a book's table of contents and reads the chapters it needs, instead of retrieving fragments by similarity. A document's structure comes from its bookmarks, its EPUB table of contents or its Word heading styles; a PDF without bookmarks gets it from its layout: body size is the most common one, headings are larger, or bold and set apart, or numbered, and size, weight, capitals and numbering rank them into levels. No model is involved, so preparing documents costs nothing and runs in the background. Summaries per part are the one thing that needs a model, so they are a setting, off by default; whether they are worth their tokens is the learner's call.

The structure and text are cached in the vault's visible `icap/docs/` (FORMAT.md, "Document cache"), keyed by content, so every device and every task reads a document once. It is visible, not a dot-folder, because Obsidian Sync skips dot-folders.

### Calibration: the evidence is in the notes

The same explanation that helps a beginner burdens an expert (the expertise reversal effect). Vault contents are only a starting clue, so the protocol gives the agent an evidence guide:

| Evidence | What it shows | Strength |
|---|---|---|
| Related material in the vault (textbooks, clippings) | the learner has met the topic | weak |
| The background written in settings | what the learner believes they know | weak |
| Implicit feedback (asking for *deeper* or *plainer*) | whether the depth was right | weak, but accumulates |
| Notes the learner wrote | they may understand parts of it | medium |
| Completed recalls and checks (their words, the verdict, the date) | what they actually understand | strong |

- **Provenance makes this work.** The agent must tell the learner's writing from its own, or it would read its own notes as proof of understanding. ICAP records the minimum: notes from `create_note` carry `generated-by: icap-agent` (the learner can turn this off), kept explanations are `gloss` callouts, and kept recalls carry `feedback` and `practice`.
- **The learning record is the notes.** There is no hidden learner model; the evidence is Markdown the learner can read, edit and delete. A kept recall, check or quiz says when it was kept and how it went, in its callout title and in a comment above it (FORMAT.md), so the record carries its own dates without the plugin's data.
- **Calibration stays local** to a concept or a note. There is no global level and no long-term knowledge tracing.
- **Diagnosis stays light.** The explanation always comes first. Only when evidence is missing and levels would differ a lot does the agent offer a fork, such as "if you already know X, start from Y". At first, with no recall evidence, explanations are more generic; implicit feedback and forks move past that quickly.

### Preferences and conventions

- **Learning preferences** live in ICAP's settings: background, how the learner likes to learn (language, style, depth), and where new notes go. They are separate from any `AGENTS.md` the learner wrote for other agents.
- **This vault's conventions.** Most learners don't know what an `AGENTS.md` is, so the wizard never says the word. It asks what the vault is for (a course, books, research, a language, programming, or blank), the topic, where the sources are, and which folders are off limits. Each choice brings a preset: how notes are organised and how the agent behaves here (for example, hints before solutions, and never writing the learner's reflections). It also adds general rules: look for an existing note before creating one, link only to notes that exist, never invent a source. The learner edits a preview, and the result is written to the vault root as an ordinary note. The wizard never overwrites an existing file.
- **Context files stop at the vault.** The Pi CLI collects `AGENTS.md` files from every parent directory. ICAP loads only Pi's global one and those inside the vault, because a parent directory's file (`~/AGENTS.md`, a repository the vault sits in) was written for other work.
- **Language.** The interface follows Obsidian's language, English or Chinese, including the guide. Markers written into notes stay English (callout types, `kind:`, `generated-by`, the *Plainly.* / *Deeper.* headings), so switching languages never breaks existing notes. Labels written for people in kept records follow the interface.

## 6. Interactive visuals

Sometimes a slider teaches more than a paragraph. The agent may put a hands-on visual in a reply or in a note it creates, never into a note that already exists: `propose_edit` refuses an edit that adds one, and tells the agent to answer with it instead. The approach follows ChatGPT's in-answer UI and the MCP Apps sandbox model, bounded by ICAP's own skill and actions.

- **Format.** An ```` ```icap-ui ```` fence holding an HTML fragment with inline CSS and JS. It is ordinary Markdown: it survives keeping and uninstalling, and stays readable as code.
- **When.** The setting offers *When it helps* (the default: adjustable parameters, step-through processes, predict-then-reveal exercises, never decoration), *Only when I ask*, and *Never*. The agent reads the `icap-visual` skill before writing one. Visuals never stand in for an explanation, feedback, a question or an edit.
- **Sandbox.** The iframe has `sandbox="allow-scripts"` without same-origin, so it can't reach the note, Obsidian, Node or storage. Its CSP is `default-src 'none'`: no network, no external scripts, fonts or images. The theme arrives as CSS variables, with built-in controls that match Obsidian and update live. Height follows content, and script errors show as one line beneath the visual.
- **Two actions only.** `icap.ask(text)` sends one message back as the learner's next turn: a follow-up in a request block, or a new request block below the visual in a note. `icap.open("Note")` opens an existing note. Both work only after the learner has clicked the visual, so a visual can never spend tokens on load or on a timer.
- **While streaming**, a visual shows as "drawing a visual…" and renders only when the reply is complete.

## 7. Design language

- **Two voices.** The *learner voice* is the note's body text: answers are typed on a borderless writing line in `--font-text` at body size and kept as plain paragraphs. The *agent voice* sits in the same column at about 0.95em, with a 1.5px ink rule in the left gutter and a small-caps label (`gloss · RAII`, `question`, `note`). There is no card, fill or avatar.
- **One ink.** The plugin's identity is a single annotation colour, a warm madder like a tutor's pencil, derived per theme from Obsidian's variables (lighter in dark mode). It is used only for the ink rule, the explained-term underline, marks on choices and verdict glyphs. Everything else is inherited, so community themes keep working. A setting switches the ink to the theme accent.
- **Verdicts without shame.** Feedback marks are glyphs in the gutter, not red and green: `✓ holds`, `≈ partly`, `? reconsider`. An error is framed as something to look at again.
- **State is a sentence, not a badge.** A block ends with a caption in the interface font, such as "waiting for your answer · ⌘↵ to submit" or "reading your answer…". There are no status pills. Phases describe the learner's material, never tools or models. A shortcut in a caption or hint is drawn as keycaps for the platform (⌘ ↵ on macOS, Ctrl ↵ elsewhere), never spelled out in words.
- **Waiting is the ink being drawn.** While the agent works, the ink rule draws down the gutter in a slow loop: a gradient, not a spinner or a glow. With reduced motion it is simply dashed.
- **Choices are marked like paper.** Options are a lettered list. Choosing draws an ink ring around the letter (single choice) or a tick (multiple).

## 8. Motion: ink and paper

Motion is part of the interaction, not decoration. It says *who* is writing, *where* something belongs and *what just changed*. Every component uses the same tokens, defined in `src/ui/motion.ts` with [Motion](https://motion.dev):

| Token | Spring | Used for |
|---|---|---|
| `settle` | critically damped, ~0.4 s | content arriving, the page making room, panels |
| `hand` | ~0.34 s, bounce 0.22 | the learner's marks: rings and ticks, the verdict stamp, the status dot |
| `quick` | ~0.2 s | captions, presses, small swaps |
| `leave` / `fade` | faster than arriving | dismissing, folding, closing |

1. **Ink before words.** An agent passage arrives the way a tutor annotates. The ink rule is drawn down the gutter, then the label and paragraphs settle in beneath it. A verdict glyph is stamped into the margin. Streaming keeps finished paragraphs in place, so only the growing tail changes.
2. **The page makes room.** Inserting, streaming, follow-ups, folding and removal all glide the note below; nothing jumps or wobbles. An interrupted change retargets from the current height.
3. **The learner's marks are hand-drawn and reversible.** A choice draws a ring or a tick, and changing your mind erases it from wherever the pen is. On submit the list locks in place: the chosen option keeps its ring and the others recede. Question, choice, submit and feedback form one continuous surface.
4. **Leaving retreats into the ink.** On dismiss, the words fade, the rule retracts and the gap closes. On keep, the callout is carried from where the gloss stood, so the explanation never appears to leave. Applying an edit folds the removed lines away and leaves the added ones, which are simply the note now.
5. **Activity is continuous with the work.** The ledger rises out of the status-bar mark and sinks back into it. A finished task's tick is drawn once. Nothing breathes or glows, and the only loop is the working indicator.

**Where to look next.** Micro-motion stays quiet. The moments that hand attention back to the learner are marked deliberately, each once:

| Moment | What the learner sees |
|---|---|
| A passage is finished | the ink rule is pressed once, a wider stroke that fades back; the next steps settle in and the primary one is underlined |
| The agent hands over the turn | the question is pressed and the answer surface rises after it |
| It happens off screen | an edge cue ("↓ your turn", "↑ explanation ready") nudges once; clicking it goes there and focuses the answer |
| Something is written into the note | a highlighter wash over the new text, fading within ~3 s |

The plugin takes the keyboard only when the learner is already at the interaction. If it is off screen the learner may be writing elsewhere, so focus and scroll are left alone and the cue does the pointing.

## 9. The guide

On first install the plugin creates and opens *Learning with ICAP* (*用 ICAP 学习* with a Chinese interface). It is not a welcome page. Its subject is ICAP itself, and each step has the learner do that kind of engagement on that subject:

1. **Explanation:** select *scaffolding* and explain it; keep it as a callout.
2. **Interaction:** an authored question; the agent responds without giving away a wrong answer, then asks one or two more.
3. **Recall and feedback:** explain *constructive vs. interactive* from memory under the veil, then *write it up*.
4. **Activity:** the agent writes a concept note on ICAP and proposes linking it; Activity shows the task and both notes.
5. **Request:** for anything else, *Ask the agent here*, with `[[` for sources, `/` for commands and visuals.

Steps 2–4 are **authored blocks**: ```` ```icap-ask ```` fences with `authored: yes` that come alive the first time they render. Anyone can write them into their own notes:

````markdown
```icap-ask
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

*Start over* resets an authored block in place, and *keep* turns it into the learner's Markdown like any other block. Afterwards the guide is simply the learner's first study note.

## 10. Non-goals

These are outside the product by design:

- a persistent chat panel or conversational workspace
- importing sources into a separate library, scanning the whole vault, vector databases, automatic knowledge graphs
- a hidden learner model, global knowledge scores, long-term knowledge tracing
- automatic spaced-repetition scheduling
- the agent generating study tasks unprompted across the vault
- visible multi-agent orchestration
- course management or LMS features
- replacing Obsidian's editor
