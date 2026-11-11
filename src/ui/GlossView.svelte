<script lang="ts">
	import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
	import { L } from "../i18n";
	import { glossLabelUI } from "./phrases";
	import { tick } from "svelte";
	import type { LearningRuntime } from "../runtime/runtime";
	import type { Gloss } from "../runtime/state.svelte";
	import Markdown from "./Markdown.svelte";
	import ExtensionErrors from "./ExtensionErrors.svelte";
	import { phaseLine, stopLabel } from "./phrases";
	import { inertToEditor, keyGuard } from "./keys";
	import { holdHeight } from "./hold-height";
	import { beckon, closeFrame, fluid, inkIn, nextFrame, play, seal, settleIn, spring } from "./motion";

	let { gloss, rt }: { gloss: Gloss; rt: LearningRuntime } = $props();

	let root: HTMLElement;
	let frame: HTMLElement;
	let body = $state<HTMLElement | null>(null);
	let actionsEl: HTMLElement;
	let leaving = false;
	let comparing = $state(false);
	let compareWith = $state("");
	let compareInput = $state<HTMLInputElement | null>(null);

	const busy = $derived(gloss.busy);
	const streamingSection = $derived(gloss.sections.find((s) => s.status === "streaming"));
	const streamingTask = $derived(streamingSection?.taskId ? rt.ledger.get(streamingSection.taskId) : undefined);
	const hasText = $derived(gloss.sections.some((s) => s.status === "done" && s.text.trim()));
	const sources = $derived(gloss.sources);

	// svelte-ignore state_referenced_locally
	let lastToken = gloss.focusToken;
	$effect(() => {
		if (gloss.focusToken !== lastToken) {
			lastToken = gloss.focusToken;
			root?.scrollIntoView({ block: "nearest", behavior: "smooth" });
			root?.focus({ preventScroll: true });
			if (!busy) seal(root, 0.25); // arriving here: mark the passage once more
		}
	});

	/* Completion: when the agent stops writing, the rule is pressed once and the next steps are
	   offered — keep in note gets its underline drawn. */
	// svelte-ignore state_referenced_locally
	let wasBusy = gloss.busy;
	$effect(() => {
		const b = busy;
		const done = hasText;
		if (wasBusy && !b && done && !leaving) {
			void tick().then(() => {
				seal(root);
				beckon(actionsEl, 0.2);
			});
		}
		wasBusy = b;
	});

	/* Folding: the words fade first, then the page closes the gap (the frame follows). Rapid
	   toggles retarget: the latest intent wins. */
	// svelte-ignore state_referenced_locally
	let wantFolded = $state(gloss.collapsed);
	let foldToken = 0;
	async function toggleFold() {
		wantFolded = !wantFolded;
		const token = ++foldToken;
		if (wantFolded) {
			await play(body, { opacity: 0 }, spring.fade).finished;
			if (token === foldToken) gloss.collapsed = true;
		} else if (gloss.collapsed) {
			gloss.collapsed = false;
			await tick();
			play(body, { opacity: [0, 1], y: [-3, 0] }, spring.settle);
		} else {
			play(body, { opacity: 1, y: 0 }, spring.quick);
		}
	}
	$effect(() => {
		if (!gloss.collapsed) wantFolded = false;
	});

	/** Dismiss: words fade, the rule retracts into the gutter, the note closes the gap. */
	async function dismiss() {
		if (leaving) return;
		leaving = true;
		rt.stopGloss(gloss);
		await closeFrame(frame, root);
		rt.dismissGloss(gloss);
	}

	/**
	 * Keep: the gloss becomes a native callout in the same place. The actions fade, the file is
	 * written, and the callout CodeMirror renders is carried from where the gloss stood (FLIP), so
	 * the explanation never appears to leave.
	 */
	async function keep() {
		if (leaving || busy || !hasText) return;
		leaving = true;
		const label = root.querySelector(".icap-label") ?? root;
		const from = label.getBoundingClientRect().top;
		const scroller = frame.closest(".cm-scroller, .markdown-source-view") ?? document;
		const title = gloss.term.replace(/…$/, "");
		await play(actionsEl, { opacity: 0 }, spring.fade).finished;
		await rt.keepGloss(gloss);
		for (let i = 0; i < 8; i++) {
			await nextFrame();
			const candidates = Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="gloss"]')).filter((c) =>
				(c.querySelector(".callout-title-inner")?.textContent ?? "").trim().startsWith(title.slice(0, 40)),
			);
			if (!candidates.length) continue;
			const near = candidates
				.map((c) => ({ c, d: (c.querySelector(".callout-title") ?? c).getBoundingClientRect().top - from }))
				.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
			if (Math.abs(near.d) > 1 && Math.abs(near.d) < 400) play(near.c, { y: [-near.d, 0] }, spring.settle);
			break;
		}
	}

	function follow(mode: "deeper" | "example" | "simpler") {
		gloss.collapsed = false;
		void rt.runGlossSection(gloss, mode);
	}

	async function openCompare() {
		comparing = true;
		await tick();
		compareInput?.focus();
	}

	function submitCompare() {
		const v = compareWith.trim();
		if (!v) return;
		comparing = false;
		compareWith = "";
		gloss.collapsed = false;
		root?.focus({ preventScroll: true }); // the field is about to disappear; keep the keyboard in the gloss
		void rt.runGlossSection(gloss, "compare", v);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.stopPropagation();
			if (comparing) {
				comparing = false;
				root?.focus({ preventScroll: true });
				return;
			}
			rt.app.workspace.activeEditor?.editor?.focus();
		}
	}
