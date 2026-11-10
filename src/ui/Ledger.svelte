<script lang="ts">
	import { L, isZh } from "../i18n";
	import { tick } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import type { LearningRuntime } from "../runtime/runtime";
	import type { Task } from "../runtime/state.svelte";
	import { ago, phaseLine, statusWord, stopLabel } from "./phrases";
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
		const tick$ = window.setInterval(() => (now = Date.now()), 30000);
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

	function line(t: Task) {
		if (t.status === "processing") return t.title;
		if (t.status === "waiting") return t.title;
		return t.outcome || t.title;
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
			<p class="icap-ledger-empty">
				{#if isZh()}
					还没有任何活动。选中一段文字后选择<em>解释</em>，或者读完一节后运行<em>凭记忆复述</em>。
				{:else}
					Nothing yet. Select a passage and choose <em>explain</em>, or run <em>Recall from memory</em> after reading a section.
				{/if}
			</p>
		{/if}

		{#snippet row(t: Task)}
			<li class="icap-row" data-status={t.status} use:rowIn={`row:${t.id}:${t.status}`}>
				{#if t.status === "completed"}
					<svg class="icap-row-check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.6 L5 9.4 L10.2 2.6" use:strokeIn={`done:${t.id}`} /></svg>
				{:else}
					<span class="icap-row-glyph" aria-hidden="true"></span>
				{/if}
				<div class="icap-row-main">
					<p class="icap-row-line">
						{#if t.status === "waiting" || t.blockId || t.glossId}
							<button type="button" class="icap-row-title" onclick={() => go(t)}>{line(t)}</button>
						{:else}
							<span class="icap-row-title">{line(t)}</span>
						{/if}
					</p>
					<p class="icap-row-meta">
						{#if t.status === "processing"}
							<span>{phaseLine(t.phase, t.kind === "explain" || t.kind === "quiz" || t.kind === "note" || t.kind === "request" || t.kind === "read" ? t.kind : "check")}</span>
						{:else if t.status === "waiting"}
							<span class="icap-row-status">{statusWord(t.status)}</span>
						{:else if t.status !== "completed"}
							<span class="icap-row-status" title={t.interrupted ? (t.error ?? L("Obsidian closed while this was running", "运行时 Obsidian 被关闭")) : undefined}>{t.interrupted ? L("interrupted", "已中断") : statusWord(t.status)}</span>
						{/if}
						<span>{L("in", "于")} <button type="button" class="icap-link" onclick={() => rt.openPath(t.notePath)}>{noteName(t.notePath)}</button></span>
						<span class="icap-row-time">{ago(t.endedAt ?? t.createdAt, now)}</span>
					</p>
					{#if t.error}<p class="icap-row-error">{t.error}</p>{/if}
					{#if t.artifacts.some((a) => a.kind === "created" || a.kind === "edited" || a.kind === "deleted")}
						<ul class="icap-row-artifacts">
							{#each t.artifacts.filter((a) => a.kind === "created" || a.kind === "edited" || a.kind === "deleted") as a (a.path + a.kind)}
								<li use:settleIn={`art:${t.id}:${a.kind}:${a.path}`}>
									<span class="icap-artifact-kind">{a.kind === "created" ? L("new", "新建") : a.kind === "edited" ? L("changed", "修改") : L("deleted", "删除")}</span>
									{#if a.kind === "deleted"}
										<span>{a.label}</span>
									{:else}
										<button type="button" class="icap-link" onclick={() => rt.openPath(a.path)}>{a.label}</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					<!-- The agent's tool calls: closed by default, here only — the note never shows them. -->
					{#if t.steps.length}
						<details class="icap-row-steps">
							<summary>{L(`${t.steps.length + t.stepsDropped} steps`, `${t.steps.length + t.stepsDropped} 个步骤`)}</summary>
							<ol start={t.stepsDropped + 1}>
								{#each t.steps as s, i (i)}
									<li><span class="icap-step-tool">{s.tool}</span>{#if s.detail}<span class="icap-step-detail">{s.detail}</span>{/if}</li>
								{/each}
							</ol>
						</details>
					{/if}
				</div>
				<div class="icap-row-actions">
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
