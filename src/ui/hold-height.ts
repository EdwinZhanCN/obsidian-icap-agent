/**
 * While `active`, an element may grow but never shrink: the largest height seen is held as
 * min-height. Streaming text and the switch from a "thinking…" line to the first rendered
 * paragraph therefore never make the note below jump upward. Released when `active` ends.
 */
export function holdHeight(node: HTMLElement, active: boolean) {
	let on = active;
	let max = 0;
	const ro = new ResizeObserver(() => {
		if (!on) return;
		const h = node.getBoundingClientRect().height;
		if (h > max) {
			max = h;
			node.style.minHeight = `${max}px`;
		}
	});
	ro.observe(node);
	return {
		update(next: boolean) {
			on = next;
			if (!on) {
				max = 0;
				node.style.minHeight = "";
			}
		},
		destroy() {
			ro.disconnect();
		},
	};
}
