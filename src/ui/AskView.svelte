<script lang="ts">
	import { L } from "../i18n";
	import { onMount, tick } from "svelte";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import type { LearningRuntime } from "../runtime/runtime";
	import type { AskBlock, Turn } from "../runtime/state.svelte";
	import { verdictGlyph } from "../dsl/blocks";
	import Markdown from "./Markdown.svelte";
	import WritingLine from "./WritingLine.svelte";
	import Choices from "./Choices.svelte";
	import { SUBMIT_KEYS, blockCaption, phaseLine, stopLabel, touchCaption, usageLine } from "./phrases";
	import { Platform } from "obsidian";
	import Keys from "./Keys.svelte";
	import { holdHeight } from "./hold-height";
	import { inertToEditor } from "./keys";
	import { beckon, closeFrame, fluid, inkIn, play, seal, settleIn, spring } from "./motion";
	import type { Answer } from "../runtime/state.svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { diffStats, foldDiff, lineDiff } from "./line-diff";

	interface Props {
		block: AskBlock | null;
		id: string;
		title: string;
		rt: LearningRuntime;
		sourcePath: string;
		host: HTMLElement;
	}
	let { block: initial, id, title, rt, sourcePath, host }: Props = $props();
	// Follow the runtime: an authored block that is started over is replaced in place.
	const block = $derived(rt.blocks.get(id) ?? initial);

	let autofocus = $state(false);
	onMount(() => {
		if (rt.focusOnMount.has(id)) {
			rt.focusOnMount.delete(id);
			if (block?.collapsed) block.collapsed = false;
			autofocus = true;
			host.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
		// Arriving from an edge cue or the Activity panel: mark what needs the learner now.
		const arrive = () => {
			if (block?.collapsed) block.collapsed = false;
			if (block?.phase === "waiting") {
				const turns = section?.querySelectorAll<HTMLElement>(".icap-turn");
				seal(turns?.[turns.length - 1]?.querySelector<HTMLElement>(".icap-question"), 0.2);
			} else if (block?.phase === "completed") {
				seal(section?.querySelector<HTMLElement>(".icap-summary.is-final"), 0.2);
				beckon(actionsEl, 0.3);
			}
		};
		section?.addEventListener("icap-arrive", arrive);
		return () => section?.removeEventListener("icap-arrive", arrive);
	});

	const kindLabel: Record<string, string> = {
		recall: L("recall", "回忆"),
		check: L("check", "检查"),
		quiz: L("understanding check", "理解检验"),
		agent: L("question", "提问"),
		request: L("request", "请求"),
	};

	/* ── request blocks: the files the agent touched, and the follow-up line ── */
	const files = $derived(
		block?.kind === "request"
			? (rt.ledger.get(block.taskId ?? "")?.artifacts ?? []).filter((a) => a.kind === "created" || a.kind === "edited" || a.kind === "deleted")
			: [],
	);
	const usage = $derived(block?.kind === "request" ? usageLine(rt.ledger.get(block.taskId ?? "")?.usage) : "");
	const fileWord: Record<string, string> = { created: L("new", "新建"), edited: L("changed", "修改"), deleted: L("deleted", "删除") };
	/*
	 * Slash commands belong to request blocks only. In a recall, check or quiz the learner's words
	 * are an answer the agent responds to (ICAP); a "/" there is just text.
	 */
	const commands = $derived(block?.kind === "request" ? rt.commandProvider() : undefined);
	const ownSetup = $derived(block?.kind === "request" ? [block.model, block.thinking && `${L("thinking", "思考")} ${block.thinking}`].filter(Boolean).join(" · ") : "");
	let followUpKey = $state(0);
	function sendFollowUp(text: string) {
		if (!block || !text.trim()) return;
		followUpKey++;
		void rt.followUp(block, text);
	}
	const verdictWord: Record<string, string> = { holds: L("holds", "成立"), partly: L("partly", "部分成立"), reconsider: L("look again", "再想想") };

	const working = $derived(!!block && (block.phase === "thinking" || block.phase === "preparing"));
	const awaiting = $derived(block?.awaiting);
	const live = $derived(!!block && ["thinking", "preparing", "waiting"].includes(block.phase));
	const done = $derived(!!block && ["completed", "failed", "cancelled", "interrupted"].includes(block.phase));
	const verdictMark = $derived(block ? [...block.turns].reverse().find((t) => t.verdict)?.verdict : undefined);

	/* ── the recall veil: blur the note, keep this block clear ── */
	$effect(() => {
		if (!block?.veiled) return;
		const view = host.closest(".markdown-source-view, .markdown-reading-view");
		let keep: HTMLElement | null = host;
		while (keep && keep.parentElement && !keep.parentElement.matches(".cm-content, .markdown-preview-sizer")) keep = keep.parentElement;
		view?.classList.add("icap-veiled");
		keep?.classList.add("icap-unveiled");
		return () => {
			view?.classList.remove("icap-veiled");
			keep?.classList.remove("icap-unveiled");
		};
	});

	let draftTimer: number | null = null;
	function saveDraft(turn: Turn, v: string) {
		turn.draft = v;
		if (draftTimer) window.clearTimeout(draftTimer);
		draftTimer = window.setTimeout(() => rt.persist(), 600);
	}

	function submitText(turn: Turn, text: string) {
		if (block) void rt.answer(block, turn, { text });
	}
	function submitChoices(turn: Turn, ids: string[]) {
		if (block) void rt.answer(block, turn, { choices: ids });
	}
	function submitConfirm(turn: Turn, confirmed: boolean) {
		if (block) void rt.answer(block, turn, { confirmed });
	}

	/* An authored recall veils the note when the learner starts writing — once; Esc lifts it for good. */
	let veiledOnce = false;
	function onfocusin(e: FocusEvent) {
		if (!block?.authored || block.kind !== "recall" || veiledOnce || !rt.settings.veilByDefault) return;
		if (!(e.target instanceof HTMLTextAreaElement) || block.turns[0]?.answer) return;
		veiledOnce = true;
		block.veiled = true;
	}

	/** Esc lifts the veil first; a second Esc (or Esc anywhere else in the block) returns to the note. */
	function escape() {
		if (block?.veiled) block.veiled = false;
		else rt.focusEditor(sourcePath);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.stopPropagation();
		escape();
	}

	/*
	 * Folding. What is finished folds to one line; what needs the learner stays open. Earlier rounds
	 * fold (a request with what followed it, or one question), but while the block is live the round
	 * just before the current one stays open: its feedback is what the learner answers from. A decided
	 * change folds to its outcome. Long file lists fold to their counts. The whole block folds to its
	 * header when the learner asks, and opens again when it needs them.
	 */
	function snippet(s: string | undefined, n = 80): string {
		const line = (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
		const plain = line
			.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b || a)
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[*_`#>]+/g, "")
			.replace(/\s+/g, " ")
			.trim();
		return plain.length > n ? `${plain.slice(0, n - 1)}…` : plain;
	}

	interface Round {
		id: string;
		turns: Turn[];
	}
	const rounds = $derived.by(() => {
		const out: Round[] = [];
		if (!block) return out;
		for (const t of block.turns) {
			if (t.final) continue;
			if (!out.length || block.kind !== "request" || t.request) out.push({ id: t.id, turns: [t] });
			else out[out.length - 1].turns.push(t);
		}
		return out;
	});
	/** Rounds the learner opened again; local to this view. */
	const opened = new SvelteSet<string>();
	function foldable(r: Round, i: number): boolean {
		if (awaiting && r.turns.includes(awaiting)) return false;
		const keepOpen = live || awaiting ? 2 : 1;
		return i < rounds.length - keepOpen;
	}

	function letters(t: Turn): string {
		return (t.answer?.choices ?? []).map((c) => String.fromCharCode(97 + Math.max(0, t.options?.findIndex((o) => o.id === c) ?? 0))).join(", ");
	}
	function decisionWord(t: Turn): string {
		if (!t.answer) return "";
		return t.answer.confirmed ? (t.confirmLabel ?? (t.kind === "review" ? L("accepted", "已采纳") : L("yes", "好"))) : (t.cancelLabel ?? (t.kind === "review" ? L("declined", "未采纳") : L("no", "暂不")));
	}
	function changeStats(t: Turn): string {
		if (!t.review) return "";
		const s = diffStats(lineDiff(t.review.find, t.review.replace));
		return `+${s.add} −${s.del}`;
	}
	function roundLine(r: Round): { kind: string; text: string; meta: string } {
		const t = r.turns[0];
		if (t.request) {
			const reviews = r.turns.filter((x) => x.kind === "review" && x.answer);
			const meta = reviews.length === 1 ? `${L("change", "修改")} ${decisionWord(reviews[0])}` : reviews.length ? L(`${reviews.length} changes`, `${reviews.length} 处修改`) : "";
			return { kind: t.control ? L("command", "命令") : kindLabel.request, text: snippet(t.answer?.text), meta };
		}
		if (t.kind === "review" && t.review) return { kind: L("proposed change", "建议修改"), text: t.review.path.replace(/\.md$/, ""), meta: [decisionWord(t), changeStats(t)].filter(Boolean).join(" · ") };
		const answer = t.kind === "single" || t.kind === "multi" ? letters(t) : t.kind === "confirm" ? decisionWord(t) : t.inNote ? "" : snippet(t.answer?.text, 36);
		return {
			kind: L("question", "问题"),
			text: t.inNote ? L("your explanation above", "你在上面写的解释") : snippet(t.question),
			meta: [answer, t.verdict ? verdictGlyph(t.verdict) : ""].filter(Boolean).join(" · "),
		};
	}

	/** Open or fold a round again: folding fades the words first, then the frame closes the gap. */
	async function toggleRound(id: string) {
		if (opened.has(id)) {
			await play(section?.querySelector(`[data-round-body="${id}"]`), { opacity: 0 }, spring.fade).finished;
			opened.delete(id);
		} else {
			opened.add(id);
			await tick();
			play(section?.querySelector(`[data-round-body="${id}"]`), { opacity: [0, 1], y: [-3, 0] }, spring.settle);
		}
	}

	/** Decided changes the learner opened again, and unchanged stretches they unfolded. */
	const openDiffs = new SvelteSet<string>();
	const openGaps = new SvelteSet<string>();
	let filesOpen = $state(false);
	const fileCounts = $derived(
		(["created", "edited", "deleted"] as const)
			.map((k) => [k, files.filter((f) => f.kind === k).length] as const)
			.filter(([, n]) => n > 0)
			.map(([k, n]) => `${fileWord[k]} ${n}`)
			.join(" · "),
	);

	/* The whole block, folded to its header line (kept across reloads). */
	let body = $state<HTMLElement | null>(null);
	let foldToken = 0;
	async function toggleBlock() {
		if (!block) return;
		const token = ++foldToken;
		if (!block.collapsed) {
			await play(body, { opacity: 0 }, spring.fade).finished;
			if (token !== foldToken) return;
			block.collapsed = true;
		} else {
			block.collapsed = false;
			await tick();
			play(body, { opacity: [0, 1], y: [-3, 0] }, spring.settle);
		}
		rt.persist();
	}
	// A folded block opens when it needs the learner: a question, a change to decide, a final version.
	$effect(() => {
		if (block?.collapsed && awaiting && block.phase !== "idle") {
			block.collapsed = false;
			rt.persist();
		}
	});
	const foldedStatus = $derived(!block ? "" : working ? L("working…", "进行中…") : blockCaption(block.phase, block.kind, false, !!block.error).split(SUBMIT_KEYS)[0].replace(/[—–-]\s*$/, "").trim());

	const caption = $derived(
		!block || working
			? ""
			: awaiting && (awaiting.kind === "confirm" || awaiting.kind === "review")
				? L("your turn", "轮到你了")
				: blockCaption(block.phase, block.kind, !!awaiting?.draft, !!block.error),
	);

	/*
	 * Guidance at the hand-offs. When the agent hands the turn to the learner, its question is
	 * sealed and the answer surface rises in after it; when it finishes, the summary is sealed and
	 * the next steps are offered with the primary one underlined.
	 */
	// svelte-ignore state_referenced_locally
	let prevPhase = block?.phase;
	$effect(() => {
		const ph = block?.phase;
		const was = prevPhase;
		prevPhase = ph;
		if (!ph || was === ph) return;
		const fromWork = was === "thinking" || was === "preparing";
		if (ph === "waiting" && fromWork) {
			void tick().then(() => {
				const turns = section?.querySelectorAll<HTMLElement>(".icap-turn");
				const last = turns?.[turns.length - 1];
				seal(last?.querySelector<HTMLElement>(".icap-question"), 0.35);
				play(last?.querySelector(".icap-choices, .icap-writing, .icap-confirm"), { opacity: [0, 1], y: [8, 0] }, { ...spring.settle, delay: 0.3 });
			});
		} else if (ph === "completed" && (fromWork || was === "waiting")) {
			void tick().then(() => {
				seal(section?.querySelector<HTMLElement>(".icap-summary.is-final"), 0.45);
				beckon(actionsEl, 0.55);
			});
		}
	});

	/* ── exits: the interaction retreats, the note closes the gap ── */
	let frame = $state<HTMLElement | null>(null);
	let section = $state<HTMLElement | null>(null);
	let actionsEl = $state<HTMLElement | null>(null);
	let leaving = false;

	async function clear() {
		if (!block || leaving) return;
		// An authored block starts over in place; the page simply follows its new height.
		if (block.authored) return void rt.clearBlock(block);
		leaving = true;
		rt.stopBlock(block);
		await closeFrame(frame, section);
		await rt.clearBlock(block);
	}

	async function keep() {
		if (!block || leaving) return;
		leaving = true;
		await play(actionsEl, { opacity: 0 }, spring.fade).finished;
		await rt.keepBlock(block);
		leaving = false;
	}

	/**
	 * A proposed change settles when the learner decides: on "apply", the removed lines fold away
	 * and the added lines lose their wash — they are now simply the note; on "leave it", the
	 * proposal fades back. Writing the file re-renders this block, so the settle plays first and
	 * the change is written as it ends; decided reviews render in their settled state.
	 */
	function settledDiff(node: HTMLElement, answer: Answer | undefined) {
		const set = (a: Answer | undefined) => {
			node.classList.toggle("is-applied", !!a?.confirmed);
			node.classList.toggle("is-declined", !!a && !a.confirmed);
		};
		set(answer);
		return { update: set };
	}

	let deciding = false;
	async function decide(turn: Turn, confirmed: boolean) {
		if (!block || deciding) return;
		deciding = true;
		const diff = section?.querySelector<HTMLElement>(`[data-diff="${turn.id}"]`);
		if (diff) {
			const dels = Array.from(diff.querySelectorAll(".icap-diff-del"));
			const adds = Array.from(diff.querySelectorAll(".icap-diff-add"));
			if (confirmed) {
				play(adds, { backgroundColor: "rgba(0, 0, 0, 0)" }, spring.settle);
				await play(dels, { opacity: 0, x: -6 }, spring.quick).finished;
			} else {
				await play(adds, { opacity: 0.45 }, spring.quick).finished;
			}
		}
		deciding = false;
		submitConfirm(turn, confirmed);
	}
</script>

{#if !block}
	<section class="icap-voice icap-ask is-orphan" data-ask={id}>
		<header class="icap-label"><span class="icap-label-kind">interaction</span><span class="icap-label-term">{title}</span></header>
		<p class="icap-caption">
			This interaction has ended or lives on another device.
			<button type="button" class="icap-link" onclick={() => rt.removeOrphan(sourcePath, id)}>remove it</button>
		</p>
	</section>
{:else}
	<div class="icap-frame" bind:this={frame} use:fluid={`b:${id}`}>
	<div>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<section
		bind:this={section}
		class="icap-ask"
		class:is-collapsed={block.collapsed}
		tabindex="-1"
		use:inertToEditor
		data-ask={id}
		data-phase={block.phase}
		aria-label="{kindLabel[block.kind]}: {block.topic}"
		aria-busy={working}
		{onkeydown}
		{onfocusin}
	>
		<header class="icap-label" class:icap-voice={working && !block.turns.length} class:is-drawing={working && !block.turns.length} use:settleIn={`bh:${id}`}>
			<button type="button" class="icap-label-btn" aria-expanded={!block.collapsed} title={block.collapsed ? L("Expand", "展开") : L("Fold", "折叠")} onclick={toggleBlock}>
				<span class="icap-label-kind">{block.kind === "agent" && block.turns.some((t) => t.kind === "review") ? L("review", "修改审查") : kindLabel[block.kind]}</span>
				<!-- a request's own words follow right below; the header repeats them only when folded -->
				{#if block.kind !== "request"}<span class="icap-label-term">{block.topic}</span>
				{:else if block.collapsed}<span class="icap-label-term">{snippet(block.turns.find((t) => t.request)?.answer?.text ?? block.topic)}</span>{/if}
			</button>
			{#if block.collapsed && foldedStatus}<span class="icap-label-meta" use:settleIn>{foldedStatus}</span>{/if}
			{#if ownSetup && !block.collapsed}<span class="icap-label-meta" title={L("This block's own model and thinking (/model, /thinking)", "这个块自己的模型与思考强度（/model、/thinking）")}>{ownSetup}</span>{/if}
			{#if block.kind === "recall" && awaiting && !block.collapsed}
				<button
					type="button"
					class="icap-link icap-veil-toggle"
					aria-pressed={block.veiled}
					title={block.veiled ? L("Lift the veil and look at the note (Esc)", "取消模糊，查看笔记（Esc）") : L("Veil the note while you write", "书写时模糊笔记")}
					onclick={() => (block.veiled = !block.veiled)}
				>
					{#if block.veiled}<EyeOff size={13} aria-hidden="true" /> {L("veiled", "已模糊")}{:else}<Eye size={13} aria-hidden="true" /> {L("veil note", "模糊笔记")}{/if}
				</button>
			{/if}
		</header>

		{#snippet turnView(turn: Turn, i: number)}
			<div class="icap-turn" class:is-final={turn.final} data-kind={turn.kind}>
				{#if turn.kind === "review" && turn.review && turn.answer}
					<!-- A decided change: its outcome on one line; it can be opened again. -->
					<button type="button" class="icap-fold-row" aria-expanded={openDiffs.has(turn.id)} onclick={() => (openDiffs.has(turn.id) ? openDiffs.delete(turn.id) : openDiffs.add(turn.id))}>
						<span class="icap-fold-kind">{L("proposed change", "建议修改")}</span>
						<span class="icap-fold-text">{turn.review.path.replace(/\.md$/, "")}</span>
						<span class="icap-fold-meta">{decisionWord(turn)} · {changeStats(turn)}</span>
					</button>
				{/if}
				{#if turn.kind === "review" && turn.review && turn.answer && !openDiffs.has(turn.id)}
					<!-- folded -->
				{:else if turn.inNote}
					<p class="icap-ref">{L("↑ checking the explanation you wrote above", "↑ 正在检查你在上面写的解释")}</p>
				{:else if turn.question}
					<div class="icap-voice icap-question" use:inkIn={{ key: `q:${turn.id}`, delay: i > 0 ? 0.12 : 0 }}>
						{#if turn.kind === "review" && turn.review && !turn.answer}
							<p class="icap-review-title">{L("Proposed change to", "建议修改")} <button type="button" class="icap-link" onclick={() => rt.openPath(turn.review!.path)}>{turn.review.path.replace(/\.md$/, "")}</button></p>
						{/if}
						<Markdown app={rt.app} markdown={turn.question} {sourcePath} />
					</div>
				{/if}

				{#if turn.kind === "review" && turn.review && !(turn.answer && !openDiffs.has(turn.id))}
					<!-- Only the changed lines and two lines around them; longer unchanged stretches fold. -->
					<div class="icap-diff" aria-label={L("Proposed change", "建议的修改")} data-diff={turn.id} use:settledDiff={turn.answer}>
						{#each foldDiff(lineDiff(turn.review.find, turn.review.replace)) as item, k}
							{#if item.t === "gap"}
								{#if openGaps.has(`${turn.id}:${k}`)}
									{#each item.lines as l}<div class="icap-diff-same"><span aria-hidden="true"> </span>{l.text || " "}</div>{/each}
								{:else}
									<button type="button" class="icap-diff-gap" onclick={() => openGaps.add(`${turn.id}:${k}`)}>{L(`… ${item.lines.length} unchanged lines`, `… ${item.lines.length} 行未改动`)}</button>
								{/if}
							{:else}
								<div class="icap-diff-{item.t}"><span aria-hidden="true">{item.t === "add" ? "+" : item.t === "del" ? "−" : " "}</span>{item.text || " "}</div>
							{/if}
						{/each}
					</div>
				{/if}

				{#if (turn.kind === "single" || turn.kind === "multi") && (turn.answer || awaiting === turn)}
					<!-- One list from question to answer: submitting locks it in place rather than swapping it. -->
					<Choices
						app={rt.app}
						{sourcePath}
						multi={turn.kind === "multi"}
						options={turn.options ?? []}
						chosen={turn.answer?.choices ?? turn.draftChoices ?? []}
						locked={!!turn.answer}
						autofocus={!turn.answer && (autofocus || i > 0)}
						label={turn.answer ? L("Your answer", "你的回答") : turn.kind === "multi" ? L("Choose all that apply", "选出所有符合的") : L("Choose one", "选一个")}
						onchange={(ids) => (turn.draftChoices = ids)}
						onsubmit={(ids) => submitChoices(turn, ids)}
					/>
				{:else if turn.answer}
					{#if turn.inNote}
						<!-- the learner's words are in the note itself -->
					{:else if turn.kind === "review"}
						<!-- the outcome is on the change's own line -->
					{:else if turn.kind === "confirm"}
						<p class="icap-learner icap-decision" use:settleIn={`a:${turn.id}`}>→ {decisionWord(turn)}</p>
					{:else}
						<div class="icap-learner" use:settleIn={`a:${turn.id}`}><Markdown app={rt.app} markdown={turn.answer.text ?? ""} {sourcePath} /></div>
					{/if}
				{:else if awaiting === turn}
					{#if turn.kind === "text"}
						<WritingLine
							app={rt.app}
							value={turn.draft ?? ""}
							placeholder={turn.placeholder ?? (turn.revise ? L("Revise your explanation…", "修改你的解释…") : L("Your answer…", "你的回答…"))}
							label={turn.request ? L("Your request", "你的请求") : turn.revise ? L("Revise your explanation", "修改你的解释") : L("Your answer", "你的回答")}
							submitLabel={turn.final ? (block.kind === "check" ? L("update my note", "更新我的笔记") : L("keep in note", "留在笔记里")) : turn.request ? L("send", "发送") : turn.revise ? L("submit revision", "提交修改") : L("submit", "提交")}
							autofocus={autofocus || i > 0}
							onchange={(v) => saveDraft(turn, v)}
							onsubmit={(v) => submitText(turn, v)}
							onescape={escape}
							linksFrom={turn.request ? sourcePath : undefined}
							commands={turn.request ? commands : undefined}
						/>
					{:else}
						<div class="icap-confirm" role="group" aria-label={L("Decision", "决定")}>
							<!-- svelte-ignore a11y_autofocus -->
							<button type="button" class="icap-link icap-primary" autofocus={autofocus || i > 0} onclick={() => (turn.kind === "review" ? decide(turn, true) : submitConfirm(turn, true))}>
								{turn.confirmLabel ?? (turn.kind === "review" ? L("apply change", "应用修改") : L("yes, go ahead", "好，继续"))}
							</button>
							<span class="icap-dot" aria-hidden="true">·</span>
							<button type="button" class="icap-link" onclick={() => (turn.kind === "review" ? decide(turn, false) : submitConfirm(turn, false))}>{turn.cancelLabel ?? (turn.kind === "review" ? L("leave the note as is", "保持笔记原样") : L("not now", "暂不"))}</button>
						</div>
					{/if}
				{/if}

				{#if turn.feedback}
					<div class="icap-voice icap-feedback" data-verdict={turn.verdict ?? "none"} use:inkIn={`f:${turn.id}`}>
						{#if turn.verdict}
							<span class="icap-verdict" title={verdictWord[turn.verdict]}><span aria-hidden="true">{verdictGlyph(turn.verdict)}</span><span class="icap-verdict-word">{verdictWord[turn.verdict]}</span></span>
						{/if}
						<Markdown app={rt.app} markdown={turn.feedback} {sourcePath} />
					</div>
				{/if}

				{#if turn.reply && turn.control}
					<div class="icap-control-note" use:settleIn={`r:${turn.id}`}>
						<Markdown app={rt.app} markdown={turn.reply} {sourcePath} />
					</div>
				{:else if turn.reply}
					<div class="icap-voice icap-summary is-final">
						<Markdown app={rt.app} markdown={turn.reply} {sourcePath} />
					</div>
				{/if}
			</div>
		{/snippet}

		{#if !block.collapsed}
		<div class="icap-ask-body" bind:this={body}>
		{#each rounds as r, ri (r.id)}
			{@const canFold = foldable(r, ri)}
			{@const folded = canFold && !opened.has(r.id)}
			{#if canFold}
				{@const line = roundLine(r)}
				<button type="button" class="icap-fold-row" aria-expanded={!folded} onclick={() => toggleRound(r.id)}>
					<span class="icap-fold-kind">{line.kind}</span>
					<span class="icap-fold-text">{line.text}</span>
					{#if line.meta}<span class="icap-fold-meta">{line.meta}</span>{/if}
				</button>
			{/if}
			{#if !folded}
				<div class="icap-round" class:is-reopened={canFold} data-round-body={r.id}>
					{#each r.turns as turn (turn.id)}{@render turnView(turn, block.turns.indexOf(turn))}{/each}
				</div>
			{/if}
		{/each}

		{#if working}
			<div class="icap-voice icap-summary" class:is-drawing={true} use:holdHeight={working} use:settleIn={`w:${id}:${block.turns.length}`}>
				{#if block.summary.trim()}
					<Markdown app={rt.app} markdown={block.summary} {sourcePath} streaming />
				{:else}
					<p class="icap-pending" aria-live="polite">{block.phase === "preparing" && !block.agentPhase ? L("preparing questions…", "正在准备问题…") : phaseLine(block.agentPhase, block.kind === "quiz" || block.kind === "request" ? block.kind : "check")}</p>
				{/if}
			</div>
		{:else if block.summary.trim() && (block.phase === "completed" || block.phase === "finalizing")}
			<div class="icap-voice icap-summary is-final" data-verdict={verdictMark ?? "none"} use:inkIn={`s:${id}`}>
				{#if block.turns.length && block.kind !== "request"}<div class="icap-sublabel">{L("in sum", "总结")}</div>{/if}
				<Markdown app={rt.app} markdown={block.summary} {sourcePath} />
			</div>
		{/if}

		{#if files.length > 3}
			<button type="button" class="icap-fold-row icap-files-sum" aria-expanded={filesOpen} onclick={() => (filesOpen = !filesOpen)}>
				<span class="icap-fold-kind">{L("files", "文件")}</span>
				<span class="icap-fold-text">{fileCounts}</span>
			</button>
		{/if}
		{#if files.length && (files.length <= 3 || filesOpen)}
			<ul class="icap-row-artifacts icap-files" aria-label={L("Files the agent touched", "Agent 改动的文件")}>
				{#each files as a (a.path + a.kind)}
					<li use:settleIn={`art:${block.taskId}:${a.kind}:${a.path}`}>
						<span class="icap-artifact-kind">{fileWord[a.kind]}</span>
						{#if a.kind === "deleted"}
							<span>{a.label}</span>
						{:else}
							<button type="button" class="icap-link" onclick={() => rt.openPath(a.path)}>{a.label}</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if usage && block.phase !== "thinking" && block.phase !== "preparing"}
			<p class="icap-usage" title={L("Tokens, share of the prompt read from the cache, and price for this conversation so far. ≈ marks an estimate from list prices.", "这段对话到目前为止的 token、提示词的缓存命中比例和价格。≈ 表示按公开价目估算。")}>{usage}</p>
		{/if}

		{#if block.kind === "request" && block.phase === "completed"}
			{#key followUpKey}
				<WritingLine
					app={rt.app}
					value=""
					placeholder={L("Follow up… ([[ to link a file, / for commands)", "继续追问…（[[ 链接文件，/ 使用命令）")}
					label={L("Follow up", "追问")}
					submitLabel={L("send", "发送")}
					autofocus={false}
					onchange={() => undefined}
					onsubmit={sendFollowUp}
					onescape={escape}
					linksFrom={sourcePath}
					{commands}
				/>
			{/key}
		{/if}

		{#each block.turns.filter((t) => t.final) as turn (turn.id)}{@render turnView(turn, 1)}{/each}

		{#if block.error}
			<p class="icap-error" role="alert" use:settleIn>{block.error}</p>
		{/if}

		<div class="icap-actions" role="toolbar" aria-label={L("Interaction actions", "交互操作")} bind:this={actionsEl}>
			<span class="icap-caption" aria-live="polite">
				{#key caption}<span class="icap-roll" use:settleIn>{#each (Platform.isMobile ? touchCaption(caption) : caption).split(SUBMIT_KEYS) as part, i}{#if i}<Keys />{/if}{#if part}<span>{part}</span>{/if}{/each}</span>{/key}
			</span>
			{#if live}
				<button type="button" class="icap-link is-quiet" onclick={() => rt.stopBlock(block)}>{stopLabel(block.agentPhase)}</button>
			{:else if done}
				{#if block.phase === "completed"}
					{#if block.kind === "recall"}
						<button type="button" class="icap-link icap-primary" onclick={() => rt.beginFinal(block)} title={L("Write the version of your explanation you now stand behind; it replaces this interaction in the note", "写下你现在认可的解释版本；它会在笔记中替换这段交互")}>{L("write it up", "整理成文")}</button>
					{:else if block.kind === "check"}
						<button type="button" class="icap-link icap-primary" onclick={() => rt.beginFinal(block)} title={L("Rewrite your paragraph in the note yourself; the feedback is kept below it", "自己在笔记中改写这段话；反馈保留在下方")}>{L("revise my words", "修改我的说法")}</button>
						<span class="icap-dot" aria-hidden="true">·</span>
						<button type="button" class="icap-link" onclick={keep} title={L("Leave your paragraph as is and keep the feedback below it", "保持原段落不变，把反馈保留在下方")}>{L("keep feedback", "保留反馈")}</button>
					{:else if block.kind === "request"}
						<button type="button" class="icap-link" onclick={keep} title={L("Replace this block with a plain Markdown record: your requests, the replies and the files", "把这个块替换为普通 Markdown 记录：你的请求、回复和涉及的文件")}>{L("keep a record", "保留记录")}</button>
					{:else}
						<button type="button" class="icap-link icap-primary" onclick={keep} title={L("Replace this interaction with plain Markdown: the result and the feedback", "把这段交互替换为普通 Markdown：结果和反馈")}>{L("keep in note", "留在笔记里")}</button>
					{/if}
					<span class="icap-dot" aria-hidden="true">·</span>
					{#if block.kind !== "agent" && block.kind !== "request"}
						<button type="button" class="icap-link" onclick={() => rt.blockToNote(block)} title={L("Create a learning note from this interaction", "用这段交互新建一篇学习笔记")}>{L("make a note", "写成笔记")}</button>
					{/if}
				{:else}
					<button type="button" class="icap-link icap-primary" onclick={() => rt.resume(block)}>{block.phase === "failed" ? L("try again", "重试") : L("continue", "继续")}</button>
					<span class="icap-dot" aria-hidden="true">·</span>
				{/if}
				<button type="button" class="icap-link is-quiet" onclick={clear} title={block.authored ? L("Start this exercise over", "重新开始这个练习") : L("Remove the interaction from the note", "从笔记中移除这段交互")}>{block.authored ? L("start over", "重新开始") : L("clear", "清除")}</button>
			{:else if block.phase === "finalizing"}
				<button type="button" class="icap-link" onclick={keep} title={L("Keep your words unchanged, with the feedback", "保持你的原话不变，附上反馈")}>{block.kind === "check" ? L("leave it as is", "保持原样") : L("keep my first answer", "保留我的第一次回答")}</button>
				<button type="button" class="icap-link is-quiet" onclick={() => rt.cancelFinal(block)}>{L("back", "返回")}</button>
			{:else if block.phase === "idle" && !block.authored}
				<button type="button" class="icap-link is-quiet" onclick={clear}>{L("not now", "暂不")}</button>
			{/if}
		</div>
		</div>
		{/if}
	</section>
	</div>
	</div>
{/if}
