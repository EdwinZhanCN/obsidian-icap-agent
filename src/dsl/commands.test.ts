import { describe, expect, it } from "vite-plus/test";
import { commandTrigger, hashText, insertArg, insertCommand, isIcapCommand, parseCommand, rankArgs, rankCommands, type SlashCommand } from "./commands";



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
