<script lang="ts">
	import { L } from "../i18n";
	import type { Task } from "../runtime/state.svelte";
	import { phaseLine } from "../ui/phrases";
	import { markFor } from "../ui/provider-marks";
	import { copyText } from "../ui/copy";
	import { costText, duration, modelName, taskText, tone, type ActivityData, type ActivityRow } from "./rows";
	import Strip from "./Strip.svelte";
	import StepList from "./StepList.svelte";
	import { SvelteSet } from "svelte/reactivity";
	import Copy from "@lucide/svelte/icons/copy";
	import ListTree from "@lucide/svelte/icons/list-tree";

	let {
		data,
		live,
		open,
		openTask,
	}: {
		data: ActivityData;
		/** This device's task behind a row, for its strip and live phase. */
		live: (id: string) => Task | undefined;
		open: (path: string, ev: MouseEvent | KeyboardEvent) => void;
		/** A task's name leads to where it was asked (without it, to its task note). */
		openTask?: (row: ActivityRow, ev: MouseEvent | KeyboardEvent) => void;
	} = $props();

	const rows = $derived(data.groups.flatMap((g) => g.rows));
	const tasks = $derived(new Map(rows.map((r) => [r.path, live(r.id)] as const)));
	const anyLive = $derived([...tasks.values()].some((t) => t?.active));

	/* One clock for every strip and counter: a frame loop while something runs, still otherwise. */
	let now = $state(Date.now());
	$effect(() => {
		if (!anyLive) {
			now = Date.now();
			return;
		}
		let raf = 0;
		let last = 0;
		const step = (t: number) => {
			// 20 fps is plenty for a strip a few hundred pixels wide; the shine is CSS.
			if (t - last > 50) {
				now = Date.now();
				last = t;
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	const counts = $derived.by(() => {
		let working = 0,
			you = 0,
			cost = 0,
			costed = false;
		for (const r of rows) {
			const t = tone(r.status);
			if (t === "live") working++;
			else if (t === "you") you++;
			if (typeof r.cost === "number") {
				cost += r.cost;
				costed = true;
			}
		}
		return { working, you, cost: costed ? cost : null };
	});

	function startOf(r: ActivityRow, t: Task | undefined) {
		return t?.createdAt ?? r.started ?? now;
	}
	function endOf(r: ActivityRow, t: Task | undefined) {
		if (t) return t.active ? now : (t.endedAt ?? now);
		return r.ended;
	}

	/** Rows whose tool calls are open. */
	const traced = new SvelteSet<string>();
	function toggleTrace(path: string) {
		if (traced.has(path)) traced.delete(path);
		else traced.add(path);
	}

	const statusText: Record<string, string> = {
		live: L("Working", "进行中"),
		you: L("Needs you", "等你回应"),
		done: L("Done", "完成"),
		failed: L("Failed", "失败"),
		stopped: L("Stopped", "已停止"),
		idle: L("Not started", "未开始"),
	};

</script>

<div class="icap-activity">
	<p class="icap-activity-status" aria-live="polite">
		{#if counts.working}<span class="is-live"><span class="icap-activity-pulse" aria-hidden="true"></span>{L(`${counts.working} working`, `${counts.working} 项进行中`)}</span>{/if}
		{#if counts.you}<span class="is-you">{L(`${counts.you} need you`, `${counts.you} 项等你回应`)}</span>{/if}
		{#if !counts.working && !counts.you}<span>{rows.length ? L("All quiet", "没有进行中的任务") : L("No tasks yet", "还没有任务")}</span>{/if}
		{#if counts.cost !== null}<span class="icap-activity-num">{costText(counts.cost)}</span>{/if}
	</p>

	{#each data.groups as group, gi (group.key ?? gi)}
		{#if group.key}<h4 class="icap-activity-group">{group.key}</h4>{/if}
		<ol class="icap-activity-list">
			{#each group.rows as r (r.path)}
				{@const t = tasks.get(r.path)}
				{@const tn = tone(r.status)}
				{@const start = startOf(r, t)}
				{@const end = endOf(r, t)}
				{@const mark = r.model ? markFor(r.model) : null}
				<li class="icap-activity-row" data-tone={tn}>
					<span class="icap-activity-dot" aria-label={statusText[tn]}></span>
					<div class="icap-activity-main">
						<div class="icap-activity-title">
							<a href={r.path} class="internal-link" title={L("Open where it was asked", "打开提问的位置")} onclick={(e) => { e.preventDefault(); if (openTask) openTask(r, e); else open(r.path, e); }}>{r.title}</a>
							{#if tn === "live" || tn === "you"}
								<span class="icap-activity-phase">{tn === "you" ? statusText.you : t ? phaseLine(t.phase, "request") : statusText.live}</span>
							{/if}
						</div>
						<div class="icap-activity-meta">
							{#if r.model}
								<span class="icap-activity-model" title={r.model}>
									{#if mark}
										<svg class="icap-activity-mark" viewBox={mark.viewBox} fill="currentColor" fill-rule={mark.evenOdd ? "evenodd" : undefined} aria-hidden="true">{@html mark.body}</svg>
									{/if}
									{modelName(r.model)}
								</span>
							{/if}
							{#if r.source}
								<a href={r.source} class="internal-link icap-activity-source" onclick={(e) => { e.preventDefault(); open(r.source!, e); }}>{r.source.split("/").pop()}</a>
							{/if}
							{#if r.changed.length}
								<span title={r.changed.join("\n")}>{L(`${r.changed.length} file${r.changed.length > 1 ? "s" : ""}`, `${r.changed.length} 个文件`)}</span>
							{/if}
							{#if end !== null && r.started !== null}
								<span class="icap-activity-num">{duration(end - start)}</span>
							{/if}
							{#if costText(r.cost)}<span class="icap-activity-num">{costText(r.cost)}</span>{/if}
						</div>
						{#if t && (t.steps.length || t.phases.length)}
							<div class="icap-activity-trace">
								{#if t.steps.length}
									<button type="button" class="icap-activity-trace-toggle" aria-expanded={traced.has(r.path)} aria-label={L("Tool calls", "工具调用")} onclick={() => toggleTrace(r.path)}><ListTree size={14} aria-hidden="true" /><span class="icap-activity-num">{t.steps.length + t.stepsDropped}</span></button>
									<button type="button" class="icap-activity-trace-copy" aria-label={L("Copy the task's details", "复制任务的详情")} onclick={() => copyText(taskText(t))}><Copy size={13} aria-hidden="true" /></button>
								{/if}
								<div class="icap-activity-trace-strip"><Strip task={t} start={start} end={end} key={r.path} /></div>
							</div>
							{#if traced.has(r.path) && t.steps.length}<StepList steps={t.steps} active={t.active} />{/if}
						{/if}
						{#if t?.error && !t.interrupted}<p class="icap-activity-error">{t.error}</p>{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/each}
</div>
