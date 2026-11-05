/**
 * Interactive visuals (GenUI): an ```icap-ui fenced block holds an HTML fragment — markup, inline CSS
 * and JS — that the agent writes into a request's reply or a note it creates. ICAP renders it in a
 * sandboxed frame inside the note. This module is pure: the frame's document, and the Markdown rules
 * around the fence.
 *
 * The sandbox: `sandbox="allow-scripts"` without allow-same-origin gives the frame an opaque origin —
 * no access to the note, Obsidian, Node or storage — and the CSP below allows no network at all. What
 * a visual can do is exactly what the built-in `icap` object posts to the plugin (see host.ts), the
 * way MCP Apps hosts expose tools to their iframes.
 */

export const UI_LANG = "icap-ui";

/** Larger sources are not rendered (a visual is one idea, not an app). */
export const MAX_SOURCE = 60_000;

/** No network, no plugins, no forms posting anywhere; inline script and style only. The quotes matter. */
export const UI_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The note's theme variables a visual may use (copied from Obsidian into the frame). */
export const THEME_VARS = [
	"text-normal",
	"text-muted",
	"text-faint",
	"text-accent",
	"text-on-accent",
	"text-error",
	"text-success",
	"text-warning",
	"interactive-accent",
	"interactive-accent-hover",
	"interactive-normal",
	"interactive-hover",
	"background-primary",
	"background-primary-alt",
	"background-secondary",
	"background-modifier-border",
	"background-modifier-hover",
	"font-interface",
	"font-text",
	"font-monospace",
	"radius-s",
	"radius-m",
	"color-red",
	"color-orange",
	"color-yellow",
	"color-green",
	"color-cyan",
	"color-blue",
	"color-purple",
	"color-pink",
] as const;

export interface UiTheme {
	dark: boolean;
	/** THEME_VARS name (without --) → value. */
	vars: Record<string, string>;
}

/** Messages a frame posts to the plugin. Everything else is ignored. */
export type UiMessage =
	| { icap: "ui"; type: "size"; height: number }
	| { icap: "ui"; type: "ask"; text: string }
	| { icap: "ui"; type: "open"; link: string }
	| { icap: "ui"; type: "error"; message: string };

export const MAX_ASK = 2000;
export const MAX_HEIGHT = 1600;

/** Validate what a frame posted; anything malformed is null. */
export function parseUiMessage(data: unknown): UiMessage | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Record<string, unknown>;
	if (d.icap !== "ui") return null;
	switch (d.type) {
		case "size":
			return typeof d.height === "number" && Number.isFinite(d.height) ? { icap: "ui", type: "size", height: Math.max(0, Math.min(MAX_HEIGHT, Math.ceil(d.height))) } : null;
		case "ask": {
			const text = typeof d.text === "string" ? d.text.trim().slice(0, MAX_ASK) : "";
			return text ? { icap: "ui", type: "ask", text } : null;
		}
		case "open": {
			const link = typeof d.link === "string" ? d.link.replace(/^\[\[|\]\]$/g, "").trim() : "";
			return link && link.length <= 300 ? { icap: "ui", type: "open", link } : null;
		}
		case "error":
			return { icap: "ui", type: "error", message: String(d.message ?? "").slice(0, 300) };
		default:
			return null;
	}
}

const cssValue = (v: string) => v.replace(/[<>{};]/g, "").trim();

function rootVars(theme: UiTheme): string {
	return THEME_VARS.map((k) => (theme.vars[k] ? `--${k}:${cssValue(theme.vars[k])};` : "")).join("");
}

/** Obsidian-like defaults, so a visual looks native with little CSS of its own. */
const BASE_CSS = `*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{color:var(--text-normal);font-family:var(--font-interface);font-size:14px;line-height:1.5;padding:2px 1px;overflow-x:auto}
body>:first-child{margin-top:0}
body>:last-child{margin-bottom:0}
button{font:inherit;color:var(--text-normal);background:var(--interactive-normal);border:1px solid var(--background-modifier-border);border-radius:var(--radius-s,4px);padding:3px 12px;cursor:pointer}
button:hover{background:var(--interactive-hover)}
button.primary{background:var(--interactive-accent);color:var(--text-on-accent);border-color:transparent}
button.primary:hover{background:var(--interactive-accent-hover)}
button:disabled{opacity:.5;cursor:default}
input,select,textarea{font:inherit;color:var(--text-normal);background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:var(--radius-s,4px);padding:2px 6px}
input[type=range],input[type=checkbox],input[type=radio]{accent-color:var(--interactive-accent)}
code,pre{font-family:var(--font-monospace);font-size:.9em}
svg text{fill:currentColor;font-family:var(--font-interface)}
a{color:var(--text-accent)}
.muted{color:var(--text-muted)}`;

/**
 * The built-in runtime: the `icap` object, auto-sizing, errors, and theme updates. It runs before the
 * visual's own code. A visual can bypass it and post directly — the plugin checks every message anyway.
 */
const RUNTIME = `(function(){
var post=function(m){m.icap="ui";parent.postMessage(m,"*")};
var root=document.documentElement;
window.icap=Object.freeze({
ask:function(t){post({type:"ask",text:String(t)})},
open:function(l){post({type:"open",link:String(l)})},
get dark(){return root.classList.contains("dark")},
color:function(n){return getComputedStyle(root).getPropertyValue("--"+String(n).replace(/^--/,"")).trim()}
});
addEventListener("error",function(e){post({type:"error",message:String(e.message||e)})});
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.icap!=="ui"||d.type!=="theme")return;
root.classList.toggle("dark",!!d.dark);root.style.colorScheme=d.dark?"dark":"light";
for(var k in d.vars)root.style.setProperty("--"+k,d.vars[k]);
dispatchEvent(new Event("icap-theme"))});
var last=-1;var size=function(){var h=Math.ceil(document.body?document.body.getBoundingClientRect().height+4:0);if(h!==last){last=h;post({type:"size",height:h})}};
addEventListener("DOMContentLoaded",function(){new ResizeObserver(size).observe(document.body);size()});
addEventListener("load",size);
})();`;

/** The frame's whole document: CSP, theme, base styles, the runtime, then the visual's fragment. */
export function widgetDocument(source: string, theme: UiTheme): string {
	const scheme = theme.dark ? "dark" : "light";
	return (
		`<!doctype html><html class="${theme.dark ? "dark" : ""}" style="color-scheme:${scheme}"><head><meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${UI_CSP}">` +
		`<meta name="color-scheme" content="${scheme}">` +
		`<style>:root{${rootVars(theme)}}\n${BASE_CSS}</style>` +
		`<script>${RUNTIME}</script></head><body>\n${source}\n</body></html>`
	);
}

const OPEN = new RegExp("^(\\s*)(`{3,}|~{3,})\\s*" + UI_LANG + "\\b.*$");

/**
 * While a reply streams in, an icap-ui block is replaced by a placeholder line: half a script would
 * only flash errors. The finished reply renders the real visual.
 */
export function veilWidgets(md: string, placeholder: string): string {
	const lines = md.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(OPEN);
		if (!m) {
			out.push(lines[i]);
			continue;
		}
		const fence = m[2];
		const closes = (l: string) => {
			const t = l.trim();
			return t.length >= fence.length && [...t].every((c) => c === fence[0]);
		};
		let j = i + 1;
		while (j < lines.length && !closes(lines[j])) j++;
		out.push(`${m[1]}*${placeholder}*`);
		i = j; // skip through the closing fence (or to the end while it is still open)
	}
	return out.join("\n");
}
