// The ICAP Learning Agent site: a guide, the format reference, and the plugin's own interface shown
// live, imported from ../src (the same Svelte components and stylesheet the plugin ships).
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const plugin = fileURLToPath(new URL("../src", import.meta.url));
// The plugin's views import Obsidian's API; on the site they get a stand-in (src/demo/obsidian.ts).
const obsidian = fileURLToPath(new URL("./src/demo/obsidian.ts", import.meta.url));

export default defineConfig({
	site: "https://icap.edwinzhan.space",
	integrations: [
		starlight({
			title: "ICAP Learning Agent",
			defaultLocale: "root",
			locales: {
				root: { label: "English", lang: "en" },
				"zh-cn": { label: "简体中文", lang: "zh-CN" },
			},
			customCss: ["./src/styles/site.css"],
			sidebar: [
				{ label: "Start", translations: { "zh-CN": "开始" }, items: [{ autogenerate: { directory: "start" } }] },
				{ label: "Learn", translations: { "zh-CN": "学习" }, items: [{ autogenerate: { directory: "learn" } }] },
				{ label: "Settings", translations: { "zh-CN": "设置" }, items: [{ autogenerate: { directory: "settings" } }] },
				{ label: "Reference", translations: { "zh-CN": "参考" }, items: [{ autogenerate: { directory: "reference" } }] },
				{ label: "Design", translations: { "zh-CN": "设计" }, items: [{ autogenerate: { directory: "design" } }] },
				{ label: "Interface", translations: { "zh-CN": "界面组件" }, items: [{ autogenerate: { directory: "components" } }] },
			],
		}),
		svelte(),
	],
	vite: {
		plugins: [tailwindcss()],
		// The plugin's components resolve their packages from the repo root; one Svelte runtime for both.
		resolve: { dedupe: ["svelte", "motion", "@codemirror/view", "@lucide/svelte", "marked"], alias: { "@plugin": plugin, obsidian } },
		server: { fs: { allow: [".."] } },
	},
});
