/**
 * Motion language — "ink and paper".
 *
 *   1. Ink before words. Agent text arrives the way a tutor annotates: the ink rule is drawn
 *      down the gutter first, then the label, then the words settle in under it.
 *   2. The page makes room. Inserted passages grow in height on a critically damped spring;
 *      the note below glides down, never jumps, and never wobbles (no overshoot in the flow).
 *   3. The learner's marks are hand-drawn. Rings, ticks and verdict glyphs are stroked or
 *      stamped with a little give (a light spring) — the only place anything bounces.
 *   4. Leaving is quicker than arriving, and retreats into the ink: words fade, the rule
 *      retracts, the page closes the gap.
 *
 * Mechanics: only frames animate `height`; everything else animates transform/opacity (or a
 * registered custom property that feeds a transform). Every keyframe list ends at the element's
 * natural state, so with reduced motion we can drop everything but a short opacity fade and the
 * layout is still exactly right. Animations are retargeted from their current value when
 * interrupted, and entrances play once per thing — never again when the editor re-renders it.
 */
import { animate, stagger, type AnimationOptions, type DOMKeyframesDefinition } from "motion";
import { EditorView } from "@codemirror/view";

export const spring = {
	/** Content arriving, the page making room. Critically damped: the document never wobbles. */
	settle: { type: "spring", visualDuration: 0.4, bounce: 0 },
	/** The learner's own marks — a pen's small give. */
	hand: { type: "spring", visualDuration: 0.34, bounce: 0.22 },
	/** Acknowledgements: captions, presses, small swaps. */
	quick: { type: "spring", visualDuration: 0.2, bounce: 0 },
	/** Leaving: faster than arriving. */
	leave: { type: "spring", visualDuration: 0.26, bounce: 0 },
	/** Words stepping aside before the page closes: a short tween, so the next step is not kept waiting. */
	fade: { duration: 0.14, ease: [0.4, 0, 1, 1] },
} satisfies Record<string, AnimationOptions>;

export interface Playback {
	finished: Promise<unknown>;
	stop(): void;
}

const NONE: Playback = { finished: Promise.resolve(), stop() {} };

const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => mq.matches;

/**
 * Run an animation. With reduced motion only opacity survives (as a short linear fade);
 * movement and scale jump to their — natural — final values.
 */
export function play(el: Element | Element[] | null | undefined, kf: DOMKeyframesDefinition, opts: AnimationOptions = spring.settle): Playback {
	if (!el || (Array.isArray(el) && !el.length)) return NONE;
	if (reducedMotion()) {
		if (kf.opacity === undefined) return NONE;
		return animate(el, { opacity: kf.opacity }, { duration: 0.14, ease: "linear" }) as unknown as Playback;
	}
	return animate(el, kf, opts) as unknown as Playback;
}

/* ───────────── once-only entrances ───────────── */

const shown = new Set<string>();

/** True the first time a key is seen; entrances use it so re-renders never replay them. */
export function introduce(key: string | null | undefined): boolean {
	if (!key || shown.has(key)) return false;
	shown.add(key);
	return true;
}

/** Things that already existed when the plugin loaded are not "arriving". */
export function acknowledge(keys: Iterable<string>) {
	for (const k of keys) shown.add(k);
}

/** Run after the element is attached (CodeMirror and Obsidian mount us before insertion). */
function whenAttached(node: Element, fn: () => void, tries = 4) {
	requestAnimationFrame(() => {
		if (node.isConnected || tries <= 0) fn();
		else whenAttached(node, fn, tries - 1);
	});
}

/* ───────────── frames: the page makes room ───────────── */

/** Let the gutter (ink rule, verdict glyphs) show while a frame clips its height. */
const CLIP = "inset(-0.6em -1.5em 0 -4.5em)";

/**
 * A frame follows its single child's height on a spring. Growth (a new turn, streamed text,
 * a follow-up) and shrinkage (a section removed) both glide; an interrupted change is retargeted
 * from the current height. With `key`, the first appearance grows from zero.
 *
 * `node.dataset.fluid = "passive"` makes it follow instantly (used during exits).
 */
