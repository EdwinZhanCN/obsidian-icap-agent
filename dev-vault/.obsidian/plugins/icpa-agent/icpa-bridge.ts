/**
 * icpa-bridge — Pi extension shipped with the Obsidian "icpa-agent" plugin.
 *
 * Every tool here is a thin, declarative request back to Obsidian. The request travels
 * over Pi RPC as an `extension_ui_request` (method "editor") whose title starts with
 * "icpa:" and whose prefill is a JSON payload. Obsidian renders the request inside the
 * Markdown document (an Interactive Block, a note, a reviewable edit) and answers with an
 * `extension_ui_response` carrying JSON. The agent never touches the vault directly.
 *
 * This file is loaded by Pi through jiti; `typebox` is host-provided by Pi.
 */
import { Type } from "typebox";
import { realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, relative, resolve as resolvePath } from "path";

const PREFIX = "icpa:";

/** Set by the plugin in isolated mode: the vault plus the folders the learner allowed (JSON array). */
function allowedRoots(): string[] | null {
	const raw = process.env.ICPA_ALLOWED_ROOTS;
	if (!raw) return null;
	try {
		const list = JSON.parse(raw);
		return Array.isArray(list) ? list.map((r) => realish(String(r))) : null;
	} catch {
		return null;
	}
}

function expandHome(p: string): string {
	return p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

/** Resolve symlinks as far as the path exists, so a link can't lead outside. */
function realish(p: string): string {
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

function inside(target: string, root: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

type Json = Record<string, unknown>;

async function bridge(ctx: any, op: string, payload: Json): Promise<Json> {
	if (!ctx?.ui?.editor) return { status: "error", message: "No document UI is attached." };
	const raw: string | undefined = await ctx.ui.editor(PREFIX + op, JSON.stringify(payload));
	if (raw === undefined) return { status: "cancelled" };
	try {
		return JSON.parse(raw) as Json;
	} catch {
		return { status: "error", message: "Malformed response from the document." };
	}
}

function text(result: Json): string {
	return JSON.stringify(result, null, 2);
}

const OptionSchema = Type.Object({
	id: Type.String({ description: "Short stable id, e.g. 'a', 'b'." }),
	label: Type.String({ description: "Option text without any letter prefix (the note letters them). Markdown allowed." }),
});

const AskParams = Type.Object({
	kind: Type.Union(
		[Type.Literal("single"), Type.Literal("multi"), Type.Literal("text"), Type.Literal("confirm")],
		{ description: "single = one choice, multi = several choices, text = free writing, confirm = yes/no." },
	),
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
			description:
				"For kind=text: invite the learner to revise their previous answer (their earlier text is pre-filled for them to edit).",
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
	outline: Type.Optional(Type.Boolean({ description: "true = return only the outline and page count (unless pages is given). false = leave the outline out." })),
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

export default function icpaBridge(pi: any) {
	pi.registerTool({
		name: "ask_learner",
		label: "Ask learner",
		description:
			"Ask the learner one question inside their Markdown note and wait for the answer. " +
			"Use it to check understanding, request a clarification, offer a choice, or ask permission. " +
			"Attach `feedback` + `verdict` when responding to their previous answer. Returns their answer as JSON.",
		promptSnippet: "ask_learner: ask one question in the learner's note and wait for their answer",
		parameters: AskParams,
		executionMode: "sequential",
		async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			if ((params.kind === "single" || params.kind === "multi") && !(params.options?.length >= 2)) {
				throw new Error("single/multi questions need at least two options");
			}
			const result = await bridge(ctx, "ask", params);
			return { content: [{ type: "text", text: text(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "create_note",
		label: "Create note",
		description:
			"Create a NEW Markdown note in the learner's vault. Returns the created path. " +
			"Never use this to modify existing notes — use propose_edit.",
		promptSnippet: "create_note: create a new Markdown note in the vault",
		parameters: CreateNoteParams,
		executionMode: "sequential",
		async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const result = await bridge(ctx, "create_note", params);
			if (result.status === "error") throw new Error(String(result.message ?? "create_note failed"));
			return { content: [{ type: "text", text: text(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "obsidian",
		label: "Obsidian",
		description:
			"Read-only Obsidian vault queries, answered by the running Obsidian app (same commands as the Obsidian CLI). " +
			"Use it for what plain file tools get wrong: resolved [[links]], backlinks, headings, properties, aliases and tags. " +
			"Commands: search {query, folder?, limit?} → matching note paths; search:context {query, folder?, limit?} → matching lines as path:line: text " +
			"(query: words that must all appear, plus the operators path:x, file:x and tag:#x; quote values with spaces: path:\"My Folder\"); " +
			"read {file|path}; links {file|path} → outgoing links, resolved to paths; backlinks {file|path} → notes linking here; " +
			"outline {file|path} → headings; properties {file|path} → frontmatter; aliases {file|path?}; tags {file|path?} (vault-wide with counts when no file); " +
			"files {folder?, ext?}. `file` resolves like a wikilink (name only); `path` is the exact vault path.",
		promptSnippet: "obsidian: query the vault through Obsidian — search, links, backlinks, outline, properties, aliases, tags, files",
		parameters: VaultParams,
		async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const result = await bridge(ctx, "vault", params);
			if (result.status === "error") throw new Error(String(result.message ?? "obsidian failed"));
			return { content: [{ type: "text", text: text(result) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "read_document",
		label: "Read document",
		description:
			"Read a PDF as text, through Obsidian's built-in PDF reader: its outline (chapters with page numbers) and a range of pages. " +
			"Start with outline: true to see the structure, then read the pages you need (at most 30 pages per call). " +
			"`path` is vault-relative (e.g. Sources/book.pdf) or absolute. Plain-text files are returned as they are. " +
			"Cite pages as [[book.pdf#page=12]].",
		promptSnippet: "read_document: read a PDF's outline and pages as text",
		parameters: DocumentParams,
		async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const result = await bridge(ctx, "read_document", params);
			if (result.status === "error") throw new Error(String(result.message ?? "read_document failed"));
			return { content: [{ type: "text", text: text(result) }], details: undefined };
		},
	});

	// Isolated mode: file tools stay inside the vault and the folders the learner allowed.
	const roots = allowedRoots();
	if (roots) {
		pi.on("tool_call", async (event: any, ctx: any) => {
			if (!["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
			const raw = typeof event.input?.path === "string" && event.input.path.trim() ? event.input.path.trim() : ".";
			const abs = realish(resolvePath(ctx?.cwd ?? process.cwd(), expandHome(raw.replace(/^@/, ""))));
			if (roots.some((r) => inside(abs, r))) return undefined;
			return { block: true, reason: `"${raw}" is outside the vault and the folders the learner allowed.` };
		});
	}

	pi.registerTool({
		name: "propose_edit",
		label: "Propose edit",
		description:
			"Propose a change to an EXISTING note. The learner reviews a diff inside their document and accepts or declines. " +
			"Returns {status:'accepted'|'declined'}.",
		promptSnippet: "propose_edit: propose a reviewable edit to an existing note",
		parameters: ProposeEditParams,
		executionMode: "sequential",
		async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const result = await bridge(ctx, "propose_edit", params);
			if (result.status === "error") throw new Error(String(result.message ?? "propose_edit failed"));
			return { content: [{ type: "text", text: text(result) }], details: result };
		},
	});
}
