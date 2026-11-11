import { describe, expect, it } from "vite-plus/test";
import { editProblem, evidenceCallout, evidenceComment, findAskBlock, glossCallout, isoDate, parseAskSource, parseAuthored, parseEvidenceComment, serializeAsk, splitSources, fenceFor } from "./blocks";
import { balanceStreamingMarkdown } from "./text";
import { tidyOptionLabel, tidyQuestion } from "./blocks";
import { askReplacement } from "./blocks";
import { requestRecord } from "./blocks";
import { dialogTitle } from "./blocks";
import { setLocale } from "../i18n";



describe("evidence in kept callouts", () => {
	it("writes the date and verdict twice: for the reader in the title, for tools in a comment", () => {
		const md = evidenceCallout("feedback", "  协方差  矩阵 ", { kind: "recall", id: "q7f3a2", date: "2026-11-06", verdict: "holds" }, "Right.\n\nOne gap.");
		expect(md).toBe("<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds -->\n> [!feedback] 协方差 矩阵 · 2026-11-06 · ✓\n> Right.\n>\n> One gap.");
	});
	it("leaves the mark out when there is no verdict, and counts a quiz per question", () => {
		expect(evidenceCallout("feedback", "T", { kind: "check", id: "c1", date: "2026-11-06" }, "Checked.")).toBe("<!-- icap check id=c1 date=2026-11-06 -->\n> [!feedback] T · 2026-11-06\n> Checked.");
		const quiz = evidenceCallout("practice", "Understanding check — T", { kind: "quiz", id: "z1", date: "2026-11-06", counts: { holds: 2, partly: 0, reconsider: 1 } }, "**1.** Q");
		expect(quiz.split("\n")[0]).toBe("<!-- icap quiz id=z1 date=2026-11-06 holds=2 partly=0 reconsider=1 -->");
		expect(quiz.split("\n")[1]).toBe("> [!practice] Understanding check — T · 2026-11-06");
	});
	it("reads a comment back, ignoring keys it does not know", () => {
		const e = { kind: "recall" as const, id: "q7f3a2", date: "2026-11-06", verdict: "partly" as const };
		expect(parseEvidenceComment(evidenceComment(e))).toEqual(e);
		expect(parseEvidenceComment("<!-- icap quiz id=z1 date=2026-11-06 holds=2 partly=0 reconsider=1 later=x -->")).toEqual({ kind: "quiz", id: "z1", date: "2026-11-06", counts: { holds: 2, partly: 0, reconsider: 1 } });
		expect(parseEvidenceComment("<!-- icap recall id=q7f3a2 date=yesterday -->")).toBeNull();
		expect(parseEvidenceComment("<!-- a note to self -->")).toBeNull();
		expect(parseEvidenceComment("> [!feedback] T · 2026-11-06 · ✓")).toBeNull();
	});
	it("dates in the local calendar", () => {
		expect(isoDate(new Date(2026, 10, 6, 23, 30).getTime())).toBe("2026-11-06");
		expect(isoDate(new Date(2026, 0, 1, 0, 1).getTime())).toBe("2026-01-01");
	});
});

