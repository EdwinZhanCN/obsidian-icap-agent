import { describe, expect, it } from "vite-plus/test";
import { htmlToText } from "./html";



describe("XHTML to text", () => {
	it("keeps headings, lists, tables and entities readable", () => {
		const t = htmlToText(`<html><head><style>p{}</style></head><body><h2>Title <em>here</em></h2><p>A&amp;B&#160;&#x4e2d;</p><ul><li>one</li><li>two</li></ul><table><tr><td>x</td><td>y</td></tr></table></body></html>`);
		expect(t).toBe("## Title here\n\nA&B 中\n\n- one\n- two\n\nx | y");
	});
});
