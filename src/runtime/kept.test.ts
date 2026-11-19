import { describe, expect, it } from "vite-plus/test";
import { roundsOf } from "./kept";
import type { Turn } from "./state.svelte";

const req = (text: string, extra: Partial<Turn> = {}): Turn => ({
	id: Math.random().toString(36),
	kind: "text",
	question: "",
	local: true,
	request: true,
	answer: { text },
	...extra,
});

describe("roundsOf", () => {
	it("combines pre-ask_learner prose with the round's final summary", () => {
		const ask: Turn = {
			id: "u2",
			kind: "text",
			question: "What do you get for u = ln r?",
			answer: { text: "0" },
		};
		const block = {
			turns: [req("Explain (4.2.1)", { reply: "Explanation of the three terms." }), ask],
			summary: "Correct — that confirms the 1/r term cancels the second derivative.",
		};
		expect(roundsOf(block)).toEqual([
			{
				request: "Explain (4.2.1)",
				reply: "Explanation of the three terms.\n\nCorrect — that confirms the 1/r term cancels the second derivative.",
			},
		]);
	});

	it("keeps pre-ask_learner prose even when there is no final summary yet", () => {
		const ask: Turn = { id: "u2", kind: "text", question: "Follow-up?" };
		const block = {
			turns: [req("Explain (4.2.1)", { reply: "Explanation of the three terms." }), ask],
			summary: "",
		};
		expect(roundsOf(block)).toEqual([{ request: "Explain (4.2.1)", reply: "Explanation of the three terms." }]);
	});
});
