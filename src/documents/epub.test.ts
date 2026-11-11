import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { parseEpub, resolveHref } from "./epub";

function epub(files: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe("EPUB", () => {
	it("resolves hrefs against the file that holds them", () => {
		expect(resolveHref("OEBPS/nav/toc.xhtml", "../text/ch%201.xhtml#s2")).toEqual({ file: "OEBPS/text/ch 1.xhtml", fragment: "s2" });
	});
	it("reads the EPUB 3 nav and splits a chapter where the table of contents points inside it", () => {
		const data = epub({
			"META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
			"OEBPS/content.opf": `<package><metadata><dc:title>深度学习</dc:title></metadata><manifest>
				<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
				<item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
				<item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
				<item id="img" href="img/a.png" media-type="image/png"/></manifest>
				<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
			"OEBPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol>
				<li><a href="text/c1.xhtml">第一章 引言</a><ol><li><a href="text/c1.xhtml#s2">1.2 背景</a></li></ol></li>
				<li><a href="text/c2.xhtml">第二章 方法</a></li></ol></nav></body></html>`,
			"OEBPS/text/c1.xhtml": `<html><body><h1>第一章 引言</h1><p>开头。</p><h2 id="s2">1.2 背景</h2><p>背景内容。</p></body></html>`,
			"OEBPS/text/c2.xhtml": `<html><body><h1>第二章 方法</h1><p>方法内容。</p></body></html>`,
		});
		const p = parseEpub(data);
		expect(p.title).toBe("深度学习");
		expect(p.toc_source).toBe("nav");
		expect(p.units).toEqual(["# 第一章 引言\n\n开头。", "## 1.2 背景\n\n背景内容。", "# 第二章 方法\n\n方法内容。"]);
		expect(p.headings).toEqual([
			{ level: 1, title: "第一章 引言", unit: 1 },
			{ level: 2, title: "1.2 背景", unit: 2 },
			{ level: 1, title: "第二章 方法", unit: 3 },
		]);
	});
	it("falls back to the NCX of EPUB 2", () => {
		const data = epub({
			"META-INF/container.xml": `<rootfile full-path="book.opf"/>`,
			"book.opf": `<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="a.html" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="a"/></spine></package>`,
			"toc.ncx": `<ncx><navMap><navPoint><navLabel><text>Only chapter</text></navLabel><content src="a.html"/></navPoint></navMap></ncx>`,
			"a.html": `<html><body><p>Text.</p></body></html>`,
		});
		const p = parseEpub(data);
		expect(p.headings).toEqual([{ level: 1, title: "Only chapter", unit: 1 }]);
		expect(p.toc_source).toBe("nav");
	});
});
