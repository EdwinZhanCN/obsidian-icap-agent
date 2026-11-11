/**
 * ICAP's skills for Obsidian's own structures: Bases, Canvas and Mermaid diagrams. Like the visual
 * skill (visual-skill.ts) they are Pi skill files on desktop (agent/desktop/icap-skills.ts), read when a
 * task needs one, and part of the system prompt on mobile, which has no skills: so they stay short,
 * keeping only what an agent gets wrong. Condensed from kepano/obsidian-skills (MIT) for Bases and
 * Canvas; the Mermaid one follows Pele, the renderer Obsidian uses since 1.15 (pele.run/compatibility).
 */

export interface Skill {
	name: string;
	/** What Pi lists in the system prompt: when to read it. */
	description: string;
	body: string;
}

const FENCE = "```";

export const BASES_SKILL: Skill = {
	name: "icap-bases",
	description: "How to write an Obsidian Base: a live table, card or list view of notes by their properties (a base code block in a note, or a .base file). Read this before writing one.",
	body: `# Bases

A base is a live view of notes by their properties: a table, cards or a list that updates as the notes change. Use one when the learner wants to see many notes side by side (concepts with their status, sources by author, what is still open), not for content a list would hold.

## Where

- In a note: a fenced \`base\` block holding the YAML below. Preferred: it stays next to the text it serves, and \`this\` is that note.
- As its own file: create_note with type "base" and the YAML as content (no fence). A note embeds it with ![[Name.base]] or ![[Name.base#View name]].

## Shape

${FENCE}yaml
filters:                    # which notes: one expression, or and / or / not with a list
  and:
    - file.inFolder("Physics")
    - 'status != "done"'
formulas:
  age: '(now() - file.ctime).days.round(0)'
properties:
  formula.age:
    displayName: "Days"
views:
  - type: table             # table | cards | list
    name: "Open"
    order: [file.name, status, formula.age]
    groupBy: { property: status, direction: ASC }
    summaries: { formula.age: Average }
${FENCE}

## Expressions

- Properties: \`status\` or \`note.status\` (from the note's properties), \`file.name\`, \`file.folder\`, \`file.tags\`, \`file.links\`, \`file.backlinks\`, \`file.mtime\`, \`formula.name\`.
- Functions: file.hasTag("t"), file.inFolder("F"), file.hasLink("Note"), file.hasProperty("p"), list.contains(x), if(test, a, b), date("2026-01-31"), today(), now(). Operators: == != > < >= <= && || !.
- A property name with a hyphen is note["my-prop"] in a filter or formula (a bare my-prop subtracts); in order, groupBy and properties it is note.my-prop.
- Date minus date is a duration: take .days (a fraction) before any number function, (date(due) - today()).days.round(0).
- A property may be missing on some notes: guard it, if(due, (date(due) - today()).days, "").
- Summaries: Sum, Average, Min, Max, Median, Earliest, Latest, Checked, Filled, Unique.

## Before you write it

- Use properties the notes really have: look at a few of them first.
- Quote every expression; when it contains double quotes, wrap it in single quotes: 'if(done, "yes", "no")'.
- Every formula.name you list must be defined under formulas.`,
};

export const CANVAS_SKILL: Skill = {
	name: "icap-canvas",
	description: "How to make an Obsidian canvas (.canvas, JSON Canvas 1.0): a board of cards, notes and links joined by arrows, for a concept map the learner arranges. Read this before creating or changing one.",
	body: `# Canvases

A canvas is a board the learner arranges: text cards, notes and links placed in space and joined by arrows. Use one for a concept map the learner will keep working on, or to lay several notes side by side. A picture that only needs reading is simpler as a Mermaid diagram.

## Create

create_note with type "canvas"; the content is JSON: {"nodes": [...], "edges": [...]}.

Every node has id, type, x, y, width, height, and may have color ("1" red to "6" purple). By type:
- text: "text", Markdown; a new line is \\n in the JSON string (never an escaped \\\\n).
- file: "file", a vault path ("Physics/Momentum.md"), and may have "subpath": "#Heading". For a note that exists, prefer a file node: the canvas shows the note itself.
- link: "url".
- group: "label"; place its members inside its box.

An edge has id, fromNode, toNode, and may have fromSide / toSide (top, right, bottom, left), toEnd ("arrow" by default, or "none") and label.

## Layout

x grows to the right, y downwards; a node's x and y are its top-left corner. A short text card is about 260 × 120, a note 400 × 300. Leave 60 to 100 between cards and align to a grid of 20. Lay out by meaning: a centre with spokes for a concept map, left to right for a process, columns for a comparison.

## Before you send it

Ids are unique (16 hex characters), every edge's fromNode and toNode is a node of this canvas, and the JSON parses. create_note refuses a canvas that breaks these, and says why.

## Change one

propose_edit on the .canvas file: find an exact piece of its JSON and replace it so that the whole stays valid.`,
};

export const MERMAID_SKILL: Skill = {
	name: "icap-mermaid",
	description: "How to draw a diagram in a note with a mermaid block (flowchart, sequence, state, mind map, timeline, chart) as Obsidian renders it (Pele, Mermaid 12.1 syntax). Read this before writing one.",
	body: `# Diagrams

Obsidian draws a fenced \`mermaid\` block as a diagram (with Pele, which reads Mermaid 12.1 syntax). Use one when a structure is clearer seen than read: a process or a cycle, causes and effects, a hierarchy, states, events in order, parts of a whole. Not for decoration, and not when three sentences say the same.

## Where

In a reply to a request, in a note you create, or added to a note through propose_edit, as an ordinary fenced block:

${FENCE}mermaid
flowchart LR
  A[Guess] --> B{Small enough?}
  B -->|no| C[Step downhill] --> A
  B -->|yes| D[Stop]
${FENCE}

## Choose the type

flowchart (a process, causes), sequenceDiagram (who does what, in order), stateDiagram-v2 (states and transitions), classDiagram or erDiagram (structure), mindmap (a topic's parts), timeline (events in order), quadrantChart, pie, xychart (numbers). Every type built into Mermaid 12.1 works; ZenUML and other plugin types do not.

## Pele's rules

- Colours and fonts come from the learner's theme. Do not set themes, %%{init}%% colours, classDef or style.
- Labels are text: a line break is <br>. No HTML and no $math$ (it shows as TeX source).
- Quote a label that has brackets, colons, quotes or commas: A["Newton's second law: F = ma"].
- To link a node to a note, make its label the note's exact name and give it the class internal-link: B[Momentum], then a line class B internal-link. Only for notes that exist.
- click can only open a URL; JavaScript callbacks are ignored.
- Keep it small, about 15 nodes at most. Split a bigger picture into two diagrams, or make a canvas.
- Labels in the note's language; node ids short and ASCII (A, B, loss).`,
};

/** The structure skills, in the order the prompt lists them. */
export const STRUCTURE_SKILLS: Skill[] = [MERMAID_SKILL, CANVAS_SKILL, BASES_SKILL];

/** The skill as a Pi SKILL.md file. */
export function skillFile(s: Skill): string {
	return `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}\n`;
}
