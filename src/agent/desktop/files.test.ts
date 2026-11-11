import { describe, expect, it } from "vite-plus/test";
import { within } from "./files";

describe("files outside the vault", () => {
	it("knows what is inside the allowed folders", () => {
		expect(within("/v/notes/a.pdf", ["/v"])).toBe(true);
		expect(within("/v", ["/v"])).toBe(true);
		expect(within("/vault2/a.pdf", ["/v"])).toBe(false);
		expect(within("/v/../etc/hosts", ["/v"])).toBe(false);
		expect(within("/books/x.pdf", ["/v", "/books"])).toBe(true);
	});
});
