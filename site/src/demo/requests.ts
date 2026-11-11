/**
 * What the request-block demonstrations say, in both languages: the learner's requests, played back,
 * and the agent's replies. The same note about lift as the other demos (content.ts).
 */
import type { AskBlock } from "@plugin/runtime/state.svelte";
import type { RunUsage } from "@plugin/agent/usage";
import { L } from "@plugin/i18n";
import type { RequestReply, RequestScript } from "./runtime.svelte";
import type { Steps } from "./player";
import { note, type Lang } from "./content";

export type RequestDemoKind = "request" | "documents" | "visuals";

const pick = <T,>(lang: Lang, en: T, zh: T) => (lang === "zh" ? zh : en);

/** The vault the demos run in, most recent first (what `[[` and `@` offer). */
export const vaultFiles = (lang: Lang) =>
	pick(lang, ["Lift.md", "Bernoulli's principle.md", "Wing.pdf", "Learning with ICAP.md"], ["升力.md", "伯努利原理.md", "机翼.pdf", "用 ICAP 学习.md"]);

/** A round's cost, for the block's usage line. */
const usage = (input: number, output: number, cacheRead: number, cost: number): RunUsage => ({ input, output, cacheRead, cacheWrite: 0, cost, costKnown: true, billed: false });

/** The paragraph the agent proposes to add to the note in the request demo. */
export const addedParagraph = (lang: Lang) =>
	pick(
		lang,
		"[[Bernoulli's principle]] describes the same flow from the side of pressure: the air over the upper surface moves faster, so its pressure is lower than below the wing.",
		"[[伯努利原理]]从压强的角度描述同一股气流：上表面的空气流得更快，所以压强比机翼下方低。",
	);

/* ───────────── the interactive visual of the visuals demo ───────────── */

export const visualAsk = (lang: Lang) => pick(lang, "Why does the lift fall past 15°?", "为什么超过 15° 后升力会下降？");

/**
 * An ```icap-ui visual as the agent writes one: a slider, a curve and one button that asks back. The
 * last listener is for this site only: the demo's player moves the slider and presses the button.
 */
function visual(lang: Lang): string {
	const label = pick(lang, "Angle of attack", "迎角");
	const lift = pick(lang, "lift", "升力");
	const stall = pick(lang, "stall", "失速");
	return `\`\`\`icap-ui
<div class="aoa">
  <label>${label} <input id="a" type="range" min="0" max="20" step="0.5" value="4"> <b id="v"></b></label>
  <svg viewBox="0 0 300 120" role="img" aria-label="${lift}">
    <line x1="20" y1="105" x2="290" y2="105" stroke="var(--background-modifier-border)"/>
    <line x1="215" y1="10" x2="215" y2="105" stroke="var(--background-modifier-border)" stroke-dasharray="3 3"/>
    <text x="219" y="20" font-size="10" class="muted">${stall}</text>
    <text x="22" y="18" font-size="10">${lift}</text>
    <path id="c" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/>
    <circle id="d" r="5"/>
  </svg>
  <button id="ask">${visualAsk(lang)}</button>
</div>
<style>.aoa label{display:flex;align-items:center;gap:8px}.aoa svg{display:block;width:100%;max-width:420px;margin:6px 0}</style>
<script>
var a = document.getElementById("a"), v = document.getElementById("v"), d = document.getElementById("d");
function lift(x) { return x <= 15 ? x / 15 : Math.max(0.35, 1 - (x - 15) * 0.13); }
function X(x) { return 20 + x * 13; }
function Y(x) { return 105 - lift(x) * 85; }
var p = "";
for (var x = 0; x <= 20; x += 0.5) p += (p ? "L" : "M") + X(x) + " " + Y(x);
document.getElementById("c").setAttribute("d", p);
function draw() {
  var x = Number(a.value);
  v.textContent = x + "°";
  d.setAttribute("cx", X(x));
  d.setAttribute("cy", Y(x));
  d.setAttribute("fill", icap.color(x > 15 ? "color-red" : "interactive-accent"));
}
a.addEventListener("input", draw);
draw();
document.getElementById("ask").addEventListener("click", function () { icap.ask(${JSON.stringify(visualAsk(lang))}); });
addEventListener("message", function (e) {
  var m = e.data;
  if (e.source !== parent || !m || !m.demo) return;
  if (m.demo === "angle") { a.value = m.value; draw(); }
  if (m.demo === "ask") { document.getElementById("ask").className = "primary"; document.getElementById("ask").click(); }
});
</script>
\`\`\``;
}

/* ───────────── the agent ───────────── */

