import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { MAX_ASK, THEME_VARS, UI_LANG } from "../../genui/widget";
import { VISUAL_SKILL } from "../prompts";

/**
 * ICAP's own Pi skills. They ship inside main.js and are written to the plugin's folder (inside the
 * vault, so the agent can read them in isolated mode too); Pi lists them in the system prompt and the
 * agent reads one when its task needs it. Skills are instructions only: what a visual can actually do
 * is enforced by the sandbox (genui/).
 */

export { VISUAL_SKILL };

const FENCE = "```";

export function visualSkill(): string {
	const vars = THEME_VARS.map((v) => `--${v}`).join(", ");
	return `---
name: ${VISUAL_SKILL}
description: How to write an interactive visual (a ${FENCE}${UI_LANG} block) in a reply or a note — format, theme, sandbox limits and the only two actions it can take (icap.ask, icap.open). Read this before writing an ${UI_LANG} block.
---

# Interactive visuals (${UI_LANG})

An ${UI_LANG} block is a self-contained HTML fragment that ICAP renders inside the learner's note, in a sandboxed frame. It stays in the note as ordinary Markdown (a fenced block), so it renders again whenever the note is opened.

## Where

- In a request: in your reply. In a note you create with create_note: in its body.
- Never through propose_edit. An edit to a note that already exists cannot add a visual and is refused.

## When

- Only where the learner can *do* something that builds understanding: vary a parameter and watch the effect, step through a process, explore a structure, sort or choose and then check. A picture that only displays is rarely worth it — prefer prose, a table, or a Mermaid diagram.
- Make the learner think first: ask for a prediction, then let them reveal or try it. Never do the reasoning for them.
- One idea per visual, at most one visual per reply unless the learner asked for more. Put a sentence of prose before it saying what to try.

## Format

${FENCE}${UI_LANG}
<div class="row"><label>…</label></div>
<svg viewBox="0 0 320 160" width="100%">…</svg>
<style>/* scoped to this visual */</style>
<script>/* plain JavaScript */</script>
${FENCE}

- A fragment: no <html>, <head>, <body> or <!doctype>.
- Everything inline. External scripts, stylesheets, fonts, images and any network request are blocked — there is no internet in the sandbox. No libraries are available: plain JavaScript, inline SVG or <canvas>. Images only as inline SVG or data: URLs.
- Keep it under about 150 lines. Text in the visual is in the learner's language. Label axes and units. No emoji, no decoration.
- Width is the note's (320–750 px): use viewBox with width="100%", or flexible layouts. The height follows the content automatically: do not use vh units or fixed heights over 600 px.
- Nothing is saved: the visual starts fresh every time the note opens. Do not use localStorage, cookies or forms.

## Theme

The note's theme is available as CSS variables: ${vars}. Use them instead of fixed colours, so the visual works in light and dark themes. The background is transparent: the note shows through.

Buttons, inputs, selects and range sliders are already styled like Obsidian; add class="primary" to the main button. The class "muted" gives secondary text. In JavaScript, \`icap.dark\` tells whether the theme is dark and \`icap.color("text-normal")\` reads a variable (for <canvas>). When the learner switches theme, the variables change and an "icap-theme" event fires on window: redraw a canvas then.

## Actions

The sandbox cannot reach the note, the vault, Obsidian or the internet. It can do exactly two things, through the built-in \`icap\` object:

- \`icap.ask(text)\` — sends the text to you as the learner's next message: in a request block as a follow-up, in a note as a new request just below the visual. Use it for "explain this step", "quiz me on this", "my prediction was …". The text must stand on its own (at most ${MAX_ASK} characters). It only works from the learner's click or keypress — never call it on load or on a timer.
- \`icap.open("Note name")\` — opens a note of the vault, like a [[link]]. Only for notes that exist.

## Example

${FENCE}${UI_LANG}
<p>Predict first: with step size α = 1.05, does gradient descent on f(x) = x² reach the minimum? Then drag.</p>
<div class="row"><label>α <input id="a" type="range" min="0.05" max="1.1" step="0.05" value="0.3"></label> <b id="av"></b> <span id="msg" class="muted"></span></div>
<svg id="plot" viewBox="0 0 320 170" width="100%" role="img" aria-label="f(x) = x² and the steps of gradient descent"></svg>
<button id="why">Why does it stop converging?</button>
<style>
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#plot .curve{fill:none;stroke:var(--text-faint)}
#plot .steps{fill:none;stroke:var(--interactive-accent)}
#plot circle{fill:var(--interactive-accent)}
</style>
<script>
const svg = document.getElementById("plot"), a = document.getElementById("a");
const X = (x) => 160 + x * 60, Y = (y) => 160 - y * 22;
function draw() {
  const alpha = +a.value;
  document.getElementById("av").textContent = alpha.toFixed(2);
  let curve = "";
  for (let x = -2.5; x <= 2.5; x += 0.05) curve += (curve ? "L" : "M") + X(x) + " " + Y(x * x);
  let x = 2, steps = "M" + X(x) + " " + Y(x * x), dots = "";
  for (let k = 0; k < 8 && Math.abs(x) < 2.6; k++) {
    x -= alpha * 2 * x;
    steps += "L" + X(x) + " " + Y(x * x);
    dots += '<circle cx="' + X(x) + '" cy="' + Y(x * x) + '" r="3"/>';
  }
  svg.innerHTML = '<path class="curve" d="' + curve + '"/><path class="steps" d="' + steps + '"/>' + dots;
  document.getElementById("msg").textContent = alpha < 1 ? "converges to x = 0" : alpha === 1 ? "bounces between ±2" : "overshoots: |x| grows";
}
a.oninput = draw;
draw();
document.getElementById("why").onclick = () => icap.ask("Why does gradient descent on x² stop converging once the step size α reaches 1?");
</script>
${FENCE}
`;
}

/** Write ICAP's skills under the plugin folder (when they changed) and return their folders for Pi. */
export function ensureSkills(pluginDir: string): string[] {
	const dir = join(pluginDir, "skills", VISUAL_SKILL);
	const file = join(dir, "SKILL.md");
	const want = visualSkill();
	let have = "";
	try {
		have = readFileSync(file, "utf8");
	} catch {
		/* not written yet */
	}
	if (have !== want) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, want);
	}
	return [dir];
}
