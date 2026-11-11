import { describe, expect, it } from "vite-plus/test";
import { keyProblem } from "./pi-login";



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
