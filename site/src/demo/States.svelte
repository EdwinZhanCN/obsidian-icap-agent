<script lang="ts">
	/*
	 * The interface gallery: one component in each of its states, side by side and still. Each state is
	 * the plugin's own component over the plugin's own state classes, set by hand; nothing plays.
	 */
	import { setLocale, L } from "@plugin/i18n";
	import GlossView from "@plugin/ui/GlossView.svelte";
	import { glossCallout, newId } from "@plugin/dsl/blocks";
	import { keptMarkdown } from "@plugin/runtime/kept";
	import { AskBlock, Gloss, Task, type GlossSection, type Turn } from "@plugin/runtime/state.svelte";
	import type { RunUsage } from "@plugin/agent/usage";
	import { DemoRuntime } from "./runtime.svelte";
	import { authored, gloss as glossText, note, type Lang } from "./content";
	import { markdown } from "./markdown";
	import FrozenAsk from "./FrozenAsk.svelte";

	type Which = "explanation" | "question" | "request" | "kept";
	let { lang = "en", which }: { lang?: Lang; which: Which } = $props();
	// svelte-ignore state_referenced_locally
	setLocale(lang);
	// svelte-ignore state_referenced_locally
	const zh = lang === "zh";
	// svelte-ignore state_referenced_locally
	const n = note(lang);
	// svelte-ignore state_referenced_locally
	const text = glossText(lang);
	const t = (en: string, cn: string) => (zh ? cn : en);
	const rt = new DemoRuntime();
	const u = (id: string, x: Omit<Turn, "id">): Turn => ({ id: `${id}-${newId("u")}`, ...x });
	const half = (s: string) => s.split(" ").slice(0, Math.ceil(s.split(" ").length / 2)).join(" ");

	/* ── explanations ── */
	function glossIn(phase: "reading" | "writing" | "done" | "deeper" | "cancelled"): Gloss {
		const g = new Gloss(newId("g"), n.path, n.term, 0, 0, 0);
		const task = rt.ledger.add(new Task(newId("t"), "explain", n.term, n.path));
		task.phase = phase === "reading" ? "reading" : "writing";
		const section = (mode: GlossSection["mode"], body: string, status: GlossSection["status"]): GlossSection => ({
			id: newId("s"),
			mode,
			label: mode,
			text: body,
			sources: status === "done" && mode === "explain" ? ["[[Lift]]"] : [],
			status,
			taskId: task.id,
		});
		const explain = text.explain ?? "";
		if (phase === "reading") g.sections = [section("explain", "", "streaming")];
		if (phase === "writing") g.sections = [section("explain", zh ? explain.slice(0, 40) : half(explain), "streaming")];
		if (phase === "done") g.sections = [section("explain", explain, "done")];
		if (phase === "deeper") g.sections = [section("explain", explain, "done"), section("deeper", text.deeper ?? "", "done")];
		if (phase === "cancelled") g.sections = [section("explain", zh ? explain.slice(0, 40) : half(explain), "cancelled")];
		if (phase === "done" || phase === "deeper") task.end("completed");
		return g;
	}

	/* ── question blocks ── */
	const recall = authored(lang, "recall").first!;
	const quiz = authored(lang, "quiz").first!;
	const mine = t("A bigger angle turns more air down, so the air pushes the wing up harder.", "迎角越大，机翼向下偏转的空气越多，空气就把机翼推得更用力。");
	const feedback = t("Good: you connect the angle with the air the wing turns. You did not say what happens past the limit.", "不错：你把迎角和机翼偏转的空气联系起来了。但你没有说超过限度后会怎样。");
	const follow = t("Past the limit, the air on the upper surface changes. What does it do, and what happens to the lift?", "超过限度后，上表面的气流会改变。它怎么变？升力又会怎样？");
	const summary = t(
		"Your explanation now has the cause, the effect and the limit. To make it complete, add the critical angle: about 15° for many wings.",
		"你的解释现在有了原因、结果和限度。要更完整，可以补上临界迎角：很多机翼约为 15°。",
	);
	function ask(kind: AskBlock["kind"], topic: string, set: (b: AskBlock) => void): AskBlock {
		const b = new AskBlock(newId("q"), kind, topic, n.path);
		b.authored = kind !== "request";
		b.veiled = false;
		set(b);
		return b;
	}
	const questionStates = (): { label: string; block: AskBlock }[] => [
		{ label: t("Waiting for your answer", "等你作答"), block: ask("recall", n.title, (b) => (b.turns = [u("a", recall)])) },
		{
			label: t("The agent reads your answer", "Agent 在读你的回答"),
			block: ask("recall", n.title, (b) => {
				b.turns = [u("a", { ...recall, answer: { text: mine } })];
				b.phase = "thinking";
				b.agentPhase = "thinking";
			}),
		},
		{
			label: t("Feedback and a follow-up question", "反馈和追问"),
			block: ask("recall", n.title, (b) => {
				b.turns = [u("a", { ...recall, answer: { text: mine }, feedback, verdict: "partly" }), u("b", { kind: "text", question: follow, placeholder: t("Your answer…", "你的回答…") })];
				b.phase = "waiting";
			}),
		},
		{
			label: t("A choice, answered", "选择题，已作答"),
			block: ask("quiz", authored(lang, "quiz").topic, (b) => {
				b.turns = [
					u("a", { ...quiz, answer: { choices: ["b"] }, feedback: t("Correct. A larger angle turns more air, so lift increases.", "正确。迎角越大，偏转的空气越多，所以升力增大。"), verdict: "holds" }),
					u("b", { kind: "single", question: t("The pilot keeps raising the nose past the critical angle. What happens?", "飞行员继续抬头，超过了临界迎角。会发生什么？"), options: [{ id: "a", label: t("Lift keeps increasing", "升力继续增大") }, { id: "b", label: t("The air separates and lift falls", "气流分离，升力下降") }] }),
				];
				b.phase = "waiting";
			}),
		},
		{
			label: t("Completed, with a summary", "完成，附总结"),
			block: ask("recall", n.title, (b) => {
				b.turns = [u("a", { ...recall, answer: { text: mine }, feedback, verdict: "partly" }), u("b", { kind: "text", question: follow, answer: { text: t("The air separates, and the wing stalls.", "气流分离，机翼失速。") }, verdict: "holds" })];
				b.summary = summary;
				b.phase = "completed";
			}),
		},
		{
			label: t("Failed", "失败"),
			block: ask("recall", n.title, (b) => {
				b.turns = [u("a", { ...recall, answer: { text: mine } })];
				b.phase = "failed";
				b.error = L("Network problem reaching the model.", "连接模型时出现网络问题。");
			}),
		},
		{
			label: t("Folded", "折叠"),
			block: ask("recall", n.title, (b) => {
				b.turns = [u("a", { ...recall, answer: { text: mine }, feedback, verdict: "partly" })];
				b.summary = summary;
				b.phase = "completed";
				b.collapsed = true;
			}),
		},
	];

	/* ── request blocks ── */
	const request = t("Add a sentence that connects lift with [[Bernoulli's principle]]", "加一句话，把升力和[[伯努利原理]]联系起来");
	const reply = t(
		"I added one paragraph to [[Lift]]. It links to [[Bernoulli's principle]] and describes lift from the side of pressure.",
		"我在[[升力]]中加了一段话。它链接到[[伯努利原理]]，从压强的角度描述升力。",
	);
	const usage: RunUsage = { input: 14000, output: 800, cacheRead: 3100, cacheWrite: 0, cost: 0.048, costKnown: true, billed: false };
	function req(set: (b: AskBlock, task: Task) => void): AskBlock {
		const b = new AskBlock(newId("r"), "request", t("Add a sentence that connects lift…", "加一句话，把升力…"), n.path);
		const task = rt.ledger.add(new Task(newId("t"), "request", b.topic, n.path));
		task.blockId = b.id;
		b.taskId = task.id;
		b.turns = [u("r", { kind: "text", question: "", local: true, request: true, answer: { text: request } })];
		set(b, task);
		return b;
	}
	const requestStates = (): { label: string; block: AskBlock }[] => [
		{
			label: t("Working", "工作中"),
			block: req((b) => {
				b.phase = "thinking";
				b.agentPhase = "reading";
			}),
		},
		{
			label: t("A proposed change, waiting for you", "建议修改，等你决定"),
			block: req((b, task) => {
				b.turns.push(u("v", { kind: "review", question: t("Add a paragraph that connects lift with [[Bernoulli's principle]].", "加一段话，把升力和[[伯努利原理]]联系起来。"), review: { path: n.path, find: n.after, replace: `${n.after}\n\n${t("The same lift can be described by pressure: the air over the wing moves faster and presses less (see [[Bernoulli's principle]]).", "同样的升力也可以用压强描述：机翼上方的空气流得更快，压强更小（见[[伯努利原理]]）。")}`, summary: "" } }));
				b.phase = "waiting";
				b.agentPhase = "waiting";
				task.status = "waiting";
			}),
		},
		{
			label: t("Completed, with the files and the cost", "完成，附文件和花费"),
			block: req((b, task) => {
				b.summary = reply;
				b.phase = "completed";
				task.artifacts = [{ kind: "edited", path: n.path, label: n.title }];
				task.usage = usage;
				task.end("completed");
			}),
		},
	];

	/* ── what stays in the note ── */
	function keptOf(): { label: string; md: string }[] {
		const g = glossIn("deeper");
		const done = questionStates()[4].block;
		const q = questionStates()[3].block;
		q.turns[1].answer = { choices: ["b"] };
		q.turns[1].verdict = "holds";
		q.summary = t("You can tell how lift changes with the angle of attack.", "你能判断升力如何随迎角变化。");
		const r = requestStates()[2].block;
		return [
			{ label: t("Explanation (gloss)", "解释（gloss）"), md: glossCallout(g.term, g.fullText, g.sources) },
			{ label: t("Recall: your words and the feedback", "回忆：你的话和反馈"), md: keptMarkdown(done) },
			{ label: t("Understanding check (practice)", "理解检验（practice）"), md: keptMarkdown(q) },
			{ label: t("Request record", "请求记录"), md: keptMarkdown(r, [{ kind: "edited", path: n.path, label: n.title }]) },
		];
	}

	/* Made once, here: state changes are not allowed while the template renders. */
	const PHASES = ["reading", "writing", "done", "deeper", "cancelled"] as const;
	const LABELS = [t("Reading the note", "在读笔记"), t("Writing", "书写中"), t("Done", "写完"), t("With a deeper part", "加了「更深入」"), t("Stopped", "已停止")];
	// svelte-ignore state_referenced_locally
	const glosses = which === "explanation" ? PHASES.map((p, i) => ({ label: LABELS[i], gloss: glossIn(p) })) : [];
	// svelte-ignore state_referenced_locally
	const blocks = which === "question" ? questionStates() : which === "request" ? requestStates() : [];
	// svelte-ignore state_referenced_locally
	const kept = which === "kept" ? keptOf() : [];

	let icapStyle = $state(true);
	$effect(() => {
		document.body.classList.toggle("icap-style-theme", !icapStyle);
		return () => document.body.classList.remove("icap-style-theme");
	});
