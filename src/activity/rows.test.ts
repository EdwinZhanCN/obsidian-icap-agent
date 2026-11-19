import { describe, expect, it } from "vite-plus/test";
import { costText, duration, modelName, parseLocal, phaseSpans, rowOf, spans, stepKind, taskText, tone, type TaskFacts } from "./rows";

describe("activity rows", () => {
	it("reads a task note's properties", () => {
		const row = rowOf("ICAP/Tasks/Renewal.md", "Renewal", {
			icap: "task",
			"icap-id": "bq9",
			"icap-status": "done",
			"icap-source": ["[[Contracts/Acme MSA]]"],
			"icap-changed": ["[[Learning/Renewal terms]]"],
			"icap-started": "2026-11-10T14:02:10",
			"icap-ended": "2026-11-10T14:06:48",
			"icap-cost": 0.0421,
			"icap-tokens": 18452,
			"icap-model": "anthropic/claude-sonnet-4-5",
		});
		expect(row).toMatchObject({ id: "bq9", status: "done", source: "Contracts/Acme MSA", changed: ["Learning/Renewal terms"], cost: 0.0421, tokens: 18452, model: "anthropic/claude-sonnet-4-5" });
		expect(row!.ended! - row!.started!).toBe(278_000);
	});
	it("takes what it can from an older or hand-edited note", () => {
		expect(rowOf("a.md", "a", { icap: "task", "icap-status": "whatever", "icap-cost": "unknown" })).toMatchObject({ status: null, cost: "unknown", model: null, started: null });
		expect(rowOf("a.md", "a", { tags: ["x"] })).toBeNull();
		expect(parseLocal("2026-11-10")).toBe(new Date(2026, 10, 10).getTime());
		expect(parseLocal("not a date")).toBeNull();
	});
	it("groups statuses by what they ask of the learner", () => {
		expect([tone("running"), tone("needs-you"), tone("review"), tone("done"), tone("cancelled"), tone(null)]).toEqual(["live", "you", "you", "done", "stopped", "idle"]);
	});
});

describe("the strip", () => {
	it("places timed steps between start and end", () => {
		const s = spans(
			[
				{ tool: "read", detail: "a", at: 1000, end: 2000 },
				{ tool: "propose_edit", detail: "b", at: 6000, end: 6000 },
				{ tool: "old", detail: "untimed" },
				{ tool: "ask_learner", detail: "c", at: 9000 },
			],
			0,
			10_000,
		);
		expect(s.map((x) => [x.index, x.kind, x.left, x.running])).toEqual([
			[0, "read", 0.1, false],
			[1, "write", 0.6, false],
			[3, "ask", 0.9, true],
		]);
		expect(s[0].width).toBeCloseTo(0.1);
		expect(s[1].width).toBeGreaterThan(0);
		expect(s[2].width).toBeCloseTo(0.1);
	});
	it("knows a tool by what it does", () => {
		expect([stepKind("grep"), stepKind("obsidian"), stepKind("create_note"), stepKind("bash"), stepKind("ask_learner")]).toEqual(["read", "read", "write", "write", "ask"]);
	});
});

describe("phases", () => {
	it("shows where the time went: getting ready, waiting for the model, thinking, replying", () => {
		const marks = [
			{ phase: "starting" as const, at: 1000 },
			{ phase: "sending" as const, at: 1500 },
			{ phase: "thinking" as const, at: 8500 },
			{ phase: "replying" as const, at: 9000 },
			{ phase: "writing" as const, at: 9500 },
		];
		const s = phaseSpans(marks, 0, 10_000);
		expect(s.map((p) => [p.kind, p.ms, p.running])).toEqual([
			["prep", 1500, false],
			["wait", 7000, false],
			["think", 500, false],
			["reply", 1000, true],
		]);
		expect(s[1].left).toBeCloseTo(0.15);
		expect(s[1].width).toBeCloseTo(0.7);
		expect(phaseSpans([], 0, 10)).toEqual([]);
	});
});

