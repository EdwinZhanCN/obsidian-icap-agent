import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	commandTrigger,
	hashText,
	insertArg,
	insertCommand,
	isIcapCommand,
	parseCommand,
	rankArgs,
	rankCommands,
	type SlashCommand,
} from "../src/dsl/commands";
import { keyProblem } from "../src/agent/pi-login";
import { blockOfFile, removeSessions, reusable, sessionExists, sessionId, sessionSig } from "../src/agent/session-cache";
import { coveredTranscript, transcriptOf, withReply } from "../src/runtime/transcript";
import type { Turn } from "../src/runtime/state.svelte";

describe("commandTrigger", () => {
	it("offers names while the first word is typed", () => {
		expect(commandTrigger("/", 1)).toEqual({ stage: "name", query: "" });
		expect(commandTrigger("/skill:re", 9)).toEqual({ stage: "name", query: "skill:re" });
	});
	it("offers one-word arguments after the name", () => {
		expect(commandTrigger("/model clau", 11)).toEqual({ stage: "arg", name: "model", query: "clau", start: 7 });
		expect(commandTrigger("/model ", 7)).toEqual({ stage: "arg", name: "model", query: "", start: 7 });
	});
	it("stays quiet for free text, other lines and non-commands", () => {
		expect(commandTrigger("/review the whole section", 25)).toBeNull();
		expect(commandTrigger("/review\nmore", 12)).toBeNull();
		expect(commandTrigger("look at /this", 13)).toBeNull();
		expect(commandTrigger(" /model", 7)).toBeNull();
	});
});

describe("parseCommand", () => {
	it("splits name and arguments", () => {
		expect(parseCommand("/skill:research Flow dialect dispatch")).toEqual({ name: "skill:research", args: "Flow dialect dispatch" });
		expect(parseCommand("  /compact  ")).toEqual({ name: "compact", args: "" });
		expect(parseCommand("/summarize\nwith two lines")).toEqual({ name: "summarize", args: "with two lines" });
	});
	it("is not fooled by paths or prose", () => {
		expect(parseCommand("what is /usr/bin")).toBeNull();
		expect(parseCommand("/ hello")).toBeNull();
	});
	it("knows ICAP's own", () => {
		expect(isIcapCommand("model")).toBe(true);
		expect(isIcapCommand("review")).toBe(false);
	});
});

describe("ranking and inserting", () => {
	const list: SlashCommand[] = [
		{ name: "review", source: "extension", description: "Review the current material" },
		{ name: "skill:research", source: "skill", description: "Research using tools" },
		{ name: "summarize", source: "prompt", description: "Summarize relevant notes" },
		{ name: "model", source: "icap" },
	];
	it("prefers name prefixes, finds skills by their bare name, then descriptions", () => {
		// "summarize" only matches by its description ("…relevant…"), so it comes last.
		expect(rankCommands(list, "re").map((c) => c.name)).toEqual(["review", "skill:research", "summarize"]);
		expect(rankCommands(list, "research")[0].name).toBe("skill:research");
		expect(rankCommands(list, "notes").map((c) => c.name)).toEqual(["summarize"]);
		expect(rankCommands(list, "").length).toBe(4);
	});
	it("ranks argument values", () => {
		expect(rankArgs(["anthropic/claude", "deepseek/v4", "openai/gpt"], "deep")).toEqual(["deepseek/v4"]);
		expect(rankArgs(["low", "medium", "minimal"], "m")).toEqual(["medium", "minimal"]);
	});
	it("inserts a command and keeps what follows", () => {
		expect(insertCommand("/re", "review")).toEqual({ text: "/review ", caret: 8 });
		expect(insertCommand("/re the section", "review")).toEqual({ text: "/review the section", caret: 8 });
	});
	it("inserts an argument", () => {
		const t = commandTrigger("/model clau", 11);
		if (t?.stage !== "arg") throw new Error("expected an argument trigger");
		expect(insertArg("/model clau", t, "anthropic/claude")).toEqual({ text: "/model anthropic/claude", caret: 23 });
	});
	it("hashes stably", () => {
		expect(hashText("abc")).toBe(hashText("abc"));
		expect(hashText("abc")).not.toBe(hashText("abd"));
		expect(hashText("")).toMatch(/^[0-9a-f]{8}$/);
	});
});

