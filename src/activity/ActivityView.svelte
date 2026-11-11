<script lang="ts">
	import { L } from "../i18n";
	import { tick } from "svelte";
	import type { Task } from "../runtime/state.svelte";
	import { phaseLine } from "../ui/phrases";
	import { introduce, play, reducedMotion, spring } from "../ui/motion";
	import { markFor } from "../ui/provider-marks";
	import { costText, duration, modelName, spans, tone, type ActivityData, type ActivityRow, type Span } from "./rows";

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

	function stripOf(r: ActivityRow, t: Task | undefined): Span[] {
		if (!t || !t.steps.length) return [];
		return spans(t.steps, startOf(r, t), endOf(r, t) ?? now);
	}

	const statusText: Record<string, string> = {
		live: L("Working", "进行中"),
		you: L("Needs you", "等你回应"),
		done: L("Done", "完成"),
		failed: L("Failed", "失败"),
		stopped: L("Stopped", "已停止"),
		idle: L("Not started", "未开始"),
	};

	/* The step card: one per view, gliding to the step under the pointer or focus. */
	let card = $state<{ row: string; span: Span; step: { tool: string; detail: string } } | null>(null);
	let cardEl = $state<HTMLElement | null>(null);
	let cardX = 0;
	function show(r: ActivityRow, span: Span, ev: Event) {
		const t = tasks.get(r.path);
		const step = t?.steps[span.index];
		if (!step) return;
		const target = ev.currentTarget as HTMLElement;
		const strip = target.parentElement!;
		const moving = card?.row === r.path;
		card = { row: r.path, span, step };
		void tick().then(() => {
			if (!cardEl) return;
			const x = cardOffset(target, strip, cardEl);
			if (moving) play(cardEl, { x: [cardX, x] }, spring.quick);
			else {
				cardEl.style.transform = `translateX(${x}px)`;
				play(cardEl, { opacity: [0, 1], y: [3, 0] }, spring.quick);
			}
			cardX = x;
		});
	}
	/**
	 * Where the card sits, as an offset from the strip's centre: centred under the step, but kept inside
	 * the visible view (8px from each edge), so a step near either end does not push it off the side.
	 */
	function cardOffset(target: HTMLElement, strip: HTMLElement, el: HTMLElement): number {
		const view = (strip.closest(".icap-activity-host") ?? document.documentElement).getBoundingClientRect();
		const gap = 8;
		el.style.maxWidth = `min(22rem, ${Math.max(0, view.width - 2 * gap)}px)`;
		const s = strip.getBoundingClientRect();
		const w = el.offsetWidth;
		let x = target.offsetLeft + target.offsetWidth / 2 - strip.clientWidth / 2;
		const left = s.left + s.width / 2 + x - w / 2;
		if (left < view.left + gap) x += view.left + gap - left;
		else if (left + w > view.right - gap) x -= left + w - (view.right - gap);
		return x;
	}

	function hide(r: ActivityRow) {
		if (card?.row === r.path) card = null;
	}

	const kindText = { read: L("read", "读取"), write: L("changed", "改动"), ask: L("asked you", "问你") };

	/** A row's strip grows in from its start once; reloads and re-renders never replay it. */
	function growIn(node: HTMLElement, key: string) {
		if (!introduce(`activity:${key}`) || reducedMotion()) return;
		play(node, { scaleX: [0, 1], opacity: [0, 1] }, spring.settle);
	}
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
				{@const strip = stripOf(r, t)}
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
						{#if strip.length}
							<!-- Names for screen readers are hidden text, not aria-label: Obsidian gives every aria-label its own
								     hover tooltip, which would cover the strip and repeat the card. -->
							<div class="icap-activity-strip" role="group" aria-labelledby="icap-steps-{r.id || r.path}" use:growIn={r.path} onpointerleave={() => hide(r)}>
								<span id="icap-steps-{r.id || r.path}" class="icap-sr-only">{L("Steps", "步骤")}</span>
								{#each strip as s (s.index)}
									<button
										type="button"
										class="icap-activity-span"
										data-kind={s.kind}
										class:is-running={s.running && t?.active}
										style:left="{s.left * 100}%"
										style:width="{s.width * 100}%"
										onpointerenter={(e) => show(r, s, e)}
										onfocus={(e) => show(r, s, e)}
										onblur={() => hide(r)}
									><span class="icap-sr-only">{t?.steps[s.index]?.tool} · {duration(s.ms)}</span></button>
								{/each}
								{#if card?.row === r.path}
									<div class="icap-activity-card" bind:this={cardEl} role="tooltip">
										<div class="icap-activity-card-what">{card.step.detail || card.step.tool}</div>
										<div class="icap-activity-card-how">
											<span data-kind={card.span.kind}>{kindText[card.span.kind]}</span> · <code>{card.step.tool}</code> · <span class="icap-activity-num">{duration(card.span.ms)}</span>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/each}
</div>
