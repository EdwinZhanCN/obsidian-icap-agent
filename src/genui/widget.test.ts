import { describe, expect, it } from "vite-plus/test";
import { MAX_ASK, MAX_HEIGHT, UI_CSP, parseUiMessage, veilWidgets, widgetDocument } from "./widget";

const theme = { dark: true, vars: { "text-normal": "#ddd", "interactive-accent": "hsl(258, 88%, 66%)", "font-interface": "Inter, sans-serif" } };

describe("visual document", () => {
	const doc = widgetDocument('<button id="b">go</button><script>b.onclick=()=>icap.ask("why?")</script>', theme);

	it("locks the frame down with a CSP whose keywords keep their quotes", () => {
		expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${UI_CSP}">`);
		expect(UI_CSP).toContain("default-src 'none'");
		expect(UI_CSP).toContain("script-src 'unsafe-inline'");
		expect(UI_CSP).not.toMatch(/https?:|connect-src|'self'/);
	});
	it("passes the note's theme and runs the built-in runtime before the visual", () => {
		expect(doc).toContain("--text-normal:#ddd;");
		expect(doc).toContain("--interactive-accent:hsl(258, 88%, 66%);");
		expect(doc).toContain('class="dark"');
		expect(doc).toContain("color-scheme:dark");
		expect(doc.indexOf("window.icap=")).toBeLessThan(doc.indexOf('<button id="b">'));
	});
	it("cannot be broken out of through a theme value", () => {
		const bad = widgetDocument("x", { dark: false, vars: { "text-normal": "red}</style><script>alert(1)</script>" } });
		expect(bad).not.toContain("<script>alert(1)");
	});
});

describe("what a visual may post", () => {
	it("accepts the four messages, bounded", () => {
		expect(parseUiMessage({ icap: "ui", type: "size", height: 99999 })).toEqual({ icap: "ui", type: "size", height: MAX_HEIGHT });
		expect(parseUiMessage({ icap: "ui", type: "ask", text: "  why?  " })).toEqual({ icap: "ui", type: "ask", text: "why?" });
		expect((parseUiMessage({ icap: "ui", type: "ask", text: "x".repeat(5000) }) as { text: string }).text).toHaveLength(MAX_ASK);
		expect(parseUiMessage({ icap: "ui", type: "open", link: "[[Gradient descent]]" })).toEqual({ icap: "ui", type: "open", link: "Gradient descent" });
		expect(parseUiMessage({ icap: "ui", type: "error", message: "boom" })).toMatchObject({ type: "error" });
	});
	it("ignores anything else", () => {
		for (const d of [null, "ask", { type: "ask", text: "x" }, { icap: "ui", type: "ask", text: "  " }, { icap: "ui", type: "eval", code: "1" }, { icap: "ui", type: "size", height: "1e9" }])
			expect(parseUiMessage(d)).toBeNull();
	});
});

describe("streaming placeholder", () => {
	it("hides visuals, closed or still open, and nothing else", () => {
		const md = "Try this:\n\n```icap-ui\n<div>…</div>\n```\n\n```python\nprint(1)\n```\n\nThen:\n\n````icap-ui\n<script>let a = 1";
		expect(veilWidgets(md, "drawing…")).toBe("Try this:\n\n*drawing…*\n\n```python\nprint(1)\n```\n\nThen:\n\n*drawing…*");
	});
});