const req = (text: string, extra: Partial<Turn> = {}): Turn => ({ id: Math.random().toString(36), kind: "text", question: "", local: true, request: true, answer: { text }, ...extra });

describe("transcript and the session fingerprint", () => {
	it("leaves runtime commands out of the conversation", () => {
		const turns = [req("explain dispatch"), req("/model deepseek/v4", { control: true, reply: "From the next request on…" })];
		expect(transcriptOf({ turns })).toBe("L: explain dispatch");
	});

	it("what a round's session covers is exactly the next follow-up's history", () => {
		// Round 1 ended: the reply is still the block's summary.
		const block = { turns: [req("explain dispatch")], summary: "Dispatch regions are formed by…" };
		const covered = coveredTranscript(block);
		// A runtime command in between, then the follow-up: followUp files the reply, pushes the request.
		block.turns = withReply(block.turns, block.summary);
		block.summary = "";
		block.turns.push(req("/thinking high", { control: true, reply: "ok" }));
		block.turns.push(req("and the workgroups?"));
		const i = block.turns.length - 1;
		const history = transcriptOf(block, block.turns.slice(0, i));
		expect(history).toBe(covered);
		expect(reusable({ id: "icap-q1-1", sig: sessionSig("mine|/v", covered) }, "mine|/v", history)).toBe(true);
	});

	it("an agent question inside the round is part of what the session covers", () => {
		const ask: Turn = { id: "a", kind: "single", question: "Which?", options: [{ id: "a", label: "one" }], answer: { choices: ["a"] } };
		const block = { turns: [req("make notes"), ask], summary: "Created [[One]]." };
		const covered = coveredTranscript(block);
		const filed = withReply(block.turns, block.summary);
		expect(transcriptOf({ turns: filed })).toBe(covered);
		expect(covered).toContain("R: Created [[One]].");
	});

	it("a different setup or history is not resumed", () => {
		const s = { id: "icap-q1-1", sig: sessionSig("mine|/v", "L: a\nR: b") };
		expect(reusable(s, "isolated|/v", "L: a\nR: b")).toBe(false);
		expect(reusable(s, "mine|/v", "L: a\nR: c")).toBe(false);
		expect(reusable(null, "mine|/v", "")).toBe(false);
	});
});

describe("session files", () => {
	it("finds and removes a block's sessions, and prunes the rest", () => {
		const dir = mkdtempSync(join(tmpdir(), "icap-sessions-"));
		const touch = (n: string) => writeFileSync(join(dir, n), "{}\n");
		touch(`2026-11-04T10-00-00_${sessionId("qa1", 1)}.jsonl`);
		touch(`2026-11-04T10-05-00_${sessionId("qa1", 2)}.jsonl`);
		touch(`2026-11-04T10-06-00_${sessionId("qb2", 1)}.jsonl`);
		touch("2026-11-04T10-07-00_someone-elses.jsonl");
		expect(blockOfFile(`x_${sessionId("qa1", 12)}.jsonl`)).toBe("qa1");
		expect(sessionId("qa1", 1)).toBe("icap-qa1-1");
		expect(blockOfFile("x_icpa-qold-3.jsonl")).toBe("qold"); // sessions from before the rename
		expect(sessionExists(dir, sessionId("qa1", 2))).toBe(true);
		expect(removeSessions(dir, { block: "qa1" })).toBe(2);
		expect(removeSessions(dir, { keep: new Set(["qb2"]) })).toBe(0);
		expect(removeSessions(dir, { keep: new Set() })).toBe(1);
		expect(readdirSync(dir)).toEqual(["2026-11-04T10-07-00_someone-elses.jsonl"]);
	});
});

describe("keyProblem", () => {
	it("accepts keys and tokens as providers issue them", () => {
		for (const k of ["sk-0123456789abcdef0123456789abcdef", "sk-ant-api03-Ab_Cd-Ef", "AKIA1234/abc+def==", "code#state"]) expect(keyProblem(k)).toBeUndefined();
	});
	it("rejects a paste that cannot be a key", () => {
		expect(keyProblem("赫尔曼·梅尔维尔创作的小说")).toBe("not-a-key");
		expect(keyProblem("sk-abc，def")).toBe("not-a-key"); // full-width comma
		expect(keyProblem("sk-abc​def")).toBe("not-a-key"); // zero-width space
		expect(keyProblem("sk-abc def")).toBe("space");
		expect(keyProblem("sk-abc\ndef")).toBe("space");
	});
});
