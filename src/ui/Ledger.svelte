<script lang="ts">
	import { L } from "../i18n";
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import X from "@lucide/svelte/icons/x";
	import ListIcon from "@lucide/svelte/icons/list";
	import FilePlus from "@lucide/svelte/icons/file-plus";
	import FilePen from "@lucide/svelte/icons/file-pen";
	import FileX from "@lucide/svelte/icons/file-x";
	import Strip from "../activity/Strip.svelte";
	import StepList from "../activity/StepList.svelte";
	import { duration } from "../activity/rows";
	import { formatCost } from "../agent/usage";
	import type { LearningRuntime } from "../runtime/runtime";
	import type { Task } from "../runtime/state.svelte";
	import { ago, kindWord, liveCue, statusWord, stopLabel, subjectOf } from "./phrases";
	import { play, settleIn, spring, strokeIn } from "./motion";

	let { rt }: { rt: LearningRuntime } = $props();
	// svelte-ignore state_referenced_locally
	const ledger = rt.ledger;

	let panel = $state<HTMLElement | null>(null);

	/* Presence: the panel rises out of the status-bar mark and sinks back into it. Reopening
	   mid-close reverses from wherever it is. */
	// svelte-ignore state_referenced_locally
	let shown = $state(ledger.open);
	let openedAt = 0;
	$effect(() => {
		if (ledger.open) {
			const fresh = !shown;
			shown = true;
			openedAt = Date.now();
			void tick().then(() => {
				if (!panel) return;
				if (fresh) play(panel, { opacity: [0, 1], scale: [0.97, 1], y: [8, 0] }, spring.settle);
				else play(panel, { opacity: 1, scale: 1, y: 0 }, spring.settle);
			});
		} else if (shown) {
			if (!panel) return void (shown = false);
			void play(panel, { opacity: 0, scale: 0.98, y: 6 }, spring.leave).finished.then(() => {
				if (!ledger.open) shown = false;
			});
		}
	});

	/** Rows that appear while the panel is open (a task starting, finishing, moving group) settle in. */
	function rowIn(node: HTMLElement, key: string) {
		if (Date.now() - openedAt < 300) return {};
		return settleIn(node, key);
	}
	let now = $state(Date.now());

	const waiting = $derived(ledger.tasks.filter((t) => t.status === "waiting"));
	const working = $derived(ledger.tasks.filter((t) => t.status === "processing"));
	const earlier = $derived(ledger.tasks.filter((t) => !t.active));

	$effect(() => {
		if (!ledger.open) return;
		now = Date.now();
		const tick$ = window.setInterval(() => (now = Date.now()), working.length ? 1000 : 30000);
		void tick().then(() => panel?.focus());
		const away = (e: MouseEvent) => {
			const t = e.target as HTMLElement;
			if (panel && !panel.contains(t) && !t.closest(".icap-mark")) ledger.open = false;
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				ledger.open = false;
				(document.querySelector(".icap-mark") as HTMLElement | null)?.focus();
			}
		};
		document.addEventListener("mousedown", away, true);
		document.addEventListener("keydown", esc, true);
		return () => {
			window.clearInterval(tick$);
			document.removeEventListener("mousedown", away, true);
			document.removeEventListener("keydown", esc, true);
		};
	});

	function noteName(path: string) {
		return path.split("/").pop()!.replace(/\.md$/, "");
	}

	/** Rows whose steps are open. */
	const openSteps = new SvelteSet<string>();
	function toggleSteps(id: string) {
		if (openSteps.has(id)) openSteps.delete(id);
		else openSteps.add(id);
	}
	function changed(t: Task) {
		return t.artifacts.filter((a) => a.kind === "created" || a.kind === "edited" || a.kind === "deleted");
	}

	function go(t: Task) {
		ledger.open = false;
		void rt.reveal(t);
	}
</script>