export function requestScript(lang: Lang, kind: RequestDemoKind): RequestScript {
	const n = note(lang);
	return (_block: AskBlock, _request: string, round: number): RequestReply => {
		if (kind === "request")
			return {
				phases: ["reading", "thinking"],
				review: {
					path: n.path,
					find: n.after,
					replace: `${n.after}\n\n${addedParagraph(lang)}`,
					summary: pick(lang, "Add a paragraph that connects lift with [[Bernoulli's principle]].", "加一段话，把升力和[[伯努利原理]]联系起来。"),
				},
				reply: pick(
					lang,
					"I added one paragraph to [[Lift]]. It links to [[Bernoulli's principle]] and describes lift from the side of pressure. The note now has both views: the air that the wing turns down, and the difference in pressure.",
					"我在[[升力]]中加了一段话。它链接到[[伯努利原理]]，从压强的角度描述升力。现在笔记有两种角度：机翼把空气向下偏转，以及上下的压强差。",
				),
				declined: pick(lang, "I left [[Lift]] as it was.", "[[升力]]保持原样。"),
				usage: usage(4200, 380, 3100, 0.0123),
			};
		if (kind === "documents")
			return {
				phases: ["reading", "reading", "thinking"],
				reply: pick(
					lang,
					"[[Wing.pdf]] explains the stall in chapter 4, *Stall*. On [[Wing.pdf#page=41]], it shows that lift grows with the angle of attack up to about 15°. On [[Wing.pdf#page=42]], it explains that past this angle the air separates from the upper surface, and lift falls.",
					"[[机翼.pdf]]在第 4 章「失速」中解释失速。[[机翼.pdf#page=41]]说明：迎角在约 15° 以内时，升力随迎角增大。[[机翼.pdf#page=42]]说明：超过这个角度，气流从上表面分离，升力下降。",
				),
				usage: usage(9800, 420, 0, 0.0357),
			};
		// visuals: a reply with a visual, then the question the visual sends back
		if (round === 1)
			return {
				phases: ["thinking"],
				reply: pick(lang, "Move the slider and watch the dot on the curve.", "拖动滑块，看曲线上的点。") + "\n\n" + visual(lang) + "\n\n" + pick(lang, "At which angle does the curve turn down?", "曲线在哪个角度开始向下？"),
				usage: usage(3900, 1150, 2800, 0.0231),
			};
		return {
			phases: ["thinking"],
			reply: pick(
				lang,
				"Past about 15°, the air on the upper surface can no longer follow the curve of the wing. It separates from the surface, so the wing turns less air down, and the lift falls. This is a stall.",
				"超过约 15° 后，上表面的气流无法再沿机翼的曲面流动。气流从表面分离，机翼向下偏转的空气变少，升力下降。这就是失速。",
			),
			usage: usage(1200, 140, 4900, 0.0061),
		};
	};
}

/* ───────────── what the learner does, played back ───────────── */

/** What the player needs to see of the block that the writing line and buttons do not show. */
export interface BlockView {
	/** The visual's frame, when one is on screen. */
	frame(): HTMLIFrameElement | null | undefined;
	/** The requests sent so far. */
	requests(): number;
	phase(): string;
}

export function requestMoves(lang: Lang, kind: RequestDemoKind, view: BlockView): (s: Steps) => Promise<void> {
	const frame = () => view.frame();
	const send = L("send", "发送");
	const record = L("keep a record", "保留记录");
	switch (kind) {
		case "request":
			return async (s) => {
				await s.type(pick(lang, "Add a sentence to this note that connects lift with [[Bern", "在这篇笔记里加一句话，把升力和[[伯努"));
				await s.pick(pick(lang, "Bernoulli's principle", "伯努利原理"));
				await s.type(pick(lang, ".", "联系起来。"));
				await s.click(send);
				await s.click(L("apply change", "应用修改"));
				await s.type("/thi");
				await s.pick("/thinking");
				await s.type("high");
				await s.click(send);
				await s.click(record);
			};
		case "documents":
			return async (s) => {
				await s.type(pick(lang, "Where does @Wi", "@机"));
				await s.pick(pick(lang, "Wing.pdf", "机翼.pdf"));
				await s.type(pick(lang, " explain why a wing stalls?", "在哪里解释了机翼为什么会失速？"));
				await s.click(send);
				await s.click(record);
			};
		case "visuals":
			return async (s) => {
				await s.type(pick(lang, "Show me how lift changes with the angle of attack.", "让我看看升力怎样随迎角变化。"));
				await s.click(send);
				// the reply is in, with its visual: move the slider, then ask from inside the visual
				await s.until(() => frame());
				await s.wait(2200);
				for (let a = 4; a <= 18; a += 0.5) {
					frame()?.contentWindow?.postMessage({ demo: "angle", value: a }, "*");
					await s.wait(110);
				}
				await s.wait(1600);
				frame()?.contentWindow?.postMessage({ demo: "ask" }, "*");
				await s.until(() => view.requests() === 2 && view.phase() === "completed", 30_000);
			};
	}
}
