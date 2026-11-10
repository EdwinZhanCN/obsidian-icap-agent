import { builtinModules } from "node:module";
import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwind from "@tailwindcss/vite";
import { obsidianBuild } from "./tooling/obsidian-build";
import { piPack } from "./tooling/pi-bundle";

const hostModules = new Set(["obsidian", "electron", "kerberos", ...builtinModules]);
export default defineConfig(({ mode }) => ({
  plugins: [svelte({ emitCss: false, compilerOptions: { dev: mode === "development" } }), tailwind(), obsidianBuild()],
  resolve: { conditions: ["svelte", "browser"] },
  build: {
    outDir: "build/plugin", emptyOutDir: false, target: "es2022", sourcemap: mode === "development" ? "inline" : false,
    minify: mode !== "development", cssCodeSplit: false,
    lib: { entry: "tooling/plugin-entry.ts", formats: ["cjs"], fileName: () => "main.js", cssFileName: "styles" },
    rolldownOptions: {
      external: (id) => hostModules.has(id) || id.startsWith("node:") || id.startsWith("@codemirror/") || id.startsWith("@lezer/"),
      output: { exports: "default", codeSplitting: false, dynamicImportInCjs: false },
    },
  },
  pack: piPack(),
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.spec.test.ts"], environment: "node" } },
      { test: { name: "integration", include: ["test/integration/**/*.spec.test.ts"], environment: "node" } },
    ],
  },
  check: { fmt: false },
  lint: { options: { typeAware: true, typeCheck: true }, ignorePatterns: ["docs/**", "dev-vault/**", "build/**", "main.js", "styles.css", "marketing/**"] },
}));
