/**
 * What a run cost: tokens, cache use and price, added up from the usage each assistant message reports
 * (pi-ai's `Usage`, the same on both backends). Pure.
 *
 * Summed per message, not read from a session's totals: a request block that resumes its cached session
 * would count the earlier rounds again.
 */

export interface RunUsage {
	/** Tokens sent that were not read from the cache. */
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** US dollars, the part that is known. */
	cost: number;
	/**
	 * False when some message used tokens the model's catalog has no price for (a custom endpoint):
	 * the total is then unknown, and is shown and recorded as unknown rather than as a too-small number.
	 */
	costKnown: boolean;
	/** Every priced message carried the cost the provider billed; otherwise it is an estimate from list prices. */
	billed: boolean;
}

/** The fields of pi-ai's `Usage` this reads. */
export interface MessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number; totalFromProvider?: boolean };
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** One assistant message's usage; null when it reports none (an aborted message, a provider without usage). */
export function messageUsage(u: MessageUsage | null | undefined): RunUsage | null {
	if (!u) return null;
	const input = n(u.input);
	const output = n(u.output);
	const cacheRead = n(u.cacheRead);
	const cacheWrite = n(u.cacheWrite);
	const tokens = input + output + cacheRead + cacheWrite;
	const cost = n(u.cost?.total);
	const billed = !!u.cost?.totalFromProvider;
	if (!tokens && !cost) return null;
	// Tokens with no price: the catalog does not know this model's rates. (A provider that bills zero says so.)
	return { input, output, cacheRead, cacheWrite, cost, costKnown: cost > 0 || billed, billed };
}

export function addUsage(a: RunUsage | null | undefined, b: RunUsage | null | undefined): RunUsage | null {
	if (!a) return b ? { ...b } : null;
	if (!b) return { ...a };
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		cost: a.cost + b.cost,
		costKnown: a.costKnown && b.costKnown,
		billed: a.billed && b.billed,
	};
}

export const totalTokens = (u: RunUsage) => u.input + u.output + u.cacheRead + u.cacheWrite;

/** Share of the prompt that was read from the cache, 0–100; null when nothing was sent. */
export function cacheHit(u: RunUsage): number | null {
	const prompt = u.input + u.cacheRead + u.cacheWrite;
	return prompt ? Math.round((u.cacheRead / prompt) * 100) : null;
}

/** Dollars for a property: enough digits for a cheap run to be more than 0. */
export const roundCost = (cost: number) => Number(cost.toFixed(cost < 0.1 ? 4 : 2));

export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** "$0.042", "≈$0.042" for an estimate; null when unknown. */
export function formatCost(u: RunUsage): string | null {
	if (!u.costKnown) return null;
	const c = u.cost;
	const text = c >= 1 ? c.toFixed(2) : c >= 0.01 ? c.toFixed(3).replace(/0$/, "") : c.toFixed(4);
	return `${u.billed ? "" : "≈"}$${text}`;
}