export function fluid(node: HTMLElement, key?: string | null) {
	const inner = node.firstElementChild as HTMLElement | null;
	if (!inner) return {};
	let anim: Playback | null = null;
	let target = -1;
	/** The height the page last showed. Without an explicit height the frame has already resized
	 *  by the time the observer runs, so changes are animated from here. */
	let shownHeight = -1;

	const release = () => {
		node.style.height = "";
		node.style.clipPath = "";
		EditorView.findFromDOM(node)?.requestMeasure();
	};

	const go = (to: number) => {
		target = to;
		if (reducedMotion() || node.dataset.fluid === "passive" || !node.isConnected) {
			anim?.stop();
			anim = null;
			release();
			return;
		}
		const from = anim || node.style.height ? node.getBoundingClientRect().height : shownHeight;
		shownHeight = to;
		if (from < 0 || Math.abs(from - to) < 1) {
			if (!anim) release();
			return;
		}
		anim?.stop();
		node.style.clipPath = CLIP;
		const a = play(node, { height: [from, to] }, spring.settle);
		anim = a;
		void a.finished.then(() => {
			if (anim === a) {
				anim = null;
				release();
			}
		});
	};

	if (introduce(key) && !reducedMotion()) {
		node.style.height = "0px";
		node.style.clipPath = CLIP;
		target = 0;
		shownHeight = 0;
	}
	const ro = new ResizeObserver(() => {
		// Detached or not laid out yet (CodeMirror mounts widgets before inserting them): wait.
		if (!node.isConnected) return;
		const h = inner.getBoundingClientRect().height;
		if (h === 0 && target <= 0) return;
		if (Math.abs(h - target) >= 1) go(h);
		else if (!anim) shownHeight = h;
	});
	ro.observe(inner);
	return {
		destroy() {
			ro.disconnect();
			anim?.stop();
		},
	};
}

/** Close a frame to nothing (words fade, rule retracts, gap closes), then resolve. */
export async function closeFrame(frame: HTMLElement | null | undefined, voice?: HTMLElement | null): Promise<void> {
	if (!frame) return;
	frame.dataset.fluid = "passive";
	if (reducedMotion()) {
		await play(frame, { opacity: [1, 0] }).finished;
		return;
	}
	const h = frame.getBoundingClientRect().height;
	frame.style.clipPath = CLIP;
	const kids = voice ? (Array.from(voice.children) as HTMLElement[]) : [];
	play(kids, { opacity: 0 }, spring.fade);
	if (voice) play(voice, { "--icap-rule-scale": 0 } as DOMKeyframesDefinition, spring.leave);
	await play(frame, { height: [h, 0] }, { ...spring.leave, delay: 0.06 }).finished;
}

/* ───────────── ink before words ───────────── */

/**
 * Entrance for an agent-voice passage: the rule draws down the gutter, then the children settle
 * in one after another; a verdict glyph is stamped into the margin. Plays once per key.
 */
export function inkIn(node: HTMLElement, opts: string | { key: string; delay?: number } | null) {
	const key = typeof opts === "string" ? opts : opts?.key;
	const delay = typeof opts === "object" && opts ? (opts.delay ?? 0) : 0;
	if (!introduce(key)) return {};
	const kids = (Array.from(node.children) as HTMLElement[]).filter((k) => !k.classList.contains("icap-verdict"));
	const verdict = node.querySelector<HTMLElement>(":scope > .icap-verdict");
	if (reducedMotion()) {
		play(node, { opacity: [0, 1] });
		return {};
	}
	node.style.setProperty("--icap-rule-scale", "0");
	for (const k of kids) k.style.opacity = "0";
	if (verdict) verdict.style.opacity = "0";
	whenAttached(node, () => {
		const rule = play(node, { "--icap-rule-scale": [0, 1] } as DOMKeyframesDefinition, { ...spring.settle, delay });
		void rule.finished.then(() => node.style.removeProperty("--icap-rule-scale"));
		play(kids, { opacity: [0, 1], y: [5, 0] }, { ...spring.settle, delay: stagger(0.05, { startDelay: delay + 0.08 }) });
		if (verdict) play(verdict, { opacity: [0, 1], scale: [0.35, 1], rotate: [-18, 0] }, { ...spring.hand, delay: delay + 0.2 });
	});
	return {};
}