{#if shown}
	<div bind:this={panel} class="icap-ledger" inert={!ledger.open} role="dialog" aria-label={L("Learning activity", "学习活动")} tabindex="-1">
		<header class="icap-ledger-head">
			<h2>{L("Activity", "活动")}</h2>
			{#if earlier.length}
				<button type="button" class="icap-link is-quiet" onclick={() => ledger.clearFinished()}>{L("clear finished", "清除已完成")}</button>
			{/if}
			<button type="button" class="icap-icon-btn" aria-label={L("Close", "关闭")} onclick={() => (ledger.open = false)}><X size={14} /></button>
		</header>

		{#if !ledger.tasks.length}
			<p class="icap-ledger-empty">{L("No activity yet", "还没有活动")}</p>
		{/if}

		{#snippet row(t: Task)}
			{@const files = changed(t)}
			{@const cost = t.usage ? formatCost(t.usage) : null}
			<li class="icap-row" data-status={t.status} use:rowIn={`row:${t.id}:${t.status}`}>
				{#if t.status === "completed"}
					<svg class="icap-row-check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.6 L5 9.4 L10.2 2.6" use:strokeIn={`done:${t.id}`} /></svg>
				{:else}
					<span class="icap-row-glyph" aria-hidden="true"></span>
				{/if}
				<div class="icap-row-main">
					<p class="icap-row-line">
						<span class="icap-row-kind">{kindWord(t.kind)}</span>
						{#if t.status === "waiting" || t.blockId || t.glossId}
							<button type="button" class="icap-row-title" title={t.title} onclick={() => go(t)}>{subjectOf(t.title)}</button>
						{:else}
							<span class="icap-row-title" title={t.title}>{subjectOf(t.title)}</span>
						{/if}
					</p>
					<p class="icap-row-meta">
						{#if t.status === "processing"}
							<span class="icap-row-live">{liveCue(t, now)}</span>
						{:else if t.status !== "completed"}
							<span class="icap-row-status" title={t.interrupted ? (t.error ?? undefined) : undefined}>{t.interrupted ? L("interrupted", "已中断") : statusWord(t.status)}</span>
						{/if}
						<button type="button" class="icap-link" onclick={() => rt.openPath(t.notePath)}>{noteName(t.notePath)}</button>
						{#if !t.active && t.endedAt}<span class="icap-row-num">{duration(t.endedAt - t.createdAt)}</span>{/if}
						{#if cost && !t.active}<span class="icap-row-num">{cost}</span>{/if}
						{#if t.steps.length}
							<button type="button" class="icap-row-steps-toggle" aria-expanded={openSteps.has(t.id)} aria-label={L("Steps", "步骤")} onclick={() => toggleSteps(t.id)}><ListIcon size={11} aria-hidden="true" /><span class="icap-row-num">{t.steps.length + t.stepsDropped}</span></button>
						{/if}
					</p>
					{#if t.phases.length}<Strip task={t} start={t.createdAt} key={`ledger:${t.id}`} />{/if}
					{#if openSteps.has(t.id)}
						<div use:settleIn={`steps:${t.id}`}><StepList steps={t.steps} active={t.active} /></div>
					{/if}
					{#if t.error && !t.interrupted}<p class="icap-row-error">{t.error}</p>{/if}
					{#if files.length}
						<ul class="icap-row-artifacts">
							{#each files as a (a.path + a.kind)}
								<li use:settleIn={`art:${t.id}:${a.kind}:${a.path}`}>
									<span class="icap-row-file" title={a.kind === "created" ? L("new", "新建") : a.kind === "edited" ? L("changed", "修改") : L("deleted", "删除")}>{#if a.kind === "created"}<FilePlus size={11} aria-hidden="true" />{:else if a.kind === "edited"}<FilePen size={11} aria-hidden="true" />{:else}<FileX size={11} aria-hidden="true" />{/if}</span>
									{#if a.kind === "deleted"}
										<span>{a.label}</span>
									{:else}
										<button type="button" class="icap-link" onclick={() => rt.openPath(a.path)}>{a.label}</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="icap-row-actions">
					<span class="icap-row-time">{ago(t.endedAt ?? t.createdAt, now)}</span>
					{#if t.status === "waiting"}
						<button type="button" class="icap-link icap-primary" onclick={() => go(t)}>{L("answer", "去回答")}</button>
					{/if}
					{#if t.active}
						<button type="button" class="icap-link is-quiet" onclick={() => rt.cancelTask(t)}>{stopLabel(t.phase)}</button>
					{:else if t.status === "failed" && t.retry}
						<button type="button" class="icap-link" onclick={() => t.retry?.()}>{L("retry", "重试")}</button>
					{/if}
				</div>
			</li>
		{/snippet}

		{#if waiting.length}
			<section class="icap-ledger-group">
				<h3>{L("Needs you", "等你回应")}</h3>
				<ul>{#each waiting as t (t.id)}{@render row(t)}{/each}</ul>
			</section>
		{/if}
		{#if working.length}
			<section class="icap-ledger-group">
				<h3>{L("Now", "进行中")}</h3>
				<ul>{#each working as t (t.id)}{@render row(t)}{/each}</ul>
			</section>
		{/if}
		{#if earlier.length}
			<section class="icap-ledger-group">
				<h3>{L("Earlier", "较早")}</h3>
				<ul>{#each earlier.slice(0, 30) as t (t.id)}{@render row(t)}{/each}</ul>
			</section>
		{/if}
	</div>
{/if}
