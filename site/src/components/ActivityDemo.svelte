<script lang="ts">
	/*
	 * The plugin's activity view (src/activity/ActivityView.svelte), as is, over made-up task notes. One
	 * task runs on a loop: it reads, writes, then asks the learner, and starts over, so the strip, the
	 * card and the counters can be seen working.
	 */
	import { setLocale } from "@plugin/i18n";
	import { Task } from "@plugin/runtime/state.svelte";
	import ActivityView from "@plugin/activity/ActivityView.svelte";
	import type { ActivityData, ActivityRow } from "@plugin/activity/rows";
	import { onDestroy } from "svelte";

	let { lang = "en" }: { lang?: string } = $props();
	// svelte-ignore state_referenced_locally
	setLocale(lang);
	// svelte-ignore state_referenced_locally
	const zh = lang.startsWith("zh");
	const t = (en: string, cn: string) => (zh ? cn : en);

	const now = Date.now();
	const min = 60_000;
	const row = (r: Partial<ActivityRow> & Pick<ActivityRow, "id" | "title" | "status">): ActivityRow => ({
		path: `ICAP/Tasks/${r.title}.md`,
		source: null,
		changed: [],
		started: null,
		ended: null,
		cost: null,
		tokens: null,
		model: null,
		...r,
	});

	/* ── the running task ── */
	const SCRIPT: { tool: string; detail: string; ms: number; gap: number }[] = [
		{ tool: "read", detail: t("Contracts/Acme MSA.md", "合同/Acme 主协议.md"), ms: 1600, gap: 1400 },
		{ tool: "grep", detail: t("“renewal” in Contracts/", "在 合同/ 中搜索“续约”"), ms: 1200, gap: 1800 },
		{ tool: "read_document", detail: t("Acme MSA.pdf · pp. 12–14", "Acme MSA.pdf · 第 12–14 页"), ms: 3400, gap: 2200 },
		{ tool: "propose_edit", detail: t("Contracts/Acme MSA.md · section “Renewal”", "合同/Acme 主协议.md ·「续约」一节"), ms: 1400, gap: 900 },
		{ tool: "ask_learner", detail: t("Keep the notice period as a table?", "通知期要做成表格吗？"), ms: 4200, gap: 0 },
	];
	let live = $state(makeLive());
	function makeLive() {
		const task = new Task("demo-live", "request", "", "Contracts/Acme MSA.md", Date.now());
		task.blockId = "demo-live";
		task.model = "anthropic/claude-sonnet-4-5";
		task.phase = "thinking";
		return task;
	}
	let liveRow = $state(
		row({ id: "demo-live", title: t("Summarise the renewal terms as a section", "把续约条款整理成一节"), status: "running", source: t("Contracts/Acme MSA", "合同/Acme 主协议"), model: "anthropic/claude-sonnet-4-5" }),
	);

	let timers: number[] = [];
	const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
	function run() {
		live = makeLive();
		liveRow = { ...liveRow, status: "running", started: Date.now(), ended: null, cost: null };
		let at = 900;
		for (const s of SCRIPT) {
			later(at, () => {
				live.addStep(s.tool, s.detail);
				live.phase = s.tool === "ask_learner" ? "waiting" : "reading";
				if (s.tool === "ask_learner") {
					live.status = "waiting";
					liveRow = { ...liveRow, status: "needs-you", cost: 0.0187 };
				}
			});
			at += s.ms;
			if (s.tool !== "ask_learner")
				later(at, () => {
					live.endStep();
					live.phase = "thinking";
				});
			at += s.gap;
		}
		later(at + 4000, () => {
			live.endStep();
			live.end("completed");
			liveRow = { ...liveRow, status: "done", ended: Date.now(), cost: 0.0241 };
		});
		later(at + 9000, run);
	}
	run();
	onDestroy(() => timers.forEach((id) => window.clearTimeout(id)));

	/* ── the rest: notes from earlier, some from another device (no strip) ── */
	const asking = new Task("demo-ask", "request", "", "C++ Memory Management.md", now - 3 * min);
	asking.blockId = "demo-ask";
	asking.model = "openai/gpt-5";
	asking.status = "waiting";
	asking.phase = "waiting";
	asking.steps = [
		{ tool: "read", detail: "C++ Memory Management.md", at: now - 175_000, end: now - 168_000 },
		{ tool: "create_note", detail: t("Learning/RAII practice.md", "学习/RAII 练习.md"), at: now - 120_000, end: now - 112_000 },
		{ tool: "ask_learner", detail: t("Which one first?", "先做哪一题？"), at: now - 60_000 },
	];
	const done = new Task("demo-done", "request", "", "Gradient descent.md", now - 48 * min);
	done.blockId = "demo-done";
	done.steps = [
		{ tool: "read", detail: t("Gradient descent.md", "梯度下降.md"), at: now - 48 * min + 4000, end: now - 48 * min + 21_000 },
		{ tool: "read_document", detail: "Boyd, Convex Optimization · §9.5", at: now - 48 * min + 40_000, end: now - 48 * min + 95_000 },
		{ tool: "create_note", detail: t("Learning/Newton's method.md", "学习/牛顿法.md"), at: now - 48 * min + 150_000, end: now - 48 * min + 210_000 },
		{ tool: "propose_edit", detail: t("Gradient descent.md · link the comparison", "梯度下降.md · 链接对比"), at: now - 48 * min + 240_000, end: now - 48 * min + 262_000 },
	];
	done.end("completed");
	done.endedAt = now - 48 * min + 278_000;
	const tasks = new Map<string, Task>([
		["demo-ask", asking],
		["demo-done", done],
	]);

	const earlier: ActivityRow[] = [
		row({ id: "demo-ask", title: t("Write three practice questions for this chapter", "给这一章出三道练习题"), status: "needs-you", source: "C++ Memory Management", started: now - 3 * min, cost: 0.0112, model: "openai/gpt-5" }),
		row({ id: "demo-done", title: t("Compare gradient descent with Newton's method", "对比梯度下降和牛顿法"), status: "done", source: t("Gradient descent", "梯度下降"), changed: ["Learning/Newton's method", "Gradient descent"], started: now - 48 * min, ended: now - 48 * min + 278_000, cost: 0.0421, model: "openrouter/anthropic/claude-sonnet-4.5" }),
		row({ id: "x1", title: t("Find where my notes contradict the textbook", "检查我的笔记和教材哪里矛盾"), status: "done", source: t("Linear algebra", "线性代数"), changed: [t("Linear algebra", "线性代数")], started: now - 26 * 60 * min, ended: now - 26 * 60 * min + 180_000, cost: 0.0089, model: "google/gemini-2.5-pro" }),
		row({ id: "x2", title: t("Turn this lecture into flashcards", "把这节课整理成抽认卡"), status: "failed", source: t("Lecture 7", "第 7 讲"), started: now - 28 * 60 * min, ended: now - 28 * 60 * min + 12_000, cost: 0.0004, model: "deepseek/deepseek-chat" }),
		row({ id: "x3", title: t("Explain RAII with a local model", "用本地模型解释 RAII"), status: "cancelled", source: "C++ Memory Management", started: now - 50 * 60 * min, ended: now - 50 * 60 * min + 95_000, cost: "unknown", model: "my-endpoint/house-model" }),
	];

	const data: ActivityData = $derived({ groups: [{ key: null, rows: [liveRow, ...earlier] }] });

	let icapStyle = $state(true);
	$effect(() => {
		document.body.classList.toggle("icap-style-theme", !icapStyle);
		return () => document.body.classList.remove("icap-style-theme");
	});
</script>

<div class="icap-demo not-content">
	<div class="icap-demo-bar">
		<span>ICAP / Activity.base</span>
		<span class="grow"></span>
		<label><input type="checkbox" bind:checked={icapStyle} /> {t("ICAP style", "ICAP 样式")}</label>
	</div>
	<ActivityView {data} live={(id) => (id === "demo-live" ? live : tasks.get(id))} open={() => {}} />
</div>
