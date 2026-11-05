/**
 * Take the keyboard only when the learner is already there. If the interaction this element
 * belongs to is entirely off screen, the learner is reading or writing elsewhere: leave their
 * focus and scroll alone — the edge cue (editor/cue.ts) points the way instead.
 */
export function focusIfNear(el: HTMLElement | null | undefined): boolean {
	if (!el) return false;
	const scroller = el.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
	const host = el.closest<HTMLElement>(".icap-ask, .icap-gloss, .cm-embed-block") ?? el;
	if (scroller) {
		const v = scroller.getBoundingClientRect();
		const r = host.getBoundingClientRect();
		if (r.bottom < v.top || r.top > v.bottom) return false;
	}
	el.focus();
	return true;
}
