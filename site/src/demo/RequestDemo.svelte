<script lang="ts">
	/*
	 * The plugin's request block (src/ui/AskView.svelte, kind "request") in a note, played: a request
	 * with a link, the agent's reply, a proposed change, a follow-up, and the record that stays.
	 */
	import { L, setLocale } from "@plugin/i18n";
	import AskView from "@plugin/ui/AskView.svelte";
	import { keptMarkdown } from "@plugin/runtime/kept";
	import { AskBlock } from "@plugin/runtime/state.svelte";
	import { newId } from "@plugin/dsl/blocks";
	import { onMount } from "svelte";
	import { DemoRuntime } from "./runtime.svelte";
	import { note, type Lang } from "./content";
	import { addedParagraph, requestMoves, requestScript, vaultFiles, type RequestDemoKind } from "./requests";
	import { player } from "./player";
	import { markdown } from "./markdown";
	import Pane from "./Pane.svelte";

	let { lang = "en", kind = "request" }: { lang?: Lang; kind?: RequestDemoKind } = $props();
	// svelte-ignore state_referenced_locally
	setLocale(lang);
	// svelte-ignore state_referenced_locally
	const n = note(lang);
	// svelte-ignore state_referenced_locally
	const zh = lang === "zh";
	// svelte-ignore state_referenced_locally
	const rt = new DemoRuntime({}, undefined, requestScript(lang, kind), vaultFiles(lang));

	let block = $state<AskBlock>(make());
	let host = $state<HTMLElement | null>(null);

	/** A new request block, as *Ask the agent here* opens it below the cursor (runtime.ts, request). */
	function make(): AskBlock {
		const b = new AskBlock(newId("q"), "request", "", n.path);
		b.turns = [
			{
				id: newId("u"),
				kind: "text",
				question: "",
				placeholder: L("Ask your agent anything… ([[ to link a file, / for commands)", "向你的 Agent 提任何请求…（[[ 链接文件，/ 使用命令）"),
				local: true,
				request: true,
			},
		];
		return b;
	}
	rt.reset = () => {
		rt.halt(block.id);
		rt.notice = "";
		rt.blocks.delete(block.id);
		block = make();
		rt.blocks.set(block.id, block);
	};
	onMount(() => {
		rt.blocks.set(block.id, block);
		// a visual's icap.ask (see obsidian.ts): a follow-up in the block it is shown in
		const ask = (e: Event) => {
			const d = (e as CustomEvent<{ block: string | null; text: string }>).detail;
			if (d.block === block.id) rt.visualFollowUp(d.block, d.text);
		};
		window.addEventListener("icap-demo-ask", ask);
		return () => window.removeEventListener("icap-demo-ask", ask);
	});

	/* ── playback ── */
	let root = $state<HTMLElement | null>(null);
	let playing = $state(false);
	const p = player(() => root);
	// svelte-ignore state_referenced_locally
	const learner = requestMoves(lang, kind, {
		frame: () => root?.querySelector<HTMLIFrameElement>("iframe.icap-ui-frame"),
		requests: () => block.turns.filter((t) => t.request).length,
		phase: () => block.phase,
	});
	let loops = 0;
	async function loop() {
		const me = ++loops;
		playing = true;
		await p.play(async (s) => {
			for (;;) {
				// a block that has moved on starts over; a fresh one plays from where it is
				if (block.turns.some((t) => t.answer) || block.settled) rt.reset(block);
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
	function again() {
		p.stop();
		rt.reset(block);
		void loop();
	}

	const kept = $derived(block.settled === "kept" ? keptMarkdown(block, rt.ledger.get(block.taskId ?? "")?.artifacts ?? []) : "");
	/** The proposed change, once applied, is part of the note. */
	const applied = $derived(block.turns.some((t) => t.kind === "review" && t.answer?.confirmed));
</script>

<Pane path={n.path} {zh} notice={rt.notice} {playing} {play} onrestart={again} bind:el={root}>
	<p>{n.before}</p>
	<p>{n.sentence.join("")}</p>
	<p>{n.after}</p>
	{#if applied}<div class="icap-demo-added" use:markdown={addedParagraph(lang)}></div>{/if}
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
