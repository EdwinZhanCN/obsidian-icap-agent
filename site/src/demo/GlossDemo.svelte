<script lang="ts">
	/* The plugin's explanation (src/ui/GlossView.svelte) under a paragraph of the note, played. */
	import { setLocale } from "@plugin/i18n";
	import GlossView from "@plugin/ui/GlossView.svelte";
	import { glossCallout } from "@plugin/dsl/blocks";
	import { Gloss } from "@plugin/runtime/state.svelte";
	import { DemoRuntime } from "./runtime.svelte";
	import { gloss as glossScript, glossMoves, note, type Lang } from "./content";
	import { markdown } from "./markdown";
	import { player } from "./player";
	import Pane from "./Pane.svelte";

	let { lang = "en" }: { lang?: Lang } = $props();
	// svelte-ignore state_referenced_locally
	setLocale(lang);
	// svelte-ignore state_referenced_locally
	const n = note(lang);
	// svelte-ignore state_referenced_locally
	const zh = lang === "zh";
	// svelte-ignore state_referenced_locally
	const rt = new DemoRuntime(glossScript(lang));
	const explainLabel = zh ? "解释" : "explain";

	let g = $state<Gloss | null>(null);
	let root = $state<HTMLElement | null>(null);
	let playing = $state(false);
	const p = player(() => root);

	function explain() {
		g = new Gloss(`g${Date.now()}`, n.path, n.term, 0, 0, 0);
		void rt.runGlossSection(g, "explain");
	}
	function reset() {
		if (g) rt.stopGloss(g);
		g = null;
		rt.notice = "";
	}
	let loops = 0;
	async function loop() {
		const me = ++loops;
		playing = true;
		await p.play(async (s) => {
			for (;;) {
				reset();
				await glossMoves(explainLabel)(s);
				await s.wait(5000);
			}
		});
		if (me === loops) playing = false;
	}
	const play = {
		start: () => void loop(),
		stop: () => p.stop(),
	};
	function again() {
		void loop();
	}
	const kept = $derived(g?.state === "kept" ? glossCallout(g.term, g.fullText, g.sources) : "");
</script>

<Pane path={n.path} {zh} notice={rt.notice} {playing} {play} onrestart={again} bind:el={root}>
		<p>{n.before}</p>
		<p>
			{n.sentence[0]}<span class="icap-demo-term" class:is-selected={!g}>{n.sentence[1]}</span>{n.sentence[2]}
			{#if !g}
				<button type="button" class="icap-link icap-demo-explain" onclick={explain}>{explainLabel}</button>
			{/if}
		</p>
		{#if g && g.state === "open"}
			<div class="icap-demo-widget"><GlossView gloss={g} rt={rt as never} /></div>
		{:else if kept}
			<div class="icap-demo-kept" use:markdown={kept}></div>
		{:else if g?.state === "dismissed"}
			<p class="icap-demo-hint">{zh ? "解释已丢弃，笔记没有改变。" : "The explanation is gone. The note did not change."}</p>
		{/if}
		<p>{n.after}</p>
</Pane>