</script>

<div class="icap-states not-content">
	<label class="icap-states-switch"><input type="checkbox" bind:checked={icapStyle} /> {t("ICAP style", "ICAP 样式")}</label>
	{#if which === "explanation"}
		{#each glosses as s}
			<figure class="icap-demo icap-state">
				<figcaption class="icap-demo-bar">{s.label}</figcaption>
				<div class="markdown-reading-view icap-demo-note"><div class="markdown-preview-sizer markdown-rendered"><GlossView gloss={s.gloss} rt={rt as never} /></div></div>
			</figure>
		{/each}
	{:else if which === "question" || which === "request"}
		{#each blocks as s}
			<figure class="icap-demo icap-state">
				<figcaption class="icap-demo-bar">{s.label}</figcaption>
				<div class="markdown-reading-view icap-demo-note"><div class="markdown-preview-sizer markdown-rendered"><FrozenAsk block={s.block} {rt} path={n.path} /></div></div>
			</figure>
		{/each}
	{:else}
		{#each kept as k}
			<figure class="icap-demo icap-state">
				<figcaption class="icap-demo-bar">{k.label}</figcaption>
				<div class="markdown-reading-view icap-demo-note"><div class="markdown-preview-sizer markdown-rendered"><div use:markdown={k.md}></div></div></div>
			</figure>
		{/each}
	{/if}
</div>
