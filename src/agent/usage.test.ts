import { describe, expect, it } from "vite-plus/test";
import { addUsage, cacheHit, formatCost, formatTokens, messageUsage, roundCost, totalTokens } from "./usage";

describe("usage", () => {
	it("reads a message's usage; none when the message reports nothing", () => {
		expect(messageUsage(undefined)).toBeNull();
		expect(messageUsage({ input: 0, output: 0, cost: { total: 0 } })).toBeNull();
		expect(messageUsage({ input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: { total: 0.0012 } })).toEqual({ input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: 0.0012, costKnown: true, billed: false });
	});

	it("marks the cost unknown when tokens have no price, and keeps it unknown once added", () => {
		const priced = messageUsage({ input: 100, output: 20, cost: { total: 0.01 } })!;
		const unpriced = messageUsage({ input: 100, output: 20, cost: { total: 0 } })!;
		expect(unpriced.costKnown).toBe(false);
		const sum = addUsage(priced, unpriced)!;
		expect(sum.costKnown).toBe(false);
		expect(totalTokens(sum)).toBe(240);
		expect(formatCost(sum)).toBeNull();
	});

	it("a provider that bills zero is known, not unknown", () => {
		expect(messageUsage({ input: 10, output: 1, cost: { total: 0, totalFromProvider: true } })!.costKnown).toBe(true);
	});

	it("adds runs up and says whether the total is billed or estimated", () => {
		const a = messageUsage({ input: 1000, output: 100, cacheRead: 3000, cost: { total: 0.02, totalFromProvider: true } })!;
		const b = messageUsage({ input: 500, output: 50, cacheRead: 3500, cost: { total: 0.01 } })!;
		expect(formatCost(a)).toBe("$0.02");
		const sum = addUsage(a, b)!;
		expect(sum.billed).toBe(false);
		expect(formatCost(sum)).toBe("≈$0.03");
		expect(cacheHit(sum)).toBe(81);
		expect(addUsage(null, a)).toEqual(a);
		expect(addUsage(a, null)).toEqual(a);
	});

	it("formats", () => {
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(12_400)).toBe("12k");
		expect(formatTokens(2400)).toBe("2.4k");
		expect(formatTokens(1_250_000)).toBe("1.3M");
		expect(roundCost(0.00123456)).toBe(0.0012);
		expect(roundCost(1.23456)).toBe(1.23);
		expect(cacheHit({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0, costKnown: true, billed: false })).toBeNull();
	});
});
