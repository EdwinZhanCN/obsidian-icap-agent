/**
 * The learner's connectors in the settings: the MCP servers of Pi's global `mcp.json`, read and written
 * with the harness's own functions (the file keeps its other content and its indentation). The same file
 * the built-in agent's full scope and the learner's own Pi read, so a change applies to both, from the
 * next task. Only the global file: a vault's `.pi/mcp.json` stays the learner's to edit.
 */
import { join } from "path";
import { L } from "../../i18n";
import type { BackendConnectors, Connector, ConnectorSpec } from "../backend";
import type { PiSdk } from "./pi-host";
import { CONNECTOR_NAME, joinCommand } from "../connectors";

export class DesktopConnectors implements BackendConnectors {
	constructor(private pi: () => Promise<PiSdk>) {}

	private async file(): Promise<{ pi: PiSdk; path: string }> {
		const pi = await this.pi();
		return { pi, path: join(pi.getAgentDir(), "mcp.json") };
	}

	async list() {
		const { pi, path } = await this.file();
		const loaded = pi.loadMcpConfig({ agentDir: pi.getAgentDir(), cwd: pi.getAgentDir(), projectTrusted: false });
		const servers: Connector[] = loaded.servers.map((s) => {
			const c = s.config as { command?: string; args?: string[]; url?: string; enabled?: boolean };
			return c.url !== undefined
				? { name: s.name, kind: "http" as const, target: c.url, enabled: c.enabled !== false }
				: { name: s.name, kind: "stdio" as const, target: joinCommand(c.command ?? "", c.args), enabled: c.enabled !== false };
		});
		return { servers, file: path, errors: loaded.errors };
	}

	async setEnabled(name: string, enabled: boolean) {
		const { pi, path } = await this.file();
		pi.updateMcpServerConfig(path, name, { enabled });
	}

	async add(name: string, spec: ConnectorSpec) {
		if (!CONNECTOR_NAME.test(name)) throw new Error(L("A name is letters, digits, _ and - only.", "名称只能包含字母、数字、_ 和 -。"));
		const { pi, path } = await this.file();
		const existing = await this.list();
		if (existing.servers.some((s) => s.name === name)) throw new Error(L(`“${name}” is already a connector.`, `已经有名为“${name}”的 Connector。`));
		if ("url" in spec) {
			if (!/^https?:\/\/\S+$/.test(spec.url)) throw new Error(L("The URL starts with http:// or https://.", "URL 需要以 http:// 或 https:// 开头。"));
			pi.addMcpServerConfig(path, name, { url: spec.url });
		} else {
			if (!spec.command) throw new Error(L("Give the command that starts the server.", "填写启动服务器的命令。"));
			pi.addMcpServerConfig(path, name, { command: spec.command, ...(spec.args.length ? { args: spec.args } : {}) });
		}
	}

	async remove(name: string) {
		const { pi, path } = await this.file();
		pi.removeMcpServerConfig(path, name);
	}

	async reveal() {
		const { path } = await this.file();
		// Electron's shell, through Obsidian's own require (desktop only).
		(window.require("electron") as { shell: { showItemInFolder(p: string): void } }).shell.showItemInFolder(path);
	}
}
