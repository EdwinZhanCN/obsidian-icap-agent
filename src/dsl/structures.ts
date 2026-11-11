/**
 * Pure checks for the non-Markdown files the agent may create or edit: canvases (JSON Canvas 1.0) and
 * bases (Obsidian Bases YAML, already parsed). Each returns what is wrong, in words the agent can act
 * on, or null. They catch what makes Obsidian show an empty or broken file, not every style mistake.
 */

/** What create_note can make: a Markdown note, a canvas or a base. */
export type NoteType = "note" | "canvas" | "base";

export const NOTE_EXT: Record<NoteType, string> = { note: "md", canvas: "canvas", base: "base" };

export function noteTypeOf(path: string): NoteType {
	return path.endsWith(".canvas") ? "canvas" : path.endsWith(".base") ? "base" : "note";
}

const NODE_TYPES = new Set(["text", "file", "link", "group"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);
const COLOR = /^([1-6]|#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?)$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A canvas's JSON text → what is wrong with it, or null. */
export function canvasProblem(text: string): string | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (e) {
		return `The canvas is not valid JSON: ${(e as Error).message}`;
	}
	if (!isObj(data)) return 'A canvas is a JSON object: {"nodes": [...], "edges": [...]}.';
	const nodes = data.nodes ?? [];
	const edges = data.edges ?? [];
	if (!Array.isArray(nodes) || !Array.isArray(edges)) return "nodes and edges must be arrays.";
	const ids = new Set<string>();
	const nodeIds = new Set<string>();
	const problems: string[] = [];
	const claim = (id: unknown, what: string) => {
		if (typeof id !== "string" || !id) return problems.push(`${what} has no id.`), false;
		if (ids.has(id)) return problems.push(`The id ${id} is used twice.`), false;
		ids.add(id);
		return true;
	};
	for (const [i, n] of nodes.entries()) {
		if (!isObj(n)) {
			problems.push(`Node ${i} is not an object.`);
			continue;
		}
		const name = `Node ${typeof n.id === "string" ? n.id : i}`;
		if (claim(n.id, name)) nodeIds.add(n.id as string);
		if (typeof n.type !== "string" || !NODE_TYPES.has(n.type)) problems.push(`${name}: type must be text, file, link or group.`);
		for (const k of ["x", "y", "width", "height"]) if (typeof n[k] !== "number" || !Number.isFinite(n[k])) problems.push(`${name}: ${k} must be a number.`);
		const need = n.type === "text" ? "text" : n.type === "file" ? "file" : n.type === "link" ? "url" : null;
		if (need && typeof n[need] !== "string") problems.push(`${name}: a ${n.type} node needs "${need}".`);
		if (n.color !== undefined && !(typeof n.color === "string" && COLOR.test(n.color))) problems.push(`${name}: color is "1" to "6" or a hex colour.`);
	}
	for (const [i, e] of edges.entries()) {
		if (!isObj(e)) {
			problems.push(`Edge ${i} is not an object.`);
			continue;
		}
		const name = `Edge ${typeof e.id === "string" ? e.id : i}`;
		claim(e.id, name);
		for (const k of ["fromNode", "toNode"]) if (typeof e[k] !== "string" || !nodeIds.has(e[k])) problems.push(`${name}: ${k} must be the id of a node in this canvas.`);
		for (const k of ["fromSide", "toSide"]) if (e[k] !== undefined && !SIDES.has(e[k] as string)) problems.push(`${name}: ${k} is top, right, bottom or left.`);
		for (const k of ["fromEnd", "toEnd"]) if (e[k] !== undefined && !ENDS.has(e[k] as string)) problems.push(`${name}: ${k} is none or arrow.`);
	}
	if (!problems.length) return null;
	const more = problems.length > 8 ? ` (and ${problems.length - 8} more)` : "";
	return problems.slice(0, 8).join(" ") + more;
}

const VIEW_TYPES = new Set(["table", "cards", "list", "map"]);

/** A base's parsed YAML → what is wrong with it, or null. */
export function baseProblem(data: unknown): string | null {
	if (data === null || data === undefined) return "The base is empty: it needs at least views.";
	if (!isObj(data)) return "A base is a YAML mapping with filters, formulas, properties and views.";
	const problems: string[] = [];
	const formulas = data.formulas ?? {};
	if (!isObj(formulas)) problems.push("formulas must be a mapping of name: expression.");
	const defined = new Set(isObj(formulas) ? Object.keys(formulas) : []);
	for (const [k, v] of isObj(formulas) ? Object.entries(formulas) : []) if (typeof v !== "string") problems.push(`formula ${k} must be a quoted expression.`);
	const refs = new Set<string>();
	const collect = (v: unknown) => {
		if (typeof v === "string") for (const m of v.matchAll(/\bformula\.([A-Za-z_][\w]*)/g)) refs.add(m[1]);
		else if (Array.isArray(v)) v.forEach(collect);
		else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
			collect(k);
			collect(x);
		}
	};
	collect(data.properties);
	collect(data.filters);
	const views = data.views;
	if (views === undefined) problems.push("A base needs views: a list with at least one view.");
	else if (!Array.isArray(views) || !views.length) problems.push("views must be a list with at least one view.");
	else
		for (const [i, v] of views.entries()) {
			if (!isObj(v)) {
				problems.push(`View ${i + 1} is not a mapping.`);
				continue;
			}
			if (typeof v.type !== "string" || !VIEW_TYPES.has(v.type)) problems.push(`View ${i + 1}: type must be table, cards, list or map.`);
			collect(v.order);
			collect(v.filters);
			collect(v.groupBy);
			collect(v.summaries);
			collect(v.sort);
		}
	for (const r of refs) if (!defined.has(r)) problems.push(`formula.${r} is used but not defined under formulas.`);
	return problems.length ? problems.join(" ") : null;
}
