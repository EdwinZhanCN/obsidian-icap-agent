<script lang="ts">
	import { L } from "../i18n";
	import { focusIfNear } from "./focus";
	import { onMount } from "svelte";
	import { TFile, prepareFuzzySearch, type App } from "obsidian";
	import { keyGuard } from "./keys";
	import { insertLink, linkTrigger, type LinkTrigger } from "../dsl/links";

	interface Props {
		app: App;
		value: string;
		placeholder?: string;
		autofocus?: boolean;
		label: string;
		submitLabel?: string;
		onchange: (v: string) => void;
		onsubmit: (v: string) => void;
		/** Esc: defaults to leaving the writing line. */
		onescape?: () => void;
		/** Offer vault files after "[[" (or "@"), linked relative to this note. */
		linksFrom?: string;
	}
	let { app, value, placeholder = L("Write here…", "在这里写…"), autofocus = false, label, submitLabel = L("submit", "提交"), onchange, onsubmit, onescape, linksFrom }: Props = $props();

	let ta: HTMLTextAreaElement;
	// svelte-ignore state_referenced_locally
	let text = $state(value ?? "");

	function grow() {
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	}

	onMount(() => {
		grow();
		if (autofocus && focusIfNear(ta)) ta.setSelectionRange(ta.value.length, ta.value.length);
	});

	/* ── [[ link suggestions ── */
	let trigger = $state<LinkTrigger | null>(null);
	let picks = $state<TFile[]>([]);
	let active = $state(0);
	const listId = `icpa-links-${Math.random().toString(36).slice(2, 8)}`;

	function suggest() {
		if (linksFrom === undefined || !ta) return;
		const t = ta.selectionStart === ta.selectionEnd ? linkTrigger(text, ta.selectionStart) : null;
		trigger = t;
		if (!t) return void (picks = []);
		const files = app.vault.getFiles();
		const q = t.query.trim();
		if (!q) {
			picks = [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8);
		} else {
			const match = prepareFuzzySearch(q);
			picks = files
				.map((f) => {
					const byName = match(f.basename);
					const byPath = match(f.path);
					const score = Math.max(byName ? byName.score + 1 : -Infinity, byPath ? byPath.score : -Infinity);
					return { f, score };
				})
				.filter((x) => x.score > -Infinity)
				.sort((a, b) => b.score - a.score)
				.slice(0, 8)
				.map((x) => x.f);
		}
		active = 0;
	}

	function closeLinks() {
		trigger = null;
		picks = [];
	}

	function choose(f: TFile) {
		if (!trigger) return;
		const linktext = app.metadataCache.fileToLinktext(f, linksFrom ?? "", true);
		const r = insertLink(text, ta.selectionStart, trigger, linktext);
		text = r.text;
		closeLinks();
		onchange(text);
		requestAnimationFrame(() => {
			ta.focus();
			ta.setSelectionRange(r.caret, r.caret);
			grow();
		});
	}

	// One answer per writing line: a fast double ⌘↵ (or a click during the hand-off) is ignored.
	let sent = false;
	function submit() {
		const v = text.trim();
		if (!v || sent) return;
		sent = true;
		window.setTimeout(() => (sent = false), 1200); // if the line is still here, the answer was not taken
		onsubmit(v);
	}

	function onkeydown(e: KeyboardEvent) {
		if (picks.length && trigger) {
			const move = (d: number) => (active = (active + d + picks.length) % picks.length);
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				e.stopPropagation();
				return move(e.key === "ArrowDown" ? 1 : -1);
			}
			if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) || e.key === "Tab") {
				e.preventDefault();
				e.stopPropagation();
				return choose(picks[active]);
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				return closeLinks();
			}
		}
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			ta.blur();
		}
		// Keep Obsidian's editor hotkeys from firing while writing an answer.
		e.stopPropagation();
	}
</script>

<div class="icpa-writing" use:keyGuard={{ app, submit, escape: () => (trigger && picks.length ? closeLinks() : onescape ? onescape() : ta.blur()) }}>
	<textarea
		bind:this={ta}
		bind:value={text}
		rows="2"
		aria-label={label}
		{placeholder}
		spellcheck="true"
		role={linksFrom !== undefined ? "combobox" : undefined}
		aria-expanded={linksFrom !== undefined ? picks.length > 0 : undefined}
		aria-controls={linksFrom !== undefined ? listId : undefined}
		aria-autocomplete={linksFrom !== undefined ? "list" : undefined}
		oninput={() => {
			grow();
			onchange(text);
			suggest();
		}}
		onclick={suggest}
		onblur={() => window.setTimeout(closeLinks, 150)}
		{onkeydown}
	></textarea>
	{#if picks.length && trigger}
		<ul class="icpa-link-suggest" id={listId} role="listbox" aria-label={L("Link a file", "链接文件")}>
			{#each picks as f, i (f.path)}
				<li role="option" aria-selected={i === active}>
					<button
						type="button"
						tabindex="-1"
						class:is-active={i === active}
						onmousedown={(e) => {
							e.preventDefault();
							choose(f);
						}}
						onmouseenter={() => (active = i)}
					>
						<span class="icpa-link-name">{f.extension === "md" ? f.basename : f.name}</span>
						{#if f.parent && !f.parent.isRoot()}<span class="icpa-link-path">{f.parent.path}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="icpa-writing-foot">
		<span class="icpa-hint" aria-hidden="true">⌘↵</span>
		<button type="button" class="icpa-link icpa-primary" disabled={!text.trim()} onclick={submit}>{submitLabel}</button>
	</div>
</div>
