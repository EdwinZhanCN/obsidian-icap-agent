<script lang="ts">
	import { L } from "../i18n";
	import { focusIfNear } from "./focus";
	import { onMount } from "svelte";
	import type { App } from "obsidian";
	import Markdown from "./Markdown.svelte";
	import Keys from "./Keys.svelte";
	import { keyGuard } from "./keys";
	import { drawn, play, spring } from "./motion";
	import { press } from "motion";

	interface Props {
		app: App;
		sourcePath: string;
		multi: boolean;
		options: { id: string; label: string }[];
		/** Chosen ids; when `locked`, the list is read-only and shows the submitted answer. */
		chosen: string[];
		locked?: boolean;
		autofocus?: boolean;
		label: string;
		onchange?: (ids: string[]) => void;
		onsubmit?: (ids: string[]) => void;
	}
	let { app, sourcePath, multi, options, chosen, locked = false, autofocus = false, label, onchange, onsubmit }: Props = $props();

	// svelte-ignore state_referenced_locally
	let selected = $state<string[]>([...(chosen ?? [])]);
	let focusIdx = $state(0);
	let items: HTMLElement[] = $state([]);

	const letter = (i: number) => String.fromCharCode(97 + i);

	/* Once the answer is in, the options not chosen recede — in place, so the list the learner
	   answered on is the list that stays. Already-answered lists start receded. */
	function recede(node: HTMLElement, off: boolean) {
		node.style.opacity = off ? "0.45" : "";
		return {
			update(next: boolean) {
				play(node, { opacity: next ? 0.45 : 1 }, spring.settle);
			},
		};
	}

	/* A pressed option gives a little under the finger and springs back when released. */
	function pressable(node: HTMLElement) {
		const cancel = press(node, (el) => {
			if (locked) return;
			play(el, { scale: 0.985 }, spring.quick);
			return () => play(el, { scale: 1 }, spring.hand);
		});
		return { destroy: cancel };
	}

	// Hand-drawn strokes, in a 44×40 box around the letter.
	const RING = "M31 7 C 23 2, 8 4, 5 16 C 2 28, 17 36, 29 32 C 40 28, 42 15, 33 8 C 29 5, 24 4.5, 19 5.5";
	const BOX = "M9 8 L 35 7.2 L 35.6 32 L 8.6 33 Z";
	const TICK = "M29 15 L 34 21 L 46 3";

	onMount(() => {
		if (autofocus && !locked) focusIfNear(items[0]);
	});

	function toggle(id: string) {
		if (locked) return;
		if (multi) selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
		else selected = [id];
		onchange?.(selected);
	}

	function move(to: number) {
		focusIdx = (to + options.length) % options.length;
		items[focusIdx]?.focus();
	}

	function onkeydown(e: KeyboardEvent, i: number) {
		if (locked) return;
		const k = e.key;
		if (k === "ArrowDown" || k === "ArrowRight") {
			e.preventDefault();
			move(i + 1);
			if (!multi) toggle(options[focusIdx].id);
		} else if (k === "ArrowUp" || k === "ArrowLeft") {
			e.preventDefault();
			move(i - 1);
			if (!multi) toggle(options[focusIdx].id);
		} else if (k === " ") {
			e.preventDefault();
			toggle(options[i].id);
		} else if (k === "Enter") {
			e.preventDefault();
			if (!multi && !selected.length) toggle(options[i].id);
			if (selected.length) onsubmit?.(selected);
		} else if (/^[a-h]$/i.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const j = k.toLowerCase().charCodeAt(0) - 97;
			if (j < options.length) {
				e.preventDefault();
				move(j);
				toggle(options[j].id);
			}
		} else {
			return; // Esc, Tab, chords: not ours — let them reach the block and the app
		}
		e.stopPropagation();
	}
</script>

<div class="icap-choices" class:is-locked={locked} class:is-multi={multi} role={multi ? "group" : "radiogroup"} aria-label={label} use:keyGuard={{ app, submit: () => selected.length && onsubmit?.(selected) }}>
	{#each options as o, i (o.id)}
		{@const on = selected.includes(o.id)}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_interactive_supports_focus -->
		<div
			bind:this={items[i]}
			class="icap-choice"
			class:is-on={on}
			use:recede={locked && !on}
			use:pressable
			role={multi ? "checkbox" : "radio"}
			aria-checked={on}
			aria-disabled={locked}
			tabindex={locked ? -1 : i === focusIdx ? 0 : -1}
			onclick={() => {
				focusIdx = i;
				toggle(o.id);
			}}
			onkeydown={(e) => onkeydown(e, i)}
		>
			<span class="icap-choice-mark" aria-hidden="true">
				<svg class="icap-ink-svg" viewBox="0 0 44 40" preserveAspectRatio="none">
					{#if multi}
						<path d={BOX} use:drawn={on} />
						<path d={TICK} class="is-tick" use:drawn={on} />
					{:else}
						<path d={RING} use:drawn={on} />
					{/if}
				</svg>
				<span class="icap-choice-letter">{letter(i)}</span>
			</span>
			<Markdown {app} markdown={o.label} {sourcePath} class="icap-choice-label" />
		</div>
	{/each}
	{#if !locked}
		<div class="icap-writing-foot">
			<span class="icap-hint" aria-hidden="true">{multi ? L("space to mark", "空格标记") : `a–${letter(options.length - 1)}`} · <Keys mod={false} /> {L("to submit", "提交")}</span>
			<button type="button" class="icap-link icap-primary" disabled={!selected.length} onclick={() => onsubmit?.(selected)}>{L("submit", "提交")}</button>
		</div>
	{/if}
</div>
