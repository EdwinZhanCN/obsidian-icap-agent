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
	import { blockCaption, phaseLine } from "./phrases";
	import { holdHeight } from "./hold-height";
	import { inertToEditor } from "./keys";
	import { beckon, closeFrame, fluid, inkIn, play, seal, settleIn, spring } from "./motion";
	import type { Answer } from "../runtime/state.svelte";

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
			autofocus = true;
			host.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
		// Arriving from an edge cue or the Activity panel: mark what needs the learner now.
		const arrive = () => {
			if (block?.phase === "waiting") {
				const turns = section?.querySelectorAll<HTMLElement>(".icpa-turn");
				seal(turns?.[turns.length - 1]?.querySelector<HTMLElement>(".icpa-question"), 0.2);
			} else if (block?.phase === "completed") {
				seal(section?.querySelector<HTMLElement>(".icpa-summary.is-final"), 0.2);
				beckon(actionsEl, 0.3);
			}
		};
		section?.addEventListener("icpa-arrive", arrive);
		return () => section?.removeEventListener("icpa-arrive", arrive);
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
	const fileWord: Record<string, string> = { created: L("new", "新建"), edited: L("changed", "修改"), deleted: L("deleted", "删除") };
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
		view?.classList.add("icpa-veiled");
		keep?.classList.add("icpa-unveiled");
		return () => {
			view?.classList.remove("icpa-veiled");
			keep?.classList.remove("icpa-unveiled");
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

	function diffLines(s: string) {
		return s.split("\n");
	}

	const caption = $derived(
		!block || working
			? ""
			: awaiting && (awaiting.kind === "confirm" || awaiting.kind === "review")
				? L("your turn", "轮到你了")
				: blockCaption(block.phase, block.kind, !!awaiting?.draft),
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
				const turns = section?.querySelectorAll<HTMLElement>(".icpa-turn");
				const last = turns?.[turns.length - 1];
				seal(last?.querySelector<HTMLElement>(".icpa-question"), 0.35);
				play(last?.querySelector(".icpa-choices, .icpa-writing, .icpa-confirm"), { opacity: [0, 1], y: [8, 0] }, { ...spring.settle, delay: 0.3 });
			});
		} else if (ph === "completed" && (fromWork || was === "waiting")) {
			void tick().then(() => {
				seal(section?.querySelector<HTMLElement>(".icpa-summary.is-final"), 0.45);
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
			const dels = Array.from(diff.querySelectorAll(".icpa-diff-del"));
			const adds = Array.from(diff.querySelectorAll(".icpa-diff-add"));
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
	<section class="icpa-voice icpa-ask is-orphan" data-ask={id}>
		<header class="icpa-label"><span class="icpa-label-kind">interaction</span><span class="icpa-label-term">{title}</span></header>
		<p class="icpa-caption">
			This interaction has ended or lives on another device.
			<button type="button" class="icpa-link" onclick={() => rt.removeOrphan(sourcePath, id)}>remove it</button>
		</p>
	</section>
{:else}
	<div class="icpa-frame" bind:this={frame} use:fluid={`b:${id}`}>
	<div>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<section
		bind:this={section}
		class="icpa-ask"
		tabindex="-1"
		use:inertToEditor
		data-ask={id}
		data-phase={block.phase}
		aria-label="{kindLabel[block.kind]}: {block.topic}"
		aria-busy={working}
		{onkeydown}
		{onfocusin}
	>
		<header class="icpa-label" class:icpa-voice={working && !block.turns.length} class:is-drawing={working && !block.turns.length} use:settleIn={`bh:${id}`}>
			<span class="icpa-label-kind">{block.kind === "agent" && block.turns.some((t) => t.kind === "review") ? L("review", "修改审查") : kindLabel[block.kind]}</span>
			<!-- a request's own words follow right below; the header doesn't repeat them -->
			{#if block.kind !== "request"}<span class="icpa-label-term">{block.topic}</span>{/if}
			{#if block.kind === "recall" && awaiting}
				<button
					type="button"
					class="icpa-link icpa-veil-toggle"
					aria-pressed={block.veiled}
					title={block.veiled ? L("Lift the veil and look at the note (Esc)", "取消模糊，查看笔记（Esc）") : L("Veil the note while you write", "书写时模糊笔记")}
					onclick={() => (block.veiled = !block.veiled)}
				>
					{#if block.veiled}<EyeOff size={13} aria-hidden="true" /> veiled{:else}<Eye size={13} aria-hidden="true" /> veil note{/if}
				</button>
			{/if}
		</header>

		{#snippet turnView(turn: Turn, i: number)}
			<div class="icpa-turn" class:is-final={turn.final} data-kind={turn.kind}>
				{#if turn.inNote}
					<p class="icpa-ref">{L("↑ checking the explanation you wrote above", "↑ 正在检查你在上面写的解释")}</p>
				{:else if turn.question}
					<div class="icpa-voice icpa-question" use:inkIn={{ key: `q:${turn.id}`, delay: i > 0 ? 0.12 : 0 }}>
						{#if turn.kind === "review" && turn.review}
							<p class="icpa-review-title">{L("Proposed change to", "建议修改")} <button type="button" class="icpa-link" onclick={() => rt.openPath(turn.review!.path)}>{turn.review.path.replace(/\.md$/, "")}</button></p>
						{/if}
						<Markdown app={rt.app} markdown={turn.question} {sourcePath} />
					</div>
				{/if}

				{#if turn.kind === "review" && turn.review}
					<div class="icpa-diff" aria-label={L("Proposed change", "建议的修改")} data-diff={turn.id} use:settledDiff={turn.answer}>
						{#if turn.review.find}
							{#each diffLines(turn.review.find) as l}<div class="icpa-diff-del"><span aria-hidden="true">−</span>{l || " "}</div>{/each}
						{/if}
						{#each diffLines(turn.review.replace) as l}<div class="icpa-diff-add"><span aria-hidden="true">+</span>{l || " "}</div>{/each}
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
					{:else if turn.kind === "confirm" || turn.kind === "review"}
						<p class="icpa-learner icpa-decision" use:settleIn={`a:${turn.id}`}>→ {turn.answer.confirmed ? (turn.confirmLabel ?? (turn.kind === "review" ? "accepted" : "yes")) : (turn.cancelLabel ?? (turn.kind === "review" ? "declined" : "no"))}</p>
					{:else}
						<div class="icpa-learner" use:settleIn={`a:${turn.id}`}><Markdown app={rt.app} markdown={turn.answer.text ?? ""} {sourcePath} /></div>
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
						/>
					{:else}
						<div class="icpa-confirm" role="group" aria-label={L("Decision", "决定")}>
							<!-- svelte-ignore a11y_autofocus -->
							<button type="button" class="icpa-link icpa-primary" autofocus={autofocus || i > 0} onclick={() => (turn.kind === "review" ? decide(turn, true) : submitConfirm(turn, true))}>
								{turn.confirmLabel ?? (turn.kind === "review" ? L("apply change", "应用修改") : L("yes, go ahead", "好，继续"))}
							</button>
							<span class="icpa-dot" aria-hidden="true">·</span>
							<button type="button" class="icpa-link" onclick={() => (turn.kind === "review" ? decide(turn, false) : submitConfirm(turn, false))}>{turn.cancelLabel ?? (turn.kind === "review" ? L("leave the note as is", "保持笔记原样") : L("not now", "暂不"))}</button>
						</div>
					{/if}
				{/if}

				{#if turn.feedback}
					<div class="icpa-voice icpa-feedback" data-verdict={turn.verdict ?? "none"} use:inkIn={`f:${turn.id}`}>
						{#if turn.verdict}
							<span class="icpa-verdict" title={verdictWord[turn.verdict]}><span aria-hidden="true">{verdictGlyph(turn.verdict)}</span><span class="icpa-verdict-word">{verdictWord[turn.verdict]}</span></span>
						{/if}
						<Markdown app={rt.app} markdown={turn.feedback} {sourcePath} />
					</div>
				{/if}

				{#if turn.reply}
					<div class="icpa-voice icpa-summary is-final">
						<Markdown app={rt.app} markdown={turn.reply} {sourcePath} />
					</div>
				{/if}
			</div>
		{/snippet}

		{#each block.turns.filter((t) => !t.final) as turn, i (turn.id)}{@render turnView(turn, i)}{/each}

		{#if working}
			<div class="icpa-voice icpa-summary" class:is-drawing={true} use:holdHeight={working} use:settleIn={`w:${id}:${block.turns.length}`}>
				{#if block.summary.trim()}
					<Markdown app={rt.app} markdown={block.summary} {sourcePath} streaming />
				{:else}
					<p class="icpa-pending" aria-live="polite">{block.phase === "preparing" && !block.agentPhase ? L("preparing questions…", "正在准备问题…") : phaseLine(block.agentPhase, block.kind === "quiz" || block.kind === "request" ? block.kind : "check")}</p>
				{/if}
			</div>
		{:else if block.summary.trim() && (block.phase === "completed" || block.phase === "finalizing")}
			<div class="icpa-voice icpa-summary is-final" data-verdict={verdictMark ?? "none"} use:inkIn={`s:${id}`}>
				{#if block.turns.length && block.kind !== "request"}<div class="icpa-sublabel">{L("in sum", "总结")}</div>{/if}
				<Markdown app={rt.app} markdown={block.summary} {sourcePath} />
			</div>
		{/if}

		{#if files.length}
			<ul class="icpa-row-artifacts icpa-files" aria-label={L("Files the agent touched", "Agent 改动的文件")}>
				{#each files as a (a.path + a.kind)}
					<li use:settleIn={`art:${block.taskId}:${a.kind}:${a.path}`}>
						<span class="icpa-artifact-kind">{fileWord[a.kind]}</span>
						{#if a.kind === "deleted"}
							<span>{a.label}</span>
						{:else}
							<button type="button" class="icpa-link" onclick={() => rt.openPath(a.path)}>{a.label}</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if block.kind === "request" && block.phase === "completed"}
			{#key followUpKey}
				<WritingLine
					app={rt.app}
					value=""
					placeholder={L("Follow up… ([[ to link a file)", "继续追问…（输入 [[ 链接文件）")}
					label={L("Follow up", "追问")}
					submitLabel={L("send", "发送")}
					autofocus={false}
					onchange={() => undefined}
					onsubmit={sendFollowUp}
					onescape={escape}
					linksFrom={sourcePath}
				/>
			{/key}
		{/if}

		{#each block.turns.filter((t) => t.final) as turn (turn.id)}{@render turnView(turn, 1)}{/each}

		{#if block.error}
			<p class="icpa-error" role="alert" use:settleIn>{block.error}</p>
		{/if}

		<div class="icpa-actions" role="toolbar" aria-label={L("Interaction actions", "交互操作")} bind:this={actionsEl}>
			<span class="icpa-caption" aria-live="polite">
				{#key caption}<span class="icpa-roll" use:settleIn>{caption}</span>{/key}
			</span>
			{#if live}
				<button type="button" class="icpa-link is-quiet" onclick={() => rt.stopBlock(block)}>{L("stop", "停止")}</button>
			{:else if done}
				{#if block.phase === "completed"}
					{#if block.kind === "recall"}
						<button type="button" class="icpa-link icpa-primary" onclick={() => rt.beginFinal(block)} title={L("Write the version of your explanation you now stand behind; it replaces this interaction in the note", "写下你现在认可的解释版本；它会在笔记中替换这段交互")}>{L("write it up", "整理成文")}</button>
					{:else if block.kind === "check"}
						<button type="button" class="icpa-link icpa-primary" onclick={() => rt.beginFinal(block)} title={L("Rewrite your paragraph in the note yourself; the feedback is kept below it", "自己在笔记中改写这段话；反馈保留在下方")}>{L("revise my words", "修改我的说法")}</button>
						<span class="icpa-dot" aria-hidden="true">·</span>
						<button type="button" class="icpa-link" onclick={keep} title={L("Leave your paragraph as is and keep the feedback below it", "保持原段落不变，把反馈保留在下方")}>{L("keep feedback", "保留反馈")}</button>
					{:else if block.kind === "request"}
						<button type="button" class="icpa-link" onclick={keep} title={L("Replace this block with a plain Markdown record: your requests, the replies and the files", "把这个块替换为普通 Markdown 记录：你的请求、回复和涉及的文件")}>{L("keep a record", "保留记录")}</button>
					{:else}
						<button type="button" class="icpa-link icpa-primary" onclick={keep} title={L("Replace this interaction with plain Markdown: the result and the feedback", "把这段交互替换为普通 Markdown：结果和反馈")}>{L("keep in note", "留在笔记里")}</button>
					{/if}
					<span class="icpa-dot" aria-hidden="true">·</span>
					{#if block.kind !== "agent" && block.kind !== "request"}
						<button type="button" class="icpa-link" onclick={() => rt.blockToNote(block)} title={L("Create a learning note from this interaction", "用这段交互新建一篇学习笔记")}>{L("make a note", "写成笔记")}</button>
					{/if}
				{:else}
					<button type="button" class="icpa-link icpa-primary" onclick={() => rt.resume(block)}>{block.phase === "failed" ? L("try again", "重试") : L("continue", "继续")}</button>
					<span class="icpa-dot" aria-hidden="true">·</span>
				{/if}
				<button type="button" class="icpa-link is-quiet" onclick={clear} title={block.authored ? L("Start this exercise over", "重新开始这个练习") : L("Remove the interaction from the note", "从笔记中移除这段交互")}>{block.authored ? L("start over", "重新开始") : L("clear", "清除")}</button>
			{:else if block.phase === "finalizing"}
				<button type="button" class="icpa-link" onclick={keep} title={L("Keep your words unchanged, with the feedback", "保持你的原话不变，附上反馈")}>{block.kind === "check" ? L("leave it as is", "保持原样") : L("keep my first answer", "保留我的第一次回答")}</button>
				<button type="button" class="icpa-link is-quiet" onclick={() => rt.cancelFinal(block)}>{L("back", "返回")}</button>
			{:else if block.phase === "idle" && !block.authored}
				<button type="button" class="icpa-link is-quiet" onclick={clear}>{L("not now", "暂不")}</button>
			{/if}
		</div>
	</section>
	</div>
	</div>
{/if}
