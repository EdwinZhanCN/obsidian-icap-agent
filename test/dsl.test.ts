import { describe, expect, it } from "vitest";
import {
	findAskBlock,
	glossCallout,
	parseAskSource,
	parseAuthored,
	serializeAsk,
	splitSources,
	fenceFor,
} from "../src/dsl/blocks";
import { balanceStreamingMarkdown, glossAnchor, headingTrail, paragraphBounds, sectionBounds } from "../src/dsl/text";

const NOTE = `---
tags: [cpp]
---
# C++ Memory

Intro paragraph about memory.
It spans two lines with RAII here.

## RAII

RAII ties resource lifetime to object lifetime.
- first item mentions destructor
  continued line
- second item

\`\`\`cpp
std::lock_guard<std::mutex> g(m);
\`\`\`

## Smart pointers

unique_ptr owns.
`;

describe("structure", () => {
	it("finds the heading trail", () => {
		const off = NOTE.indexOf("ties resource");
		expect(headingTrail(NOTE, off)).toEqual(["C++ Memory", "RAII"]);
	});
	it("anchors a gloss after the paragraph", () => {
		const off = NOTE.indexOf("RAII here");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 10, anchor)).toBe("RAII here.");
	});
	it("anchors a gloss after a list item with continuation", () => {
		const off = NOTE.indexOf("destructor");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 14, anchor)).toBe("continued line");
	});
	it("anchors a gloss after a code fence", () => {
		const off = NOTE.indexOf("lock_guard");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 3, anchor)).toBe("```");
	});
	it("bounds the section", () => {
		const s = sectionBounds(NOTE, NOTE.indexOf("ties resource"));
		expect(s.title).toBe("RAII");
		expect(NOTE.slice(s.from, s.to).endsWith("```")).toBe(true);
	});
	it("bounds a paragraph", () => {
		const p = paragraphBounds(NOTE, NOTE.indexOf("two lines"));
		expect(NOTE.slice(p.from, p.to)).toBe("Intro paragraph about memory.\nIt spans two lines with RAII here.");
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

import { tidyOptionLabel, tidyQuestion } from "../src/dsl/blocks";

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

import { askReplacement } from "../src/dsl/blocks";

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

import { guideNote } from "../src/guide/guide";

describe("guide", () => {
	for (const lang of ["zh-cn", "en"]) {
		it(`has three live exercises (${lang})`, () => {
			const g = guideNote(lang);
			const fences = [...g.content.matchAll(/```icap-ask\n([\s\S]*?)\n```/g)].map((m) => parseAuthored(parseAskSource(m[1])));
			expect(fences.map((f) => f?.kind)).toEqual(["quiz", "recall", "agent"]);
			expect(fences[0]?.options.length).toBe(4);
			expect(g.content).not.toMatch(/^# /m); // the file name is the title
			for (const id of g.blockIds) expect(g.content).toContain(`id: ${id}`);
		});
		it(`shows the submit shortcut as keycaps for the platform (${lang})`, () => {
			expect(guideNote(lang, true).content).toContain("<kbd>⌘</kbd> <kbd>↵</kbd>");
			const other = guideNote(lang, false).content;
			expect(other).toContain("<kbd>Ctrl</kbd> <kbd>↵</kbd>");
			expect(other).not.toContain("⌘");
		});
	}
});

import { requestRecord } from "../src/dsl/blocks";
import { sessionPlan, vaultContextFiles } from "../src/agent/pi-session";

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

describe("context files", () => {
	it("keeps Pi's global AGENTS.md and the vault's own, drops what lies above the vault", () => {
		const files = [
			{ path: "/Users/me/.pi/agent/AGENTS.md" },
			{ path: "/Users/me/AGENTS.md" },
			{ path: "/Users/me/code/repo/CLAUDE.md" },
			{ path: "/Users/me/code/repo/vault/AGENTS.md" },
			{ path: "/Users/me/code/repo/vault-other/AGENTS.md" },
		];
		expect(vaultContextFiles(files, "/Users/me/code/repo/vault", "/Users/me/.pi/agent").map((f) => f.path)).toEqual([
			"/Users/me/.pi/agent/AGENTS.md",
			"/Users/me/code/repo/vault/AGENTS.md",
		]);
		expect(vaultContextFiles(files, "/Users/me/code/repo/vault", "/Users/me/.pi/agent", true).map((f) => f.path)).toEqual(["/Users/me/code/repo/vault/AGENTS.md"]);
	});
});

describe("pi session plan", () => {
	const base = { systemPrompt: "PROTOCOL", tools: ["read", "obsidian", "read_document", "ask_learner"] };
	it("uses the learner's own setup, appending the protocol and hiding unused ICAP tools", () => {
		const p = sessionPlan({ ...base, config: "mine" });
		expect(p).toMatchObject({ bare: false, contextFiles: "vault+pi", builtins: true, appendSystemPrompt: ["PROTOCOL"], excludeTools: ["create_note", "propose_edit"] });
		expect(p.systemPrompt).toBeUndefined();
		expect(p.tools).toBeUndefined();
	});
	it("isolates: only ICAP, the given tools, the protocol as the whole prompt, the vault's own AGENTS.md", () => {
		const p = sessionPlan({ ...base, config: "isolated" });
		expect(p).toMatchObject({ bare: true, contextFiles: "vault", builtins: false, systemPrompt: "PROTOCOL", tools: ["read", "obsidian", "read_document", "ask_learner"] });
		expect(p.appendSystemPrompt).toBeUndefined();
	});
});

import { cap, parsePages, within, MAX_PAGES } from "../src/agent/doc-pages";

describe("read_document helpers", () => {
	it("parses page selections against the page count", () => {
		expect(parsePages("12", 40).pages).toEqual([12]);
		expect(parsePages("3-5", 40).pages).toEqual([3, 4, 5]);
		expect(parsePages("38-", 40).pages).toEqual([38, 39, 40]);
		expect(parsePages("1,4,9-10,4", 40).pages).toEqual([1, 4, 9, 10]);
		expect(parsePages("39-45", 40).pages).toEqual([39, 40]);
		expect(parsePages(undefined, 3).pages).toEqual([1, 2, 3]);
	});
	it("caps one call and says more follow", () => {
		const r = parsePages("", 100);
		expect(r.pages.length).toBe(MAX_PAGES);
		expect(r.more).toBe(true);
		expect(parsePages("1-5", 100).more).toBe(false);
	});
	it("rejects nonsense", () => {
		expect(() => parsePages("chapter 2", 10)).toThrow(/Invalid page selection/);
	});
	it("caps long text", () => {
		expect(cap("abcdef", 3)).toEqual({ text: "abc\n…(truncated)", truncated: true });
		expect(cap("ab", 3)).toEqual({ text: "ab", truncated: false });
	});
	it("knows what is inside the allowed folders", () => {
		expect(within("/v/notes/a.pdf", ["/v"])).toBe(true);
		expect(within("/v", ["/v"])).toBe(true);
		expect(within("/vault2/a.pdf", ["/v"])).toBe(false);
		expect(within("/v/../etc/hosts", ["/v"])).toBe(false);
		expect(within("/books/x.pdf", ["/v", "/books"])).toBe(true);
	});
});

import { hasTag, parseQuery } from "../src/agent/doc-pages";

describe("obsidian search query", () => {
	it("splits operators from words", () => {
		expect(parseQuery('pointer tag:#cpp path:"Learning/C++" file:notes heap')).toEqual({
			text: "pointer heap",
			paths: ["learning/c++"],
			files: ["notes"],
			tags: ["cpp"],
		});
		expect(parseQuery('"exact phrase" x')).toEqual({ text: "exact phrase x", paths: [], files: [], tags: [] });
		expect(parseQuery("tag:ml").text).toBe("");
	});
	it("matches nested tags", () => {
		expect(hasTag(["#ml/optim"], "ml")).toBe(true);
		expect(hasTag(["#ML"], "ml")).toBe(true);
		expect(hasTag(["#mlops"], "ml")).toBe(false);
	});
});

import { dialogTitle } from "../src/dsl/blocks";

describe("extension dialog titles", () => {
	it("bolds only the first line and keeps an indented command as code", () => {
		expect(dialogTitle("⚠️ Dangerous command:\n\n  rm -rf x\n\nAllow?")).toBe("**⚠️ Dangerous command:**\n\n`rm -rf x`\n\nAllow?");
		expect(dialogTitle("Allow the test?")).toBe("**Allow the test?**");
		expect(dialogTitle("  ")).toBe("");
	});
});

import { extractLinks, insertLink, linkTrigger } from "../src/dsl/links";
import { requestPrompt } from "../src/agent/prompts";

describe("[[ links in a request", () => {
	it("sees a link being typed", () => {
		expect(linkTrigger("基于 [[Poin", 10)).toEqual({ start: 3, query: "Poin" });
		expect(linkTrigger("[[", 2)).toEqual({ start: 0, query: "" });
		expect(linkTrigger("[[A]] and", 9)).toBeNull();
		expect(linkTrigger("[[A|alias", 9)).toBeNull();
	});
	it("treats @ at a word start as the same shortcut, but not e-mail", () => {
		expect(linkTrigger("基于@资料", 5)).toEqual({ start: 2, query: "资料" });
		expect(linkTrigger("see @book", 9)).toEqual({ start: 4, query: "book" });
		expect(linkTrigger("me@x.com", 8)).toBeNull();
		expect(linkTrigger("@a b", 4)).toBeNull();
	});
	it("inserts the finished link", () => {
		expect(insertLink("用 @bo 讲", 5, { start: 2, query: "bo" }, "Sources/book.pdf")).toEqual({ text: "用 [[Sources/book.pdf]] 讲", caret: 22 });
		expect(insertLink("[[Po]]", 4, { start: 0, query: "Po" }, "Pointers")).toEqual({ text: "[[Pointers]]", caret: 12 });
	});
	it("extracts targets without headings or aliases", () => {
		expect(extractLinks("用 [[A]]、[[B#Intro|b]] 和 ![[c.pdf]]，再看 [[A]]")).toEqual(["A", "B", "c.pdf"]);
	});
	it("lists the pointed files in the request prompt, not their content", () => {
		const ctx = { title: "T", path: "T.md", headingTrail: [] } as any;
		const p = requestPrompt(ctx, undefined, "", "基于 [[book.pdf]] 和 [[Missing]]", [
			{ link: "book.pdf", path: "Sources/book.pdf" },
			{ link: "Missing", path: null },
		]);
		expect(p).toContain("- [[book.pdf]] → Sources/book.pdf");
		expect(p).toContain("- [[Missing]] → no such file (yet)");
	});
});

import { envAdditions, parseEnv } from "../src/agent/pi-host";

describe("login shell environment", () => {
	it("parses env -0 output, keeping = and newlines in values", () => {
		expect(parseEnv("PATH=/bin:/usr/bin\0DEEPSEEK_API_KEY=sk-a=b\0MULTI=line1\nline2\0")).toEqual({
			PATH: "/bin:/usr/bin",
			DEEPSEEK_API_KEY: "sk-a=b",
			MULTI: "line1\nline2",
		});
	});
	it("adds only what Obsidian lacks, and the shell's PATH first", () => {
		const add = envAdditions({ HOME: "/h", PATH: "/usr/bin", KEEP: "mine" }, { PATH: "/opt/pi/bin:/usr/bin", KEEP: "shell", DEEPSEEK_API_KEY: "sk", SHLVL: "2" });
		expect(add.DEEPSEEK_API_KEY).toBe("sk");
		expect(add.KEEP).toBeUndefined();
		expect(add.SHLVL).toBeUndefined();
		expect(add.PATH?.split(":").slice(0, 2)).toEqual(["/opt/pi/bin", "/usr/bin"]);
		expect(add.PATH?.split(":").filter((p) => p === "/usr/bin")).toHaveLength(1);
	});
});

import { setLocale } from "../src/i18n";

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
