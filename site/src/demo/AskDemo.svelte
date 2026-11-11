<script lang="ts">
	/* The plugin's question block (src/ui/AskView.svelte) in a note: recall, check, quiz, or a question from the agent. */
	import { setLocale } from "@plugin/i18n";
	import AskView from "@plugin/ui/AskView.svelte";
	import { keptMarkdown } from "@plugin/runtime/kept";
	import { AskBlock } from "@plugin/runtime/state.svelte";
	import { newId } from "@plugin/dsl/blocks";
	import { onMount } from "svelte";
	import { DemoRuntime } from "./runtime.svelte";
	import { agentQuestion, authored, collectQuestion, linkedSentence, moves, note, script, type DemoKind, type Lang } from "./content";
	import { player } from "./player";
	import { markdown } from "./markdown";
	import Pane from "./Pane.svelte";

	let { lang = "en", kind }: { lang?: Lang; kind: DemoKind } = $props();
	// svelte-ignore state_referenced_locally
	setLocale(lang);
	// svelte-ignore state_referenced_locally
	const n = note(lang);
	// svelte-ignore state_referenced_locally
	const zh = lang === "zh";
	// svelte-ignore state_referenced_locally
	const rt = new DemoRuntime({}, script(lang, kind));
	// svelte-ignore state_referenced_locally
	const spec = authored(lang, kind);

	let block = $state<AskBlock>(make());
	let host = $state<HTMLElement | null>(null);

	function make(): AskBlock {
		// "collect" is a block the agent opens while it collects a note's key concepts: kind "agent"
		const b = new AskBlock(newId("q"), kind === "collect" ? "agent" : kind, spec.topic, n.path);
		b.authored = kind !== "agent" && kind !== "collect";
		if (spec.first) b.turns = [{ id: newId("u"), ...spec.first }];
		return b;
	}
	/** A check and a question from the agent start on their own; the others wait for the learner. */
	function start(b: AskBlock) {
		if (kind === "check") void rt.resume(b);
		if (kind === "agent" || kind === "collect") {
			b.phase = "thinking";
			b.agentPhase = "reading";
			window.setTimeout(() => {
				if (b.phase !== "thinking") return;
				b.turns.push({ id: newId("u"), ...(kind === "collect" ? collectQuestion(lang) : agentQuestion(lang)) });
				b.phase = "waiting";
				b.agentPhase = "waiting";
			}, 1800);
		}
	}
	rt.reset = () => {
		rt.halt(block.id);
		rt.notice = "";
		rt.blocks.delete(block.id);
		block = make();
		rt.blocks.set(block.id, block);
		start(block);
	};
	onMount(() => {
		rt.blocks.set(block.id, block);
		start(block);
	});

	/* ── playback ── */
	let root = $state<HTMLElement | null>(null);
	let playing = $state(false);
	const p = player(() => root);
	// svelte-ignore state_referenced_locally
	const learner = moves(lang, kind);
	let loops = 0;
	async function loop() {
		const me = ++loops;
		playing = true;
		await p.play(async (s) => {
			for (;;) {
				// a block that has moved on starts over; a fresh one plays from where it is
				if (block.turns.some((t) => t.answer && !t.inNote) || block.settled) rt.reset(block);
				await learner(s);
				await s.wait(5000);
				rt.reset(block);
			}
		});
		if (me === loops) playing = false;
	}
	const play = {
		start: () => void loop(),
		stop: () => p.stop(),
	};
	/** *Play again*: a fresh block, played. */
	function again() {
		p.stop();
		rt.reset(block);
		void loop();
	}

	const kept = $derived(block.settled === "kept" ? keptMarkdown(block) : "");
	/** A check's revision replaces the learner's paragraph, as in the plugin. */
	/** An applied change (the link at the first mention) is part of the note. */
	const linked = $derived(block.turns.some((t) => t.kind === "review" && t.answer?.confirmed));
	const mine = $derived(block.settled === "kept" ? (block.turns.find((t) => t.final)?.answer?.text?.trim() || n.mine) : n.mine);
</script>

<Pane path={n.path} {zh} notice={rt.notice} {playing} {play} onrestart={again} bind:el={root}>
	<p>{n.before}</p>
	{#if linked}
		<div class="icap-demo-added" use:markdown={linkedSentence(lang)}></div>
	{:else}
		<p>{n.sentence.join("")}</p>
	{/if}
	{#if kind === "check"}
		<p class="icap-demo-mine">{mine}</p>
	{:else}
		<p>{n.after}</p>
	{/if}
	{#if kept}
		<div class="icap-demo-kept" use:markdown={kept}></div>
	{:else}
		<div class="icap-demo-widget" bind:this={host}>
			{#if host}
				{#key block.id}
					<AskView {block} id={block.id} title={block.topic} rt={rt as never} sourcePath={n.path} {host} />
				{/key}
			{/if}
		</div>
	{/if}
</Pane>