describe("words", () => {
	it("prints durations, models and costs briefly", () => {
		expect([duration(800), duration(7240), duration(48_000), duration(278_000), duration(7_500_000)]).toEqual(["0.8s", "7.2s", "48s", "4m 38s", "2h 05m"]);
		expect(modelName("openrouter/anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
		expect([costText(0.0421), costText(0.004), costText(1.5), costText("unknown"), costText(null)]).toEqual(["≈$0.042", "≈$0.0040", "≈$1.50", null, null]);
	});
});

describe("a task as text", () => {
	const at = (s: number) => new Date(2026, 10, 16, 13, 2, 10).getTime() + s * 1000;
	const task: TaskFacts = {
		kind: "request",
		title: "Compare RAII\n with garbage collection",
		notePath: "C++ Memory Management.md",
		status: "failed",
		createdAt: at(0),
		endedAt: at(48),
		model: "anthropic/claude-sonnet-4-5",
		error: "Provider returned 529\noverloaded_error",
		interrupted: false,
		steps: [
			{ tool: "read", detail: "Missing Note.md", at: at(1), end: at(1.2), error: true, out: "ENOENT: no such file or directory\n    at access (node:fs)" },
			{ tool: "obsidian", detail: "search RAII", at: at(3), end: at(3.4), out: "3 results" },
			{ tool: "old", detail: "" },
			{ tool: "bash", detail: "pnpm test", at: at(40) },
		],
		stepsDropped: 2,
		phases: [
			{ phase: "sending", at: at(0) },
			{ phase: "thinking", at: at(30) },
			{ phase: "awaiting", at: at(32) },
			{ phase: "replying", at: at(42) },
		],
	};

	it("says what the task was, how it ended, where its time went and what each tool call returned", () => {
		expect(taskText(task).split("\n")).toEqual([
			"ICAP task · request · failed",
			"title: Compare RAII with garbage collection",
			"note: C++ Memory Management.md",
			"model: anthropic/claude-sonnet-4-5",
			"started: 2026-11-16 13:02:10 · took 48s",
			"time: waiting for the model 40s · thinking 2.0s · replying 6.0s",
			"error: Provider returned 529",
			"  overloaded_error",
			"",
			"tool calls: 6 (the first 2 were not kept)",
			"13:02:11 · read · Missing Note.md · 0.2s · failed",
			"    ENOENT: no such file or directory",
			"        at access (node:fs)",
			"13:02:13 · obsidian · search RAII · 0.4s",
			"    3 results",
			"old",
			"13:02:50 · bash · pnpm test · did not end",
		]);
	});
	it("counts a running task up to now, and leaves out what it does not have", () => {
		const text = taskText({ ...task, status: "processing", endedAt: null, model: null, error: null, steps: [task.steps[3]], stepsDropped: 0, phases: [] }, at(45));
		expect(text.split("\n")).toEqual([
			"ICAP task · request · processing",
			"title: Compare RAII with garbage collection",
			"note: C++ Memory Management.md",
			"started: 2026-11-16 13:02:10 · running for 45s",
			"",
			"tool calls: 1",
			"13:02:50 · bash · pnpm test · running",
		]);
		expect(taskText({ ...task, status: "cancelled", interrupted: true, error: null, steps: [], phases: [] }).split("\n")[0]).toBe("ICAP task · request · cancelled (interrupted)");
	});
	it("tells a request block's earlier rounds from its latest", () => {
		const steps = [
			{ tool: "read", detail: "a.md", at: at(-86_400), end: at(-86_400) + 30 },
			{ tool: "grep", detail: "RAII", at: at(-600), end: at(-599) },
			{ tool: "read", detail: "b.md", at: at(2), end: at(2.5) },
		];
		expect(taskText({ ...task, status: "completed", error: null, steps, stepsDropped: 0, phases: [] }).split("\n").slice(4)).toEqual([
			"latest round: 2026-11-16 13:02:10 · took 48s",
			"",
			"tool calls: 3",
			"2026-11-15 13:02:10 · read · a.md",
			"12:52:10 · grep · RAII · 1.0s",
			"-- latest round --",
			"13:02:12 · read · b.md · 0.5s",
		]);
	});
});
