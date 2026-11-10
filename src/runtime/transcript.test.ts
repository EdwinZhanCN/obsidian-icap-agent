import { describe, expect, it } from "vite-plus/test";
import { coveredTranscript, reusable, sessionSig, transcriptOf, withReply } from "./transcript";
import type { Turn } from "./state.svelte";

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
