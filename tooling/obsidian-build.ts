import { existsSync, lstatSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite-plus/pack";
import type { Plugin } from "vite-plus";
import { piBundle, piEntry, piPack } from "./pi-bundle";

/** Build Pi with Node semantics; Vite then embeds it behind the existing lazy import. */
export function obsidianBuild(): Plugin {
  return {
    name: "icap-obsidian-build",
    apply: "build",
    async buildStart() {
      this.addWatchFile(piEntry);
      this.addWatchFile(resolve("src/agent/desktop/pi-node.ts"));
      await build({ ...piPack(), config: false });
    },
    resolveId(source, importer) {
      if (importer && /\/pi-sdk-entry(?:\.ts)?$/.test(source)) return piBundle;
    },
    async writeBundle() {
      for (const file of ["main.js", "styles.css"]) {
        await copyFile(`build/plugin/${file}`, file);
        const target = `dev-vault/.obsidian/plugins/icap-agent/${file}`;
        if (existsSync(target) && !lstatSync(target).isSymbolicLink()) await copyFile(file, target);
      }
    },
  };
}
