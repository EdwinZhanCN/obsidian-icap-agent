// The ICAP Learning Agent site: a guide, the format reference, and the plugin's own interface shown
// live, imported from ../src (the same Svelte components and stylesheet the plugin ships).
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const plugin = fileURLToPath(new URL("../src", import.meta.url));

export default defineConfig({
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
				{ label: "Guide", translations: { "zh-CN": "指南" }, items: [{ autogenerate: { directory: "guides" } }] },
				{ label: "Interface", translations: { "zh-CN": "界面" }, items: [{ autogenerate: { directory: "components" } }] },
			],
		}),
		svelte(),
	],
	vite: {
		plugins: [tailwindcss()],
		// The plugin's components resolve their packages from the repo root; one Svelte runtime for both.
		resolve: { dedupe: ["svelte", "motion", "@codemirror/view"], alias: { "@plugin": plugin } },
		server: { fs: { allow: [".."] } },
	},
});
