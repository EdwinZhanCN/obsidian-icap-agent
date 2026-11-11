import type { EditorView } from "@codemirror/view";
import { setIcon } from "obsidian";
import { play, spring } from "../ui/motion";

/**
 * Edge cue: when something needs the learner (a question, a finished explanation, feedback) but
 * it is outside the visible part of the note, a small ink note appears at the top or bottom edge
 * of the editor pointing towards it (an arrow and "your turn"). Clicking it goes there. It disappears by
 * itself as soon as the place scrolls into view; nothing is shown when it is already visible.
 */

export interface CueSpec {
	label: string;
	/** What the cue is about (a block or gloss id), so it can be withdrawn when that is resolved. */
	owner: string;
	/** Current document position of the thing (positions move as the note is edited). */
	pos: () => number | null;
	/** Bring it into view and put the keyboard there. */
	go: () => void;
	/** Done-type cues retire on their own; "your turn" stays until resolved. */
	ttl?: number;
}

interface Live {
	el: HTMLButtonElement;
	spec: CueSpec;
	dir: "up" | "down";
	timer: number | null;
	onScroll: () => void;
}

const live = new Map<EditorView, Live>();
const MARGIN = 56;

/** Where is `pos` relative to what is on screen? null = visible (or unknown). */
function measure(view: EditorView, pos: number): "up" | "down" | null {
	const block = view.lineBlockAt(Math.min(pos, view.state.doc.length));
	const top = view.documentTop + block.top;
	const bottom = view.documentTop + block.bottom;
	const r = view.scrollDOM.getBoundingClientRect();
	if (top > r.bottom - MARGIN) return "down";
	if (bottom < r.top + MARGIN) return "up";
	return null;
}

export function cue(view: EditorView, spec: CueSpec) {
	for (const v of Array.from(live.keys())) if (!v.dom.isConnected) dismissCue(v, false); // closed notes
	view.requestMeasure({
		read: (v) => {
			const p = spec.pos();
			return p === null ? null : measure(v, p);
		},
		write: (dir) => {
			if (!dir) return void dismissCue(view, false);
			show(view, spec, dir);
		},
	});
}

function show(view: EditorView, spec: CueSpec, dir: "up" | "down") {
	const prev = live.get(view);
	const el = prev?.el ?? document.createElement("button");
	el.type = "button";
	el.className = `icap-cue is-${dir}`;
	el.replaceChildren();
	const arrow = el.createSpan({ cls: "icap-cue-arrow" });
	setIcon(arrow, dir === "down" ? "arrow-down" : "arrow-up");
	el.createSpan({ text: spec.label });
	el.setAttribute("aria-label", `${spec.label} — go there`);
	if (!prev) {
		el.addEventListener("mousedown", (e) => e.preventDefault());
		el.addEventListener("click", () => {
			const cur = live.get(view);
			dismissCue(view, true);
			cur?.spec.go();
		});
		view.dom.appendChild(el);
	}
	if (prev?.timer) window.clearTimeout(prev.timer);
	if (prev) view.scrollDOM.removeEventListener("scroll", prev.onScroll);

	let frame = 0;
	const onScroll = () => {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			const cur = live.get(view);
			const p = cur?.spec.pos();
			if (!cur || p === null || p === undefined) return;
			const d = measure(view, p);
			if (!d) dismissCue(view, true);
			else if (d !== cur.dir) {
				cur.dir = d;
				el.classList.toggle("is-down", d === "down");
				el.classList.toggle("is-up", d === "up");
				setIcon(arrow, d === "down" ? "arrow-down" : "arrow-up");
			}
		});
	};
	view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
	const timer = spec.ttl ? window.setTimeout(() => dismissCue(view, true), spec.ttl) : null;
	live.set(view, { el, spec, dir, timer, onScroll });

	if (!prev) {
		// Rises from the edge it points to, then nudges once towards the place — no looping.
		play(el, { opacity: [0, 1], y: [dir === "down" ? 12 : -12, 0], scale: [0.94, 1] }, spring.settle);
		play(arrow, { y: dir === "down" ? [0, 4, 0] : [0, -4, 0] }, { duration: 0.6, delay: 0.7, ease: "easeInOut" });
	} else {
		play(el, { scale: [0.96, 1] }, spring.hand);
	}
}

/** The thing was answered, cleared or dismissed: withdraw any cue pointing at it. */
export function withdrawCue(owner: string) {
	for (const [view, cur] of live) if (cur.spec.owner === owner) dismissCue(view, true);
}

/** Plugin unload: remove every cue without animation. */
export function clearCues() {
	for (const view of Array.from(live.keys())) dismissCue(view, false);
	for (const el of Array.from(document.querySelectorAll(".icap-cue"))) el.remove();
}

export function dismissCue(view: EditorView, animated: boolean) {
	const cur = live.get(view);
	if (!cur) return;
	live.delete(view);
	if (cur.timer) window.clearTimeout(cur.timer);
	view.scrollDOM.removeEventListener("scroll", cur.onScroll);
	if (!animated) return void cur.el.remove();
	void play(cur.el, { opacity: 0, y: cur.dir === "down" ? 8 : -8 }, spring.leave).finished.then(() => cur.el.remove());
}