describe("dsl", () => {
	it("round-trips an ask block and finds it", () => {
		const src = serializeAsk({ id: "abc", kind: "recall", body: "Explain `x`." });
		const doc = `para\n\n${src}\n\nafter`;
		const inner = src.split("\n").slice(1, -1).join("\n");
		expect(parseAskSource(inner)).toMatchObject({ id: "abc", kind: "recall", body: "Explain `x`." });
		const r = findAskBlock(doc, "abc")!;
		expect(doc.slice(r.from, r.to)).toBe(src);
		expect(findAskBlock(doc, "nope")).toBeNull();
		expect(src.startsWith("```icap-ask\n")).toBe(true);
	});
	it("still finds blocks written before the rename (```icpa-ask)", () => {
		const old = "```icpa-ask\nid: old1\nkind: recall\n---\nExplain lift.\n```";
		const doc = `para\n\n${old}\n\nafter`;
		const r = findAskBlock(doc, "old1")!;
		expect(doc.slice(r.from, r.to)).toBe(old);
	});
	it("reads authored blocks (and ignores runtime ones)", () => {
		const quiz = parseAskSource("id: q1\nkind: quiz\nauthored: yes\ntopic: Modes\n---\nWhich is **constructive**?\n- [ ] re-reading\n- [ ] explaining it yourself");
		expect(parseAuthored(quiz)).toMatchObject({
			kind: "quiz",
			topic: "Modes",
			question: "Which is **constructive**?",
			options: [
				{ id: "a", label: "re-reading" },
				{ id: "b", label: "explaining it yourself" },
			],
			multi: false,
		});
		const agent = parseAskSource("id: a1\nkind: agent\nauthored: true\nstart: go\n---\nWrite a note on X.");
		expect(parseAuthored(agent)).toMatchObject({ kind: "agent", start: "go", topic: "Write a note on X." });
		expect(parseAuthored(parseAskSource("id: q2\nkind: recall\n---\nRecall: X"))).toBeNull();
		expect(parseAuthored(parseAskSource("id: q3\nkind: quiz\nauthored: yes\n---\nOnly one?\n- [ ] a"))).toBeNull();
	});
	it("uses a longer fence when the body contains fences", () => {
		expect(fenceFor("```js\nx\n```")).toBe("````");
	});
	it("serializes a gloss as a native callout", () => {
		expect(glossCallout("RAII", "Line one.\n\nLine two.", ["[[Python refs]]"])).toBe(
			"> [!gloss] RAII\n> Line one.\n>\n> Line two.\n>\n> *Sources: [[Python refs]]*",
		);
	});
	it("splits a trailing sources line", () => {
		expect(splitSources("Body.\n\nSources: [[A]], [[B c]]")).toEqual({ body: "Body.", sources: ["[[A]]", "[[B c]]"] });
		expect(splitSources("Body without sources")).toEqual({ body: "Body without sources", sources: [] });
	});
	it("balances streaming markdown", () => {
		expect(balanceStreamingMarkdown("a\n```js\nx")).toBe("a\n```js\nx\n```");
		expect(balanceStreamingMarkdown("$$\nx")).toBe("$$\nx\n$$");
	});
});

describe("proposed edits", () => {
	const note = [
		"## Why the angle matters",
		"",
		"Lift grows roughly in step with the angle of attack, up to about 15°.",
		"",
		"```icap-ask",
		"id: qzjnwo3j46",
		"kind: request",
		"---",
		"Request to the agent",
		"```",
		"",
		"## Explain it back",
	].join("\n");
	const visual = "```icap-ui\n<input type=\"range\">\n```";

	it("refuses a visual added to an existing note, as the model tried twice while filming", () => {
		// Run 1: the whole request fence, replaced by itself plus a visual.
		const fence = note.slice(note.indexOf("```icap-ask"), note.indexOf("\n\n## Explain"));
		expect(editProblem(note, fence, `${fence}\n\nDrag α slowly.\n\n${visual}`)).toBe("visual");
		// Run 2: the fence header, replaced by prose plus a visual (it would have broken the block).
		expect(editProblem(note, "```icap-ask\nid: qzjnwo3j46\nkind: request\n---", `Predict first.\n\n${visual}`)).toBe("visual");
		expect(editProblem(note, "", `\n${visual}`)).toBe("visual");
		expect(editProblem(note, "up to about 15°.", "up to about 15°.\n\n~~~icap-ui\n<b>x</b>\n~~~")).toBe("visual");
	});

	it("refuses edits that touch ICAP's blocks or write new ones", () => {
		expect(editProblem(note, "kind: request", "kind: quiz")).toBe("block");
		expect(editProblem(note, "Request to the agent", "Something else")).toBe("block");
		expect(editProblem(note, "```\n\n## Explain", "```\n\nMore.\n\n## Explain")).toBe("block");
		expect(editProblem(note, "up to about 15°.", "up to about 15°.\n\n```icap-ask\nid: x\nkind: agent\n---\nQ?\n```")).toBe("block");
		const legacy = "Text.\n\n```icpa-ask\nid: old\nkind: recall\n---\n```\n";
		expect(editProblem(legacy, "kind: recall", "kind: check")).toBe("block");
	});

	it("allows ordinary edits of the learner's text, and an edit that keeps an existing visual", () => {
		expect(editProblem(note, "up to about 15°.", "up to about 15° on a plain wing.")).toBeUndefined();
		expect(editProblem(note, "", "\n## Path\n\n1. [[Stall]]")).toBeUndefined();
		expect(editProblem(note, "not in the note", "x")).toBeUndefined();
		const created = `Try it:\n\n${visual}\n\nThen explain.`;
		expect(editProblem(created, `Try it:\n\n${visual}`, `Try this:\n\n${visual}`)).toBeUndefined();
	});
});

