import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { isEvidenceComment } from "../dsl/blocks";

/**
 * The `<!-- icap … -->` line above a kept record is for tools (FORMAT.md); Reading view already hides
 * HTML comments, Live Preview shows them as text. Hide the line in Live Preview too, except while the
 * cursor or a selection touches it, so it can still be edited. The file is unchanged.
 */

function hidden(state: EditorState): DecorationSet {
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;
	const ranges: Range<Decoration>[] = [];
	const doc = state.doc;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (!line.text.startsWith("<!--") || !isEvidenceComment(line.text)) continue;
		if (state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from)) continue;
		ranges.push(Decoration.replace({ block: true }).range(line.from, line.to));
	}
	return Decoration.set(ranges);
}

export const recordComments = StateField.define<DecorationSet>({
	create: hidden,
	update(deco, tr) {
		const mode = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
		return tr.docChanged || tr.selection || mode ? hidden(tr.state) : deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
