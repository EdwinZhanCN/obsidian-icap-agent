<script lang="ts">
	/* A task's tool calls in order: the tool, what it was given, how long it took, and the start of what it returned. */
	import type { Step } from "../runtime/state.svelte";
	import { duration } from "./rows";

	let { steps, active = false }: { steps: readonly Step[]; active?: boolean } = $props();

	let now = $state(Date.now());
	$effect(() => {
		if (!active) return;
		const t = window.setInterval(() => (now = Date.now()), 500);
		return () => window.clearInterval(t);
	});

	/** How long a step took; nothing for one too quick to matter (under 0.1 s) or recorded without times. */
	function time(s: Step): string {
		if (s.at === undefined) return "";
		const ms = (s.end ?? (active ? now : s.at)) - s.at;
		return ms < 100 ? "" : duration(ms);
	}
</script>

<ol class="icap-row-steps">
	{#each steps as s, i (i)}
		<li class:is-error={s.error}>
			<span class="icap-step-tool">{s.tool}</span>
			<span class="icap-step-detail" title={s.detail}>{s.detail}</span>
			<span class="icap-row-num">{time(s)}</span>
			{#if s.out}<span class="icap-step-out" title={s.out}>{s.out}</span>{/if}
		</li>
	{/each}
</ol>