describe("ask tidying", () => {
	it("strips letter prefixes from option labels", () => {
		expect(tidyOptionLabel("(a) It can be copied")).toBe("It can be copied");
		expect(tidyOptionLabel("B. Moves only")).toBe("Moves only");
		expect(tidyOptionLabel("c) deep copy")).toBe("deep copy");
		expect(tidyOptionLabel("A pointer that owns")).toBe("A pointer that owns");
		expect(tidyOptionLabel("a")).toBe("a");
	});
	it("removes a duplicated trailing option list from the question", () => {
		const q = "Which is correct?\n\n- (a) one\n- (b) two\n- (c) three";
		expect(tidyQuestion(q, 3)).toBe("Which is correct?");
		expect(tidyQuestion("Pick:\na) x", 2)).toBe("Pick:\na) x");
		expect(tidyQuestion(q, 0)).toBe(q);
	});
});

describe("block removal", () => {
	const block = "```icap-ask\nid: q1\nkind: recall\n---\n```";
	const apply = (t: string, s: { from: number; to: number; insert: string } | null) => (s ? t.slice(0, s.from) + s.insert + t.slice(s.to) : t);
	it("leaves exactly one blank line between neighbours", () => {
		const t = `para one\n\n${block}\n\n\n## Next`;
		expect(apply(t, askReplacement(t, "q1", ""))).toBe("para one\n\n## Next");
	});
	it("handles a block at the end of the note", () => {
		const t = `para one\n\n${block}\n`;
		expect(apply(t, askReplacement(t, "q1", ""))).toBe("para one\n");
	});
	it("replaces in place when keeping", () => {
		const t = `a\n\n${block}\n\nb`;
		expect(apply(t, askReplacement(t, "q1", "> [!note] x"))).toBe("a\n\n> [!note] x\n\nb");
	});
});

describe("request record", () => {
	it("keeps each request with its reply, and the files touched", () => {
		const md = requestRecord(
			"学习 C++",
			[
				{ request: "根据 资料/ 做学习路线", reply: "已创建路线。" },
				{ request: "再细一点", reply: "已按章节细分。" },
			],
			[
				{ kind: "created", path: "Learning/Path.md" },
				{ kind: "created", path: "Top.md" },
				{ kind: "edited", path: "C++.md" },
				{ kind: "deleted", path: "old.md" },
				{ kind: "created", path: "Sources/map.png" },
			],
		);
		expect(md.split("\n")[0]).toBe("> [!request] 学习 C++");
		expect(md).toContain("> **Request:** 根据 资料/ 做学习路线\n>\n> 已创建路线。\n>\n> **Request:** 再细一点");
		expect(md).toContain(
			"> **Files:** created [[Learning/Path|Path]], [[Top]], [[Sources/map.png]] · changed [[C++]] · deleted old.md",
		);
	});
	it("has no files line when nothing was touched", () => {
		expect(requestRecord("x", [{ request: "q", reply: "a" }], [])).not.toContain("Files");
	});
});

describe("extension dialog titles", () => {
	it("bolds only the first line and keeps an indented command as code", () => {
		expect(dialogTitle("⚠️ Dangerous command:\n\n  rm -rf x\n\nAllow?")).toBe("**⚠️ Dangerous command:**\n\n`rm -rf x`\n\nAllow?");
		expect(dialogTitle("Allow the test?")).toBe("**Allow the test?**");
		expect(dialogTitle("  ")).toBe("");
	});
});

describe("Chinese interface", () => {
	it("writes a request record in Chinese, keeping the callout type", () => {
		setLocale("zh");
		try {
			expect(requestRecord("路线", [{ request: "做一条路线", reply: "好了" }], [{ kind: "created", path: "A.md" }])).toBe(
				"> [!request] 路线\n> **请求:** 做一条路线\n>\n> 好了\n>\n> **文件:** 新建 [[A]]",
			);
		} finally {
			setLocale("en");
		}
	});
});

import { findRequestRecord } from "./blocks";

describe("findRequestRecord", () => {
	const note = "# Lift\n\nText.\n\n> [!request] Add a sentence that connects lift…\n> **Request:** Add a sentence that connects lift with [[Bernoulli's principle]]\n\nMore.\n\n> [!request] What is a stall?\n> **Request:** What is a stall?\n";
	it("finds the record whose title begins like the request", () => {
		expect(findRequestRecord(note, "Add a sentence that connects lift with Bernoulli's principle")).toBe(note.indexOf("> [!request] Add"));
		expect(findRequestRecord(note, "What is a stall")).toBe(note.indexOf("> [!request] What"));
	});
	it("is null when no record matches", () => {
		expect(findRequestRecord(note, "Explain drag")).toBeNull();
		expect(findRequestRecord(note, "")).toBeNull();
	});
});
