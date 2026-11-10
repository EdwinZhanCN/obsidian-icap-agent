import { describe, expect, it } from "vite-plus/test";
import { parseAskSource, parseAuthored } from "../dsl/blocks";
import { guideNote } from "./guide";



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
