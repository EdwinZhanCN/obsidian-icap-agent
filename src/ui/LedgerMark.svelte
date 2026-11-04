<script lang="ts">
	import { L } from "../i18n";
	import type { LearningRuntime } from "../runtime/runtime";
	import type { Task } from "../runtime/state.svelte";
	import { play, settleIn, spring } from "./motion";

	let { rt }: { rt: LearningRuntime } = $props();
	// svelte-ignore state_referenced_locally
	const ledger = rt.ledger;

	const waiting = $derived(ledger.tasks.filter((t) => t.status === "waiting"));
	const working = $derived(ledger.tasks.filter((t) => t.status === "processing"));
	// Acknowledge a task that just finished, once, then fall quiet again.
	const latest = $derived(ledger.tasks.find((t) => !t.active && t.endedAt));
	let recent = $state<Task | null>(null);
	let seen: string | null = null;
	$effect(() => {
		const t = latest;
		if (!t || t.id === seen || !t.endedAt || Date.now() - t.endedAt > 3000) {
			if (t) seen = t.id;
			return;
		}
		seen = t.id;
		recent = t;
		const timer = window.setTimeout(() => (recent = null), 4000);
		return () => window.clearTimeout(timer);
	});

	const label = $derived(
		waiting.length
			? waiting.length === 1
				? L("your turn", "轮到你了")
				: L(`${waiting.length} questions for you`, `${waiting.length} 个问题等你回答`)
			: working.length
				? working.length === 1
					? L("working", "进行中")
					: L(`${working.length} working`, `${working.length} 项进行中`)
				: recent
					? recent.status === "failed"
						? L("failed", "失败")
						: recent.status === "cancelled"
							? L("stopped", "已停止")
							: L("done", "完成")
					: "",
	);
	const markState = $derived(waiting.length ? "waiting" : working.length ? "working" : recent ? recent.status : "idle");

	/* When the agent hands the turn to the learner, or finishes, the dot is stamped once. */
	let glyph = $state<HTMLElement | null>(null);
	let prev = "idle";
	$effect(() => {
		const s = markState;
		if (s !== prev && (s === "waiting" || s === "completed")) play(glyph, { scale: [0.4, 1] }, spring.hand);
		prev = s;
	});
</script>

<button
	type="button"
	class="icpa-mark"
	data-state={markState}
	aria-haspopup="dialog"
	aria-expanded={ledger.open}
	aria-label={L("Learning activity", "学习活动") + (label ? `: ${label}` : "")}
	title={L("Learning activity", "学习活动")}
	onclick={(e) => {
		e.stopPropagation();
		ledger.open = !ledger.open;
	}}
>
	<span class="icpa-mark-glyph" aria-hidden="true" bind:this={glyph}></span>
	{#key label}{#if label}<span class="icpa-mark-label" use:settleIn>{label}</span>{/if}{/key}
</button>
