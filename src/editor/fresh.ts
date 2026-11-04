import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * "What just changed in my note": text the runtime writes into a note (a kept explanation, the
 * learner's final words, an applied edit) is washed with ink for a moment and then fades —
 * a highlighter pass, not a glow. Inline text gets a mark decoration; rendered blocks in the
 * range (callouts in Live Preview are widgets) get the same wash on their element.
 */

const add = StateEffect.define<{ id: number; from: number; to: number }>();
const drop = StateEffect.define<number>();

export const freshField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(add)) {
				const ranges: Range<Decoration>[] = [];
				// One mark per line keeps the wash off blank lines.
				let pos = e.value.from;
				for (const line of tr.state.doc.sliceString(e.value.from, e.value.to).split("\n")) {
					const start = pos + (line.length - line.trimStart().length);
					const end = pos + line.trimEnd().length;
					if (end > start) ranges.push(Decoration.mark({ class: "icpa-fresh", id: e.value.id }).range(start, end));
					pos += line.length + 1;
				}
				deco = deco.update({ add: ranges, sort: true });
			} else if (e.is(drop)) {
				const id = e.value;
				deco = deco.update({ filter: (_f, _t, v) => v.spec.id !== id });
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

let seq = 0;
const HOLD = 3400;

export function flashRange(view: EditorView, from: number, to: number) {
	if (!view.dom.isConnected || to <= from) return;
	const id = ++seq;
	view.dispatch({ effects: add.of({ id, from, to: Math.min(to, view.state.doc.length) }) });
	// Rendered blocks (callouts, embeds) whose source lies in the range.
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			for (const el of Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-embed-block"))) {
				let pos: number;
				try {
					pos = view.posAtDOM(el);
				} catch {
					continue;
				}
				if (pos < from || pos > to) continue;
				el.classList.remove("icpa-fresh-block");
				void el.offsetWidth; // restart the fade
				el.classList.add("icpa-fresh-block");
				window.setTimeout(() => el.classList.remove("icpa-fresh-block"), HOLD);
			}
		}),
	);
	window.setTimeout(() => {
		if (view.dom.isConnected) view.dispatch({ effects: drop.of(id) });
	}, HOLD);
}
