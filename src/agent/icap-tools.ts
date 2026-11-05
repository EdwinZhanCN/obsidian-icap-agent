import { realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, relative, resolve as resolvePath } from "path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiSdk } from "./pi-host";

/**
 * ICAP's tools, registered in-process on every task's Pi session. Each is a thin, declarative request to
 * the plugin (`onBridge`), which renders it inside the Markdown document — an Interactive Block, a note,
 * a reviewable edit — and returns JSON. The agent never touches the vault through these tools directly.
 */

type Json = Record<string, unknown>;
export type BridgeHandler = (op: string, payload: Json) => Promise<Json>;

function expandHome(p: string): string {
	return p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

/** Resolve symlinks as far as the path exists, so a link can't lead outside. */
export function realish(p: string): string {
	let head = p;
	const tail: string[] = [];
	for (;;) {
		try {
			return resolvePath(realpathSync(head), ...tail.reverse());
		} catch {
			const parent = resolvePath(head, "..");
			if (parent === head) return p;
			tail.push(head.slice(parent.length).replace(/^[/\\]/, ""));
			head = parent;
		}
	}
}

export function inside(target: string, root: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Isolated mode: may a file tool reach `raw` (relative to `cwd`) given the allowed roots? */
export function allowedPath(raw: string, cwd: string, roots: string[]): boolean {
	const abs = realish(resolvePath(cwd, expandHome(raw.replace(/^@/, ""))));
	return roots.some((r) => inside(abs, realish(r)));
}

function text(result: Json): string {
	return JSON.stringify(result, null, 2);
}

/**
 * The extension that registers ICAP's tools. `roots` (isolated mode): file tools stay inside the vault
 * and the folders the learner allowed.
 */
export function icapExtension(pi: PiSdk, bridge: BridgeHandler, roots?: string[]) {
	const { Type } = pi;
	const call = async (op: string, payload: Json): Promise<Json> => {
		try {
			return await bridge(op, payload);
		} catch (e) {
			return { status: "error", message: (e as Error).message };
		}
	};

	const OptionSchema = Type.Object({
		id: Type.String({ description: "Short stable id, e.g. 'a', 'b'." }),
		label: Type.String({ description: "Option text without any letter prefix (the note letters them). Markdown allowed." }),
	});

	const AskParams = Type.Object({
		kind: Type.Union([Type.Literal("single"), Type.Literal("multi"), Type.Literal("text"), Type.Literal("confirm")], {
			description: "single = one choice, multi = several choices, text = free writing, confirm = yes/no.",
		}),
		question: Type.String({
			description: "The question, in Markdown. One focused question. Do not list the options here; pass them in `options`.",
		}),
		options: Type.Optional(Type.Array(OptionSchema, { description: "Required for single/multi. 2–6 options." })),
		feedback: Type.Optional(
			Type.String({
				description:
					"Feedback on the learner's PREVIOUS answer, in Markdown, shown directly under that answer. " +
					"Point out what holds, what is missing or inaccurate and why. Never rewrite their answer for them.",
			}),
		),
		verdict: Type.Optional(
			Type.Union([Type.Literal("holds"), Type.Literal("partly"), Type.Literal("reconsider")], {
				description: "Your judgement of the PREVIOUS answer, only when feedback is given.",
			}),
		),
		revise: Type.Optional(
			Type.Boolean({
				description: "For kind=text: invite the learner to revise their previous answer (their earlier text is pre-filled for them to edit).",
			}),
		),
		placeholder: Type.Optional(Type.String({ description: "Hint shown in an empty writing area." })),
		confirm_label: Type.Optional(Type.String({ description: "For kind=confirm: label of the affirmative action." })),
		cancel_label: Type.Optional(Type.String({ description: "For kind=confirm: label of the negative action." })),
	});

	const VaultParams = Type.Object({
		command: Type.Union(
			["search", "search:context", "read", "links", "backlinks", "outline", "properties", "aliases", "tags", "files"].map((c) => Type.Literal(c)),
			{ description: "The Obsidian CLI command to run." },
		),
		file: Type.Optional(Type.String({ description: "Note name, resolved like a wikilink (no path or extension needed)." })),
		path: Type.Optional(Type.String({ description: "Exact vault path, e.g. folder/note.md." })),
		query: Type.Optional(Type.String({ description: "For search / search:context: words that must all appear, plus path:, file:, tag: operators." })),
		folder: Type.Optional(Type.String({ description: "For search / files: only inside this vault folder." })),
		ext: Type.Optional(Type.String({ description: "For files: only this extension, e.g. pdf." })),
		limit: Type.Optional(Type.Number({ description: "Maximum results." })),
	});

	const DocumentParams = Type.Object({
		path: Type.String({ description: "Vault-relative path (e.g. Sources/book.pdf) or an absolute path." }),
		pages: Type.Optional(Type.String({ description: 'Pages to read: "12", "3-7", "40-" or "1,4,9-11". Default: from page 1.' })),
		outline: Type.Optional(
			Type.Boolean({ description: "true = return only the outline and page count (unless pages is given). false = leave the outline out." }),
		),
	});

	const CreateNoteParams = Type.Object({
		title: Type.String({ description: "Note title (becomes the file name). No slashes." }),
		folder: Type.Optional(Type.String({ description: "Vault folder. Omit to use the learner's default." })),
		content: Type.String({ description: "Full Markdown content of the new note. Use [[wikilinks]] to related notes." }),
		purpose: Type.String({ description: "One short phrase: why this note exists (shown to the learner)." }),
	});

	const ProposeEditParams = Type.Object({
		path: Type.String({ description: "Vault-relative path of an EXISTING note." }),
		find: Type.String({ description: "Exact text currently in the note to replace. Empty string = append at the end." }),
		replace: Type.String({ description: "Replacement Markdown." }),
		summary: Type.String({ description: "One sentence describing the change, shown to the learner for review." }),
	});

	return (api: ExtensionAPI) => {
		api.registerTool({
			name: "ask_learner",
			label: "Ask learner",
			description:
				"Ask the learner one question inside their Markdown note and wait for the answer. " +
				"Use it to check understanding, request a clarification, offer a choice, or ask permission. " +
				"Attach `feedback` + `verdict` when responding to their previous answer. Returns their answer as JSON.",
			promptSnippet: "ask_learner: ask one question in the learner's note and wait for their answer",
			parameters: AskParams,
			executionMode: "sequential",
			async execute(_id, params) {
				if ((params.kind === "single" || params.kind === "multi") && !((params.options?.length ?? 0) >= 2)) {
					throw new Error("single/multi questions need at least two options");
				}
				const result = await call("ask", params as Json);
				return { content: [{ type: "text", text: text(result) }], details: result };
			},
		});

		api.registerTool({
			name: "create_note",
			label: "Create note",
			description:
				"Create a NEW Markdown note in the learner's vault. Returns the created path. Never use this to modify existing notes — use propose_edit.",
			promptSnippet: "create_note: create a new Markdown note in the vault",
			parameters: CreateNoteParams,
			executionMode: "sequential",
			async execute(_id, params) {
				const result = await call("create_note", params as Json);
				if (result.status === "error") throw new Error(String(result.message ?? "create_note failed"));
				return { content: [{ type: "text", text: text(result) }], details: result };
			},
		});

		api.registerTool({
			name: "obsidian",
			label: "Obsidian",
			description:
				"Read-only Obsidian vault queries, answered by the running Obsidian app (same commands as the Obsidian CLI). " +
				"Use it for what plain file tools get wrong: resolved [[links]], backlinks, headings, properties, aliases and tags. " +
				"Commands: search {query, folder?, limit?} → matching note paths; search:context {query, folder?, limit?} → matching lines as path:line: text " +
				'(query: words that must all appear, plus the operators path:x, file:x and tag:#x; quote values with spaces: path:"My Folder"); ' +
				"read {file|path}; links {file|path} → outgoing links, resolved to paths; backlinks {file|path} → notes linking here; " +
				"outline {file|path} → headings; properties {file|path} → frontmatter; aliases {file|path?}; tags {file|path?} (vault-wide with counts when no file); " +
				"files {folder?, ext?}. `file` resolves like a wikilink (name only); `path` is the exact vault path.",
			promptSnippet: "obsidian: query the vault through Obsidian — search, links, backlinks, outline, properties, aliases, tags, files",
			parameters: VaultParams,
			async execute(_id, params) {
				const result = await call("vault", params as Json);
				if (result.status === "error") throw new Error(String(result.message ?? "obsidian failed"));
				return { content: [{ type: "text", text: text(result) }], details: undefined };
			},
		});

		api.registerTool({
			name: "read_document",
			label: "Read document",
			description:
				"Read a PDF as text, through Obsidian's built-in PDF reader: its outline (chapters with page numbers) and a range of pages. " +
				"Start with outline: true to see the structure, then read the pages you need (at most 30 pages per call). " +
				"`path` is vault-relative (e.g. Sources/book.pdf) or absolute. Plain-text files are returned as they are. " +
				"Cite pages as [[book.pdf#page=12]].",
			promptSnippet: "read_document: read a PDF's outline and pages as text",
			parameters: DocumentParams,
			async execute(_id, params) {
				const result = await call("read_document", params as Json);
				if (result.status === "error") throw new Error(String(result.message ?? "read_document failed"));
				return { content: [{ type: "text", text: text(result) }], details: undefined };
			},
		});

		api.registerTool({
			name: "propose_edit",
			label: "Propose edit",
			description:
				"Propose a change to an EXISTING note. The learner reviews a diff inside their document and accepts or declines. " +
				"Returns {status:'accepted'|'declined'}.",
			promptSnippet: "propose_edit: propose a reviewable edit to an existing note",
			parameters: ProposeEditParams,
			executionMode: "sequential",
			async execute(_id, params) {
				const result = await call("propose_edit", params as Json);
				if (result.status === "error") throw new Error(String(result.message ?? "propose_edit failed"));
				return { content: [{ type: "text", text: text(result) }], details: result };
			},
		});

		if (roots) {
			api.on("tool_call", async (event, ctx) => {
				if (!["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
				const input = event.input as { path?: unknown };
				const raw = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : ".";
				if (allowedPath(raw, ctx.cwd, roots)) return undefined;
				return { block: true, reason: `"${raw}" is outside the vault and the folders the learner allowed.` };
			});
		}
	};
}
