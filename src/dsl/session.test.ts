import { describe, expect, it } from "vite-plus/test";
import { requestRecord } from "./blocks";
import { readRecords, requestRounds } from "./records";
import { appendRounds, dropLastRound, findLiveRecord, isSessionName, roundsTranscript, sessionName, sessionNote, sessionTitle } from "./session";

const apply = (text: string, s: { from: number; to: number; insert: string } | null) => (s ? text.slice(0, s.from) + s.insert + text.slice(s.to) : text);

describe("a session note", () => {
	it("is named by the minute, and renamed from its first request", () => {
		const name = sessionName(new Date(2026, 10, 12, 14, 32));
		expect(name).toBe("Session 2026-11-12 1432");
		expect(isSessionName(name)).toBe(true);
		expect(isSessionName("Session 2026-11-12 1432 1")).toBe(true);
		expect(isSessionName("My session")).toBe(false);
		expect(sessionTitle("How does [[Notes/RAII|RAII]] release a lock? And what about: files")).toBe("How does RAII release a lock And what ab");
		expect(sessionTitle("解释一下协方差矩阵的对角线和非对角线分别代表什么，以及它为什么是对称的，再举一个二维的例子说明")).toHaveLength(40);
		expect(sessionTitle("/model sonnet")).toBe("");
		expect(sessionTitle("![[shot.png]]")).toBe("");
	});

	it("starts as two properties and a block that records as it goes", () => {
		const text = sessionNote("q1", "Session");
		expect(text).toContain("icap: session\nicap-id: q1\n");
		expect(text).toContain("```icap-ask\nid: q1\nkind: request\nrecord: live\n---\nSession\n```");
		const read = readRecords(text);
		expect(read.session).toEqual({ id: "q1" });
		expect(read.live).toEqual(["q1"]);
		expect(read.recording).toEqual(["q1"]);
		expect(findLiveRecord(text, "q1")?.record).toBeNull();
	});
});

describe("the record of a session", () => {
	const start = sessionNote("q1", "Session");

	it("gets each finished round, above the block", () => {
		const one = apply(start, appendRounds(start, "q1", "What is RAII?", [{ request: "What is RAII?", reply: "A resource tied to a lifetime." }], []));
		expect(one).toContain("> [!request] What is RAII?\n> **Request:** What is RAII?\n>\n> A resource tied to a lifetime.\n\n```icap-ask");
		const two = apply(one, appendRounds(one, "q1", "ignored", [{ request: "And a lock?", reply: "The destructor releases it.\n\nSee [[RAII]]." }], [{ kind: "created", path: "Notes/RAII.md" }]));
		expect(two).toContain("> A resource tied to a lifetime.\n>\n> **Request:** And a lock?\n>\n> The destructor releases it.\n>\n> See [[RAII]].\n>\n> **Files:** created [[Notes/RAII|RAII]]\n\n```icap-ask");
		const rounds = findLiveRecord(two, "q1")?.record?.rounds.map(({ from: _from, ...r }) => r);
		expect(rounds).toEqual([
			{ request: "What is RAII?", reply: "A resource tied to a lifetime." },
			{ request: "And a lock?", reply: "The destructor releases it.\n\nSee [[RAII]].", files: "created [[Notes/RAII|RAII]]" },
		]);
		expect(roundsTranscript(rounds!)).toBe("L: What is RAII?\nR: A resource tied to a lifetime.\nL: And a lock?\nR: The destructor releases it.\n\nSee [[RAII]].");
		// A reader sees one kept request record and a live block.
		const read = readRecords(two);
		expect(read.records).toHaveLength(1);
		expect(read.records[0].rounds).toHaveLength(2);
		expect(read.live).toEqual(["q1"]);
	});

	it("keeps what the learner changed in it", () => {
		const one = apply(start, appendRounds(start, "q1", "T", [{ request: "first", reply: "reply one" }], []));
		const edited = one.replace("reply one", "reply one, corrected by me");
		const two = apply(edited, appendRounds(edited, "q1", "T", [{ request: "second", reply: "reply two" }], []));
		expect(two).toContain("> reply one, corrected by me\n>\n> **Request:** second");
		expect(findLiveRecord(two, "q1")?.record?.rounds[0].reply).toBe("reply one, corrected by me");
	});

	it("gives back its last round, and goes with its only one", () => {
		const one = apply(start, appendRounds(start, "q1", "T", [{ request: "first", reply: "reply one" }], []));
		const two = apply(one, appendRounds(one, "q1", "T", [{ request: "second", reply: "reply two" }], [{ kind: "edited", path: "A.md" }]));
		const dropped = dropLastRound(two, "q1");
		expect(dropped?.round).toEqual({ request: "second", reply: "reply two", files: "changed [[A]]" });
		expect(apply(two, dropped!.splice)).toBe(one);
		const first = dropLastRound(one, "q1");
		expect(first?.round.request).toBe("first");
		expect(apply(one, first!.splice)).toBe(start);
	});

	it("is found only directly above its block", () => {
		const other = `> [!request] elsewhere\n> **Request:** x\n>\n> y\n\nA paragraph between.\n\n${sessionNote("q1", "Session").split("---\n\n")[1]}`;
		expect(findLiveRecord(other, "q1")?.record).toBeNull();
		expect(findLiveRecord("no block here", "q1")).toBeNull();
	});
});

describe("requestRounds", () => {
	const body = (md: string) =>
		md
			.split("\n")
			.slice(1)
			.map((l) => l.replace(/^> ?/, ""));

	it("reads a record kept at once the way it was written", () => {
		const md = requestRecord("Path", [{ request: "build a path", reply: "Done.\n\nTwo notes." }, { request: "shorter", reply: "Shortened." }], [{ kind: "created", path: "Path.md" }]);
		expect(requestRounds(body(md)).map(({ line: _line, ...r }) => r)).toEqual([
			{ request: "build a path", reply: "Done.\n\nTwo notes." },
			{ request: "shorter", reply: "Shortened.", files: "created [[Path]]" },
		]);
	});

	it("takes nothing inside a code fence for a marker", () => {
		const md = requestRecord("T", [{ request: "show it", reply: "```md\n**Request:** not a request\n\n**Files:** not files\n```\nafter" }], []);
		const rounds = requestRounds(body(md));
		expect(rounds).toHaveLength(1);
		expect(rounds[0].reply).toContain("**Request:** not a request");
		expect(rounds[0].files).toBeUndefined();
	});

	it("reads the Chinese markers and an empty record", () => {
		expect(requestRounds(["**请求:** 解释一下", "", "好的。", "", "**文件:** 新建 [[A]]"]).map(({ line: _line, ...r }) => r)).toEqual([{ request: "解释一下", reply: "好的。", files: "新建 [[A]]" }]);
		expect(requestRounds(["—"])).toEqual([]);
	});
});
