import type { TSchema, Type as TypeBuilder } from "typebox";
import type { BridgeHandler, Json } from "../backend";

/**
 * ICAP's tools, platform-neutral: name, description, schema, execute. Each is a thin, declarative
 * request to the plugin (`bridge`), which renders it inside the Markdown document — an Interactive
 * Block, a note, a reviewable edit — and returns JSON. The agent never touches the vault through these
 * tools directly. A backend wraps them for its agent (desktop: agent/desktop/icap-extension.ts).
 */

/** The tools ICAP registers on every task's agent. */
export const ICAP_TOOLS = ["obsidian", "read_document", "documents", "ask_learner", "create_note", "propose_edit"];

export interface IcapTool {
	name: string;
	label: string;
	description: string;
	/** One line for the system prompt's tool list. */
	promptSnippet: string;
	parameters: TSchema;
	/** Calls must not run in parallel with others (they wait for the learner). */
	sequential: boolean;
	/** The result as text for the model, and the details kept with the tool result. Throws on error. */
	execute(params: Json): Promise<{ text: string; details: Json | undefined }>;
}

function text(result: Json): string {
	return JSON.stringify(result, null, 2);
}

/**
 * The tools, in the order they are registered. `Type` is the TypeBox the agent validates with (the
 * backend's own copy), so the schemas are its own.
 */
export function icapTools(Type: typeof TypeBuilder, bridge: BridgeHandler): IcapTool[] {
	const call = async (op: string, payload: Json): Promise<Json> => {
		try {
			// A plain copy: the answer can come from Svelte state (a Proxy), and Pi structured-clones
			// every message, tool results included, before each request.
			return JSON.parse(JSON.stringify(await bridge(op, payload))) as Json;
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
		path: Type.String({ description: "Vault-relative path (e.g. Sources/book.pdf), a file name, or an absolute path." }),
		node: Type.Optional(Type.String({ description: 'A node id from the structure, e.g. "0007": returns that part\'s text.' })),
		pages: Type.Optional(
			Type.String({ description: 'Units to read — pages of a PDF, sections of an EPUB/DOCX: "12", "3-7", "40-" or "1,4,9-11".' }),
		),
	});

	const DocumentsParams = Type.Object({
		command: Type.Union([Type.Literal("list"), Type.Literal("search")], {
			description: "list = every document with its title, structure source, top-level chapters (and summary); search = full-text search across the documents already read.",
		}),
		query: Type.Optional(Type.String({ description: 'For search: words that must all appear in the same page/section; "quoted phrase" stays whole.' })),
		folder: Type.Optional(Type.String({ description: "Only documents inside this vault folder." })),
		limit: Type.Optional(Type.Number({ description: "Maximum rows or hits." })),
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

	return [
		{
			name: "ask_learner",
			label: "Ask learner",
			description:
				"Ask the learner one question inside their Markdown note and wait for the answer. " +
				"Use it to check understanding, request a clarification, offer a choice, or ask permission. " +
				"Attach `feedback` + `verdict` when responding to their previous answer. Returns their answer as JSON.",
			promptSnippet: "ask_learner: ask one question in the learner's note and wait for their answer",
			parameters: AskParams,
			sequential: true,
			async execute(params) {
				const options = params.options as unknown[] | undefined;
				if ((params.kind === "single" || params.kind === "multi") && !((options?.length ?? 0) >= 2)) {
					throw new Error("single/multi questions need at least two options");
				}
				const result = await call("ask", params);
				return { text: text(result), details: result };
			},
		},
		{
			name: "create_note",
			label: "Create note",
			description:
				"Create a NEW Markdown note in the learner's vault. Returns the created path. Never use this to modify existing notes — use propose_edit.",
			promptSnippet: "create_note: create a new Markdown note in the vault",
			parameters: CreateNoteParams,
			sequential: true,
			async execute(params) {
				const result = await call("create_note", params);
				if (result.status === "error") throw new Error(String(result.message ?? "create_note failed"));
				return { text: text(result), details: result };
			},
		},
		{
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
			sequential: false,
			async execute(params) {
				const result = await call("vault", params);
				if (result.status === "error") throw new Error(String(result.message ?? "obsidian failed"));
				return { text: text(result), details: undefined };
			},
		},
		{
			name: "read_document",
			label: "Read document",
			description:
				"Read a PDF, EPUB or Word document. With only `path`: its structure — a tree of numbered nodes (chapters, sections) with their page/section ranges, and one-line summaries when the learner turned them on. " +
				"Then read only what you need: `node` (one part, e.g. \"0007\") or `pages` (at most 30 units per call; follow `next` to continue). " +
				"The first read of a document prepares it (its structure and text are cached), later reads are instant. " +
				"`path` is vault-relative (e.g. Sources/book.pdf) or absolute. Other files are returned as plain text. Cite PDF pages as [[book.pdf#page=12]].",
			promptSnippet: "read_document: a document's structure (PDF, EPUB, DOCX), then the parts you need",
			parameters: DocumentParams,
			sequential: false,
			async execute(params) {
				const result = await call("read_document", params);
				if (result.status === "error") throw new Error(String(result.message ?? "read_document failed"));
				return { text: text(result), details: undefined };
			},
		},
		{
			name: "documents",
			label: "Documents",
			description:
				"The learner's library of PDFs, EPUBs and Word documents (in the vault and the folders they allowed). " +
				"list → each document's title, where its structure comes from, its top-level chapters and, when on, a summary — use it to choose what to read among many. " +
				"search {query} → the pages/sections (with node ids) where all the words appear, across every document already read. Then read with read_document.",
			promptSnippet: "documents: list the learner's PDFs/EPUBs/DOCX, or search their text",
			parameters: DocumentsParams,
			sequential: false,
			async execute(params) {
				const result = await call("documents", params);
				if (result.status === "error") throw new Error(String(result.message ?? "documents failed"));
				return { text: text(result), details: undefined };
			},
		},
		{
			name: "propose_edit",
			label: "Propose edit",
			description:
				"Propose a change to an EXISTING note. The learner reviews a diff inside their document and accepts or declines. " +
				"Returns {status:'accepted'|'declined'}.",
			promptSnippet: "propose_edit: propose a reviewable edit to an existing note",
			parameters: ProposeEditParams,
			sequential: true,
			async execute(params) {
				const result = await call("propose_edit", params);
				if (result.status === "error") throw new Error(String(result.message ?? "propose_edit failed"));
				return { text: text(result), details: result };
			},
		},
	];
}
