<script lang="ts">
	import { L } from "../i18n";
	import { focusIfNear } from "./focus";
	import { onMount } from "svelte";
	import { Platform, TFile, prepareFuzzySearch, type App } from "obsidian";
	import { keyGuard } from "./keys";
	import Keys from "./Keys.svelte";
	import { insertLink, linkTrigger, type LinkTrigger } from "../dsl/links";
	import { commandTrigger, insertArg, insertCommand, rankArgs, rankCommands, type CommandProvider, type CommandSource, type CommandTrigger } from "../dsl/commands";

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
		/** Offer slash commands when the text starts with "/" (request blocks only). */
		commands?: CommandProvider;
	}
	let { app, value, placeholder = L("Write here…", "在这里写…"), autofocus = false, label, submitLabel = L("submit", "提交"), onchange, onsubmit, onescape, linksFrom, commands }: Props = $props();

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

	/* ── suggestions: [[ links and / commands share one list ── */
	interface Suggestion {
		key: string;
		name: string;
		detail?: string;
		badge?: string;
		choose: () => void;
	}
	let items = $state<Suggestion[]>([]);
	let active = $state(0);
	let listLabel = $state("");
	/** A line under the list: loading, or why some commands are missing. */
	let note = $state<string | undefined>(undefined);
	let seq = 0;
	const listId = `icap-suggest-${Math.random().toString(36).slice(2, 8)}`;
	const offers = $derived(linksFrom !== undefined || !!commands);

	const badge: Record<CommandSource, string> = {
		skill: L("skill", "技能"),
		prompt: L("prompt", "提示模板"),
		extension: L("extension", "扩展"),
		icap: "ICAP",
	};

	function close() {
		seq++;
		items = [];
		note = undefined;
	}

	function suggest() {
		if (!ta || ta.selectionStart !== ta.selectionEnd) return close();
		const caret = ta.selectionStart;
		const ct = commands ? commandTrigger(text, caret) : null;
		if (ct) return void suggestCommands(ct);
		const lt = linksFrom !== undefined ? linkTrigger(text, caret) : null;
		if (lt) return suggestFiles(lt);
		close();
	}

	function suggestFiles(t: LinkTrigger) {
		seq++;
		const files = app.vault.getFiles();
		const q = t.query.trim();
		let picks: TFile[];
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
		listLabel = L("Link a file", "链接文件");
		note = undefined;
		items = picks.map((f) => ({
			key: f.path,
			name: f.extension === "md" ? f.basename : f.name,
			detail: f.parent && !f.parent.isRoot() ? f.parent.path : undefined,
			choose: () => chooseFile(t, f),
		}));
		active = 0;
	}

	async function suggestCommands(t: CommandTrigger) {
		if (!commands) return;
		const my = ++seq;
		listLabel = L("Commands", "命令");
		if (t.stage === "name") {
			const pending = commands.list();
			// The first "/" asks Pi for its commands (a second or so); say so instead of showing nothing.
			const slow = window.setTimeout(() => {
				if (my === seq) note = L("asking your Pi for its commands…", "正在向你的 Pi 询问可用命令…");
			}, 120);
			const list = await pending;
			window.clearTimeout(slow);
			if (my !== seq) return;
			items = rankCommands(list, t.query).map((c) => ({
				key: c.name,
				name: `/${c.name}`,
				detail: c.description,
				badge: badge[c.source],
				choose: () => apply(insertCommand(text, c.name)),
			}));
			note = commands.note;
		} else {
			const pending = commands.args(t.name);
			if (!pending) return close();
			const values = await pending;
			if (my !== seq) return;
			items = rankArgs(values, t.query).map((v) => ({ key: v, name: v, choose: () => apply(insertArg(text, t, v)) }));
			note = undefined;
		}
		active = 0;
	}

	function apply(r: { text: string; caret: number }) {
		text = r.text;
		close();
		onchange(text);
		requestAnimationFrame(() => {
			ta.focus();
			ta.setSelectionRange(r.caret, r.caret);
			grow();
			// After "/model " the models follow.
			suggest();
		});
	}

	function chooseFile(t: LinkTrigger, f: TFile) {
		const linktext = app.metadataCache.fileToLinktext(f, linksFrom ?? "", true);
		apply(insertLink(text, ta.selectionStart, t, linktext));
	}

	// One answer per writing line: a fast double ⌘↵ (or a click during the hand-off) is ignored.
	let sent = false;
	function submit() {
		const v = text.trim();
		if (!v || sent) return;
		sent = true;
		window.setTimeout(() => (sent = false), 1200); // if the line is still here, the answer was not taken
		close();
		onsubmit(v);
	}

	function onkeydown(e: KeyboardEvent) {
		if (items.length) {
			const move = (d: number) => (active = (active + d + items.length) % items.length);
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				e.stopPropagation();
				return move(e.key === "ArrowDown" ? 1 : -1);
			}
			if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) || e.key === "Tab") {
				e.preventDefault();
				e.stopPropagation();
				return items[active]?.choose();
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				return close();
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

<div class="icap-writing" use:keyGuard={{ app, submit, escape: () => (items.length ? close() : onescape ? onescape() : ta.blur()) }}>
	<textarea
		bind:this={ta}
		bind:value={text}
		rows="2"
		aria-label={label}
		{placeholder}
		spellcheck="true"
		role={offers ? "combobox" : undefined}
		aria-expanded={offers ? items.length > 0 : undefined}
		aria-controls={offers ? listId : undefined}
		aria-autocomplete={offers ? "list" : undefined}
		aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
		oninput={() => {
			grow();
			onchange(text);
			suggest();
		}}
		onclick={suggest}
		onblur={() => window.setTimeout(close, 150)}
		{onkeydown}
	></textarea>
	{#if items.length || note}
		<div class="icap-suggest">
			{#if items.length}
				<ul class="icap-link-suggest" id={listId} role="listbox" aria-label={listLabel}>
					{#each items as it, i (it.key)}
						<li role="option" id={`${listId}-${i}`} aria-selected={i === active}>
							<button
								type="button"
								tabindex="-1"
								class:is-active={i === active}
								onmousedown={(e) => {
									e.preventDefault();
									it.choose();
								}}
								onmouseenter={() => (active = i)}
							>
								<span class="icap-link-name">{it.name}</span>
								{#if it.badge}<span class="icap-suggest-badge">{it.badge}</span>{/if}
								{#if it.detail}<span class="icap-link-path">{it.detail}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if note}<p class="icap-suggest-note" aria-live="polite">{note}</p>{/if}
		</div>
	{/if}
	<div class="icap-writing-foot">
		<!-- A touch screen submits with the button; the keycaps are for a keyboard. -->
		{#if !Platform.isMobile}<span class="icap-hint" aria-hidden="true"><Keys /></span>{/if}
		<button type="button" class="icap-link icap-primary" disabled={!text.trim()} onclick={submit}>{submitLabel}</button>
	</div>
</div>