</script>

<div class="icap-frame" bind:this={frame} use:fluid={`gh:${gloss.id}`}>
<div class="icap-gloss-pad">
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	bind:this={root}
	use:inertToEditor
	use:inkIn={`g:${gloss.id}`}
	class="icap-voice icap-gloss"
	class:is-drawing={busy}
	class:is-collapsed={gloss.collapsed}
	aria-label={L(`Explanation of ${gloss.term}`, `“${gloss.term}”的解释`)}
	aria-busy={busy}
	tabindex="-1"
	{onkeydown}
>
	<header class="icap-label">
		<button
			type="button"
			class="icap-label-btn"
			aria-expanded={!wantFolded}
			title={wantFolded ? L("Expand", "展开") : L("Fold", "折叠")}
			onclick={toggleFold}
		>
			<span class="icap-label-kind">{L("gloss", "释义")}</span>
			<span class="icap-label-term">{gloss.term}</span>
		</button>
	</header>

	{#if !gloss.collapsed}
		<div class="icap-gloss-body" bind:this={body} use:holdHeight={busy}>
			{#each gloss.sections as s, i (s.id)}
				<div class="icap-gloss-part" class:is-follow={i > 0} data-mode={s.mode} use:settleIn={i > 0 ? `sec:${s.id}` : null}>
					{#if i > 0}<div class="icap-sublabel">{s.mode === "compare" ? glossLabelUI("compare", s.label.replace(/^Compared with /, "")) : glossLabelUI(s.mode)}</div>{/if}
					{#if s.text.trim()}
						<Markdown app={rt.app} markdown={s.text} sourcePath={gloss.notePath} streaming={s.status === "streaming"} />
					{:else if s.status === "streaming"}
						<p class="icap-pending" aria-live="polite">{phaseLine(streamingTask?.phase, "explain")}</p>
						<ExtensionErrors errors={streamingTask?.extensionErrors} />
					{/if}
					{#if s.status === "cancelled"}
						<p class="icap-stopped">
							<span>{L("stopped here", "停在这里")}</span>
							<span class="icap-dot" aria-hidden="true">·</span>
							<button type="button" class="icap-link" onclick={() => (s.taskId ? rt.ledger.get(s.taskId)?.retry?.() : undefined)}>{L("write it again", "重新写")}</button>
						</p>
					{/if}
					{#if s.status === "failed"}
						<p class="icap-error" role="alert">
							{s.error ?? L("Something went wrong.", "出了点问题。")}
							<button type="button" class="icap-link" onclick={() => (s.taskId ? rt.ledger.get(s.taskId)?.retry?.() : undefined)}>{L("try again", "重试")}</button>
						</p>
					{/if}
				</div>
			{/each}
			{#if sources.length && !busy}
				<!-- Rendered like the body, so the [[links]] are links: click opens, hover previews. -->
				<Markdown app={rt.app} markdown={`${L("from", "来自")} ${sources.join(", ")}`} sourcePath={gloss.notePath} class="icap-sources" />
			{/if}
		</div>
	{/if}

	<div class="icap-actions" role="toolbar" aria-label={L("Explanation actions", "解释操作")} bind:this={actionsEl}>
		{#if busy}
			{#if streamingSection?.text}<span class="icap-caption" aria-live="polite">{L("writing…", "书写中…")}</span>{/if}
			<button type="button" class="icap-link" onclick={() => rt.stopGloss(gloss)}>{stopLabel(streamingTask?.phase)}</button>
		{:else if comparing}
			<form class="icap-compare" use:keyGuard={{ app: rt.app, submit: submitCompare, escape: () => { comparing = false; root?.focus({ preventScroll: true }); } }} onsubmit={(e) => (e.preventDefault(), submitCompare())}>
				<label for="cmp-{gloss.id}">{L("compare with", "对比")}</label>
				<input
					id="cmp-{gloss.id}"
					bind:this={compareInput}
					bind:value={compareWith}
					placeholder={L("a concept, e.g. garbage collection", "一个概念，例如：垃圾回收")}
					autocomplete="off"
					spellcheck="false"
				/>
				<button type="submit" class="icap-link icap-icon-link" disabled={!compareWith.trim()} aria-label={L("Compare", "对比")} title={L("Compare", "对比")}><CornerDownLeft aria-hidden="true" /></button>
				<button type="button" class="icap-link is-quiet" onclick={() => (comparing = false)}>{L("cancel", "取消")}</button>
			</form>
		{:else}
			{#if hasText}
				<button type="button" class="icap-link icap-primary" onclick={keep} title={L("Write this explanation into the note as a callout", "把这段解释以 callout 形式写入笔记")}>{L("keep in note", "留在笔记里")}</button>
				<span class="icap-dot" aria-hidden="true">·</span>
				<button type="button" class="icap-link" onclick={() => follow("deeper")}>{L("deeper", "更深入")}</button>
				<button type="button" class="icap-link" onclick={() => follow("example")}>{L("example", "举个例子")}</button>
				<button type="button" class="icap-link" onclick={() => follow("simpler")}>{L("plainer", "说浅一点")}</button>
				<button type="button" class="icap-link" onclick={openCompare}>{L("compare…", "对比…")}</button>
				<span class="icap-dot" aria-hidden="true">·</span>
			{/if}
			<button type="button" class="icap-link is-quiet" onclick={dismiss} title={L("Remove — nothing is written to the note", "移除——不会在笔记中留下任何内容")}>{L("dismiss", "丢弃")}</button>
		{/if}
	</div>
</section>
</div>
</div>
