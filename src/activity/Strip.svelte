<script lang="ts">
	/*
	 * A task's time, left to right: under it, where the time between steps went (the wait for the model,
	 * its thinking, the learner); over it, the steps (read is a tint, a change is solid, a question hatched).
	 * One card per strip, gliding to what is under the pointer or focus. Live tasks keep their own clock.
	 */
	import { L } from "../i18n";
	import { tick } from "svelte";
	import type { Task } from "../runtime/state.svelte";
	import { introduce, play, reducedMotion, spring } from "../ui/motion";
	import { phaseWord } from "../ui/phrases";
	import { duration, phaseSpans, spans } from "./rows";

	let { task, start, end = null, key }: { task: Task; start: number; end?: number | null; key: string } = $props();

	let now = $state(Date.now());
	$effect(() => {
		if (!task.active) return;
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

	const until = $derived(task.active ? now : (end ?? task.endedAt ?? now));
	const steps = $derived(task.steps.length ? spans(task.steps, start, until) : []);
	const phases = $derived(phaseSpans(task.phases, start, until));
	// Drawn only when it says something: this session's phases, or a step that took visible time.

	type Card = { id: string; what: string; how: string; out?: string; error?: boolean };
	let card = $state<Card | null>(null);
	let cardEl = $state<HTMLElement | null>(null);
	let cardX = 0;
	function show(c: Card, ev: Event) {
		const target = ev.currentTarget as HTMLElement;
		const strip = target.parentElement!;
		const moving = !!card;
		card = c;
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
	/** Centred under what it names, but kept inside the view (8px from each edge). */
	function cardOffset(target: HTMLElement, strip: HTMLElement, el: HTMLElement): number {
		const view = (strip.closest(".icap-activity-host, .icap-ledger") ?? document.documentElement).getBoundingClientRect();
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

	/** A strip grows in from its start once; reloads and re-renders never replay it. */
	function growIn(node: HTMLElement, k: string) {
		if (!introduce(`strip:${k}`) || reducedMotion()) return;
		play(node, { scaleX: [0, 1], opacity: [0, 1] }, spring.settle);
	}
</script>

{#if phases.length || steps.some((x) => x.width > 0.02)}
	<!-- Names for screen readers are hidden text, not aria-label: Obsidian gives every aria-label its own
	     hover tooltip, which would cover the strip and repeat the card. -->
	<div class="icap-activity-strip" role="group" aria-labelledby="icap-steps-{key}" use:growIn={key} onpointerleave={() => (card = null)}>
		<span id="icap-steps-{key}" class="icap-sr-only">{L("Steps", "步骤")}</span>
		{#each phases as p, i (i)}
			{#if p.kind !== "prep" && p.kind !== "reply"}
				<button
					type="button"
					class="icap-activity-phase-span"
					data-phase={p.kind}
					class:is-running={p.running && task.active}
					style:left="{p.left * 100}%"
					style:width="{p.width * 100}%"
					onpointerenter={(e) => show({ id: `p${i}`, what: phaseWord(p.kind), how: duration(p.ms) }, e)}
					onfocus={(e) => show({ id: `p${i}`, what: phaseWord(p.kind), how: duration(p.ms) }, e)}
					onblur={() => (card = null)}
				><span class="icap-sr-only">{phaseWord(p.kind)} · {duration(p.ms)}</span></button>
			{/if}
		{/each}
		{#each steps as s (s.index)}
			{@const st = task.steps[s.index]}
			<button
				type="button"
				class="icap-activity-span"
				data-kind={s.kind}
				class:is-error={task.steps[s.index]?.error}
				class:is-running={s.running && task.active}
				style:left="{s.left * 100}%"
				style:width="{s.width * 100}%"
				onpointerenter={(e) => show({ id: `s${s.index}`, what: st?.detail || st?.tool || "", how: `${st?.tool} · ${duration(s.ms)}`, out: st?.out, error: st?.error }, e)}
				onfocus={(e) => show({ id: `s${s.index}`, what: st?.detail || st?.tool || "", how: `${st?.tool} · ${duration(s.ms)}`, out: st?.out, error: st?.error }, e)}
				onblur={() => (card = null)}
			><span class="icap-sr-only">{st?.tool} · {duration(s.ms)}</span></button>
		{/each}
		{#if card}
			<div class="icap-activity-card" bind:this={cardEl} role="tooltip">
				<div class="icap-activity-card-what">{card.what}</div>
				<div class="icap-activity-card-how icap-activity-num">{card.how}</div>
				{#if card.out}<div class="icap-activity-card-out" class:is-error={card.error}>{card.out}</div>{/if}
			</div>
		{/if}
	</div>
{/if}
