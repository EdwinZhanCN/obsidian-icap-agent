import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { editorInfoField } from "obsidian";

/**
 * Transient glosses live in the editor, not in the file. They are decorations mapped
 * through edits; nothing touches the Markdown until the learner chooses to keep one.
 */
export interface GlossAnchor {
	id: string;
	anchor: number;
	from: number;
	to: number;
}

export interface GlossHost {
	/** Glosses to restore when a note is (re)opened in an editor. */
	restore(path: string, doc: string): GlossAnchor[];
	/** Remember where a gloss currently sits so it can be restored later. */
	track(a: GlossAnchor): void;
	mount(id: string, el: HTMLElement): () => void;
}

export const addGloss = StateEffect.define<GlossAnchor>();
export const removeGloss = StateEffect.define<string>();

class GlossWidget extends WidgetType {
	private unmount: (() => void) | null = null;
	constructor(
		readonly id: string,
		private host: GlossHost,
	) {
		super();
	}
	eq(other: GlossWidget) {
		return other.id === this.id;
	}
	toDOM() {
		const el = document.createElement("div");
		el.className = "icpa-gloss-host";
		el.dataset.gloss = this.id;
		this.unmount = this.host.mount(this.id, el);
		return el;
	}
	destroy() {
		this.unmount?.();
		this.unmount = null;
	}
	ignoreEvent() {
		// The gloss handles its own clicks and keys; CodeMirror should not move the cursor.
		return true;
	}
	get estimatedHeight() {
		return 120;
	}
}

function build(anchors: GlossAnchor[], host: GlossHost): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	for (const a of anchors) {
		if (a.to > a.from) ranges.push(Decoration.mark({ class: "icpa-term", attributes: { "data-gloss": a.id } }).range(a.from, a.to));
		ranges.push(Decoration.widget({ widget: new GlossWidget(a.id, host), block: true, side: 1 }).range(a.anchor));
	}
	return Decoration.set(ranges, true);
}

export function glossField(host: GlossHost) {
	const pathOf = (state: EditorState) => state.field(editorInfoField, false)?.file?.path ?? null;

	const field = StateField.define<{ anchors: GlossAnchor[]; deco: DecorationSet }>({
		create(state) {
			const path = pathOf(state);
			const anchors = path ? host.restore(path, state.doc.toString()) : [];
			return { anchors, deco: build(anchors, host) };
		},
		update(value, tr) {
			let anchors = value.anchors;
			let changed = false;
			if (tr.docChanged) {
				const len = tr.state.doc.length;
				anchors = anchors.map((a) => {
					const anchorPos = Math.min(tr.changes.mapPos(a.anchor, 1), len);
					// Keep the widget at the end of its line, even if text was typed at the anchor.
					const anchor = tr.state.doc.lineAt(anchorPos).to;
					return { ...a, anchor, from: tr.changes.mapPos(a.from, 1), to: tr.changes.mapPos(a.to, -1) };
				});
				changed = true;
			}
			for (const e of tr.effects) {
				if (e.is(addGloss)) {
					anchors = [...anchors.filter((a) => a.id !== e.value.id), e.value];
					changed = true;
				} else if (e.is(removeGloss)) {
					anchors = anchors.filter((a) => a.id !== e.value);
					changed = true;
				}
			}
			if (!changed) return value;
			for (const a of anchors) host.track(a);
			return { anchors, deco: build(anchors, host) };
		},
		provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
	});
	return field;
}

export type GlossFieldType = ReturnType<typeof glossField>;

export function anchorsIn(view: EditorView, field: GlossFieldType): GlossAnchor[] {
	return view.state.field(field, false)?.anchors ?? [];
}
