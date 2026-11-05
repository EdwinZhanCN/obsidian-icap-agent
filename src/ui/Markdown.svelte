<script lang="ts">
	import { Component, Keymap, MarkdownRenderer, type App } from "obsidian";
	import { onDestroy } from "svelte";
	import { balanceStreamingMarkdown } from "../dsl/text";
	import { veilWidgets } from "../genui/widget";
	import { L } from "../i18n";

	interface Props {
		app: App;
		markdown: string;
		sourcePath: string;
		streaming?: boolean;
		class?: string;
	}
	let { app, markdown, sourcePath, streaming = false, class: cls = "" }: Props = $props();

	let el: HTMLDivElement;
	let owner: Component | null = null;
	/** Components whose output is still partly on screen during streaming. */
	const retired: Component[] = [];
	let timer: number | null = null;
	let rendering = false;
	let queued: string | null = null;
	let lastRendered = "";

	async function render(md: string) {
		if (rendering) {
			queued = md;
			return;
		}
		rendering = true;
		try {
			const next = new Component();
			next.load();
			const tmp = document.createElement("div");
			await MarkdownRenderer.render(app, md, tmp, sourcePath, next);
			if (!el) return next.unload();
			// Keep height during streaming swaps so the page below does not jump.
			if (streaming) {
				el.style.minHeight = `${el.offsetHeight}px`;
				// Finished paragraphs keep their DOM nodes: only the changed tail is swapped, so what
				// the learner is already reading never re-renders under them.
				const fresh = Array.from(tmp.childNodes);
				const old = Array.from(el.childNodes);
				let k = 0;
				while (k < old.length && k < fresh.length && old[k].isEqualNode(fresh[k])) k++;
				for (let i = old.length - 1; i >= k; i--) old[i].remove();
				el.append(...fresh.slice(k));
				// Old nodes we kept were made by the previous component; keep it alive until the final render.
				if (owner && k > 0) retired.push(owner);
				else owner?.unload();
			} else {
				el.replaceChildren(...Array.from(tmp.childNodes));
				el.style.minHeight = "";
				owner?.unload();
				for (const r of retired.splice(0)) r.unload();
			}
			owner = next;
			lastRendered = md;
		} finally {
			rendering = false;
			if (queued !== null) {
				const q = queued;
				queued = null;
				void render(q);
			}
		}
	}

	/** While streaming, an interactive visual is a placeholder: half a script would only flash errors. */
	const streamed = (md: string) => veilWidgets(balanceStreamingMarkdown(md), L("Drawing a visual…", "正在画图示…"));

	$effect(() => {
		const md = streaming ? streamed(markdown) : markdown;
		if (md === lastRendered) return;
		if (!streaming) {
			if (timer) window.clearTimeout(timer);
			timer = null;
			void render(md);
			return;
		}
		if (timer) return;
		timer = window.setTimeout(() => {
			timer = null;
			void render(streaming ? streamed(markdown) : markdown);
		}, 90);
	});

	onDestroy(() => {
		if (timer) window.clearTimeout(timer);
		owner?.unload();
		for (const r of retired.splice(0)) r.unload();
	});

	function linkTarget(e: Event): HTMLAnchorElement | null {
		const a = (e.target as HTMLElement).closest("a");
		return a instanceof HTMLAnchorElement ? a : null;
	}

	function onclick(e: MouseEvent) {
		const a = linkTarget(e);
		if (!a) return;
		if (a.classList.contains("internal-link")) {
			e.preventDefault();
			const href = a.dataset.href || a.getAttribute("href") || "";
			void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(e));
		} else if (a.classList.contains("tag")) {
			e.preventDefault();
		}
	}

	function onmouseover(e: MouseEvent) {
		const a = linkTarget(e);
		if (!a || !a.classList.contains("internal-link")) return;
		app.workspace.trigger("hover-link", {
			event: e,
			source: "icap-agent",
			hoverParent: { hoverPopover: null },
			targetEl: a,
			linktext: a.dataset.href || a.getAttribute("href") || "",
			sourcePath,
		});
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events, a11y_no_static_element_interactions -->
<div bind:this={el} class="icap-md markdown-rendered {cls}" class:is-streaming={streaming} {onclick} {onmouseover}></div>