/** A one-line swap (a caption, a status word): the new text settles up into place. */
export function settleIn(node: HTMLElement, key?: string | null) {
	if (key === null) return {};
	if (key !== undefined && !introduce(key)) return {};
	whenAttached(node, () => play(node, { opacity: [0, 1], y: [3, 0] }, spring.quick));
	return {};
}

/* ───────────── hand-drawn strokes ───────────── */

/**
 * An SVG stroke that is drawn on when `on` becomes true and erased when it becomes false.
 * Reversible mid-stroke; the initial state is set without animation.
 */
export function drawn(path: SVGPathElement, on: boolean) {
	let current: Playback | null = null;
	const set = (v: boolean, animateIt: boolean) => {
		current?.stop();
		if (!animateIt || reducedMotion()) {
			current = animate(path, { pathLength: v ? 1 : 0, opacity: v ? 1 : 0 }, { duration: 0 }) as unknown as Playback;
			return;
		}
		current = v
			? play(path, { pathLength: 1, opacity: 1 }, { pathLength: spring.hand, opacity: { duration: 0.05 } } as AnimationOptions)
			: play(path, { pathLength: 0, opacity: 0 }, { pathLength: spring.quick, opacity: { duration: 0.12, delay: 0.1 } } as AnimationOptions);
	};
	set(on, false);
	return {
		update(next: boolean) {
			set(next, true);
		},
		destroy() {
			current?.stop();
		},
	};
}

/** A stroke drawn once, the first time its key is seen (e.g. a check mark when a task completes). */
export function strokeIn(path: SVGPathElement, key: string) {
	if (!introduce(key) || reducedMotion()) return {};
	path.style.opacity = "0";
	whenAttached(path, () => play(path, { pathLength: [0, 1], opacity: [1, 1] }, { ...spring.hand, delay: 0.12 }));
	return {};
}

/* ───────────── completion: the pen is pressed, then the next step is offered ───────────── */

/**
 * The agent has finished writing a passage: the ink rule is pressed once — darker and wider for
 * a moment, then back to rest. Marks the moment "this is complete" without a glow or a loop.
 */
export function seal(voice: HTMLElement | null | undefined, delay = 0): Playback {
	if (!voice || reducedMotion()) return NONE;
	const a = animate(voice, { "--icap-press": [0, 1, 0] } as DOMKeyframesDefinition, {
		duration: 1.1,
		delay,
		times: [0, 0.22, 1],
		ease: ["easeOut", "easeInOut"],
	}) as unknown as Playback;
	void a.finished.then(() => voice.style.removeProperty("--icap-press"));
	return a;
}

/**
 * Offer the next step: the actions settle in one after another, and the primary action's
 * underline is drawn under it — where to look, and what to do, after the agent is done.
 */
export function beckon(actions: HTMLElement | null | undefined, delay = 0.15) {
	if (!actions) return;
	const kids = Array.from(actions.children) as HTMLElement[];
	play(kids, { opacity: [0, 1], y: [6, 0] }, { ...spring.settle, delay: stagger(0.045, { startDelay: delay }) });
	const primary = actions.querySelector<HTMLElement>(".icap-primary");
	if (!primary || reducedMotion()) return;
	primary.classList.add("is-beckoning");
	primary.style.setProperty("--icap-underline", "0");
	const draw = play(primary, { "--icap-underline": [0, 1] } as DOMKeyframesDefinition, { ...spring.hand, delay: delay + 0.25 });
	void draw.finished.then(() => {
		window.setTimeout(() => {
			primary.classList.remove("is-beckoning");
			primary.style.removeProperty("--icap-underline");
		}, 1600);
	});
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
