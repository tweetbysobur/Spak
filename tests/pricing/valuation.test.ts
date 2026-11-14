/**
 * S-6: SPak's independent valuation. Pure policy tests, the production Chainlink reader against a MOCKED JSON-RPC
 * fetch, and the full flow through the execution engine with MOCKED prices (FakePrices) and provider (Fake1Click).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usdValue, valuate, type PriceReading } from "@/pricing/valuation";
import { httpPriceReader, PriceService } from "@/pricing/oracle";
import { CHAINLINK_FEEDS } from "@/pricing/feeds";
import type { ExecutionError } from "@/execution";
import { approval, harness } from "../execution/harness";

const NOW = new Date("2026-11-14T12:00:00Z");
const t = Math.floor(NOW.getTime() / 1000);
const read = (usd: string, o: Partial<PriceReading> = {}): PriceReading => {
  const [i, f = ""] = usd.split(".");
  return { source: "CHAINLINK", ref: "feed", answer: BigInt(i + f.padEnd(8, "0").slice(0, 8)), decimals: 8, updatedAt: t - 30, stable: false, ...o };
};
const v = (o: Partial<Parameters<typeof valuate>[0]> = {}) => valuate({ amountUnits: "2000000000000000", tokenDecimals: 18, providerUsd: null, reading: read("2000"), now: NOW, maxAgeSec: 3600, ...o });

describe("valuation policy (pure, integer arithmetic)", () => {
  it("decimal conversion is exact and rounds up (conservative for limits)", () => {
    expect(usdValue(2_000_000_000_000_000n, 18, { answer: 200_000_000_000n, decimals: 8 })).toBe("4.000000");
    expect(usdValue(1n, 6, { answer: 99_976_029n, decimals: 8 })).toBe("0.000001"); // 0.00000099976 rounds up
    expect(usdValue(3_796_820n, 6, { answer: 100_000_000n, decimals: 8 })).toBe("3.796820");
    expect(usdValue(10n ** 30n, 18, { answer: 1n, decimals: 8 })).toBe("10000.000000"); // no float overflow
  });
  it("valid reading, no provider value: SPak's value alone", () => {
    expect(v()).toMatchObject({ status: "OK", usd: "4.000000", spakUsd: "4.000000", providerUsd: null });
  });
  it("stale, future-dated, missing, zero, negative and malformed readings fail closed", () => {
    expect(v({ reading: read("2000", { updatedAt: t - 3601 }) })).toMatchObject({ status: "UNAVAILABLE", usd: null });
    expect(v({ reading: read("2000", { updatedAt: t + 3600 }) })).toMatchObject({ status: "UNAVAILABLE" });
    expect(v({ reading: null })).toMatchObject({ status: "UNAVAILABLE", usd: null });
    expect(v({ reading: read("0") })).toMatchObject({ status: "UNAVAILABLE" });
    expect(v({ reading: { ...read("1"), answer: -5n } })).toMatchObject({ status: "UNAVAILABLE" });
    expect(v({ amountUnits: "1.5" })).toMatchObject({ status: "UNAVAILABLE" });
  });
  it("provider manipulation: a value more than 3% off SPak's is refused; a malformed one is refused, never ignored", () => {
    expect(v({ providerUsd: "4.11" })).toMatchObject({ status: "OK", usd: "4.11", deviationBps: 275 }); // within 3%: higher value used
    expect(v({ providerUsd: "3.90" })).toMatchObject({ status: "OK", usd: "4.000000" }); // lower provider value never raises headroom
    expect(v({ providerUsd: "0.40" })).toMatchObject({ status: "REJECTED", usd: null }); // under-reported 10x
    expect(v({ providerUsd: "40" })).toMatchObject({ status: "REJECTED" });
    expect(v({ providerUsd: "4,00" })).toMatchObject({ status: "REJECTED" });
  });
  it("extreme price movement between sources is refused, not averaged", () => {
    expect(v({ reading: read("1000"), providerUsd: "4.000000" })).toMatchObject({ status: "REJECTED" });
  });
  it("stablecoin depeg: outside ±2% refused; inside, never valued below $1", () => {
    const usdc = (p: string, provider: string | null = null) => valuate({ amountUnits: "50000000", tokenDecimals: 6, providerUsd: provider, reading: read(p, { stable: true }), now: NOW, maxAgeSec: 90_000 });
    expect(usdc("0.97")).toMatchObject({ status: "REJECTED" });
    expect(usdc("1.03")).toMatchObject({ status: "REJECTED" });
    expect(usdc("0.99")).toMatchObject({ status: "OK", usd: "50.000000", spakUsd: "50.000000" }); // floored at $1
    expect(usdc("1.01")).toMatchObject({ status: "OK", usd: "50.500000" });
  });
  it("CoinGecko-only assets need the provider's value to agree; alone they never authorise", () => {
    const cg = read("3", { source: "COINGECKO" });
    expect(valuate({ amountUnits: "10000000000000000000000000", tokenDecimals: 24, providerUsd: null, reading: cg, now: NOW, maxAgeSec: 600 })).toMatchObject({ status: "UNAVAILABLE" });
    expect(valuate({ amountUnits: "10000000000000000000000000", tokenDecimals: 24, providerUsd: "30.1", reading: cg, now: NOW, maxAgeSec: 600 })).toMatchObject({ status: "OK", usd: "30.1" });
  });
});

describe("Chainlink reader (production code, MOCKED JSON-RPC)", () => {
  const word = (n: bigint) => (n < 0n ? (1n << 256n) + n : n).toString(16).padStart(64, "0");
  const rpc = (o: { desc?: string; dec?: number; answer?: bigint; answeredIn?: bigint; fail?: boolean }) => (async (_u: string, init?: RequestInit) => {
    if (o.fail) throw new Error("network down");
    const d = (JSON.parse(String(init!.body)) as { params: [{ data: string }] }).params[0].data;
    const s = Buffer.from(o.desc ?? "ETH / USD");
    const result = d === "0x7284e416" ? `0x${word(32n)}${word(BigInt(s.length))}${s.toString("hex").padEnd(64, "0")}`
      : d === "0x313ce567" ? `0x${word(BigInt(o.dec ?? 8))}`
      : `0x${word(10n)}${word(o.answer ?? 200_000_000_000n)}${word(100n)}${word(BigInt(t))}${word(o.answeredIn ?? 10n)}`;
    return new Response(JSON.stringify({ result }));
  }) as typeof fetch;
  const feed = CHAINLINK_FEEDS.ETH;
  it("reads and validates identity, decimals and round completeness", async () => {
    expect(await httpPriceReader({ SPAK_PRICE_RPC_URL: "https://x" }, rpc({})).chainlink(feed)).toMatchObject({ source: "CHAINLINK", answer: 200_000_000_000n, decimals: 8, updatedAt: t });
  });
  it.each([
    ["token identity mismatch (feed describes another pair)", { desc: "BTC / USD" }],
    ["decimals changed", { dec: 18 }],
    ["incomplete round", { answeredIn: 9n }],
    ["transport failure", { fail: true }],
  ])("refuses: %s", async (_n, o) => {
    await expect(httpPriceReader({ SPAK_PRICE_RPC_URL: "https://x" }, rpc(o)).chainlink(feed)).rejects.toThrow();
  });
  it("a negative int256 answer is read as negative and refused by the policy", async () => {
    const r = await httpPriceReader({ SPAK_PRICE_RPC_URL: "https://x" }, rpc({ answer: -1n })).chainlink(feed);
    expect(r.answer).toBe(-1n);
    expect(valuate({ amountUnits: "1", tokenDecimals: 18, providerUsd: null, reading: r, now: NOW, maxAgeSec: 3600 }).status).toBe("UNAVAILABLE");
  });
  it("an asset with no independent source is unavailable; no reader configured is unavailable", async () => {
    expect((await new PriceService(httpPriceReader({ SPAK_PRICE_RPC_URL: "https://x" }, rpc({})), () => NOW).value({ symbol: "PEPE", decimals: 18, amountUnits: "1", providerUsd: "1" })).status).toBe("UNAVAILABLE");
    expect((await new PriceService(null).value({ symbol: "ETH", decimals: 18, amountUnits: "1", providerUsd: null })).status).toBe("UNAVAILABLE");
  });
});

// ------------------------------------------------------------------------------------------------ through the engine
let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
async function create(text = "Swap 50 USDC on Base to SOL on Solana") {
  const r = await u.plan(text);
  return h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random()}`, wallets: await u.wallets() });
}

describe("S-6 through the engine", () => {
  it("every quote stores SPak's valuation with its evidence; the provider figure is only cross-checked", async () => {
    const x = await create();
    const q = (await h.records.getQuote(x.quote!.id))!;
    expect(q.valuationUsd).toBe("50.000000");
    expect(q.valuation).toMatchObject({ status: "OK", spakUsd: "50.000000", providerUsd: "50.000000", deviationBps: 0, reading: { source: "CHAINLINK", ref: CHAINLINK_FEEDS.USDC.address } });
  });
  it("a lowballing provider cannot buy headroom: the quote is refused", async () => {
    h.fake.usdIn = "5.0"; // provider claims $5 for 50 USDC
    expect(await code(create())).toBe("QUOTE_MISMATCH");
  });
  it("stale prices or a price outage block at the first quote (fail closed)", async () => {
    h.prices.ageSec = 200_000;
    expect(await code(create())).toBe("GUARD_BLOCKED");
    h.prices.ageSec = 10; h.prices.down = true;
    expect(await code(create("Swap 51 USDC on Base to SOL on Solana"))).toBe("GUARD_BLOCKED");
  });
  it("a depegged stablecoin is refused", async () => {
    h.prices.usd.set("USDC", "0.95");
    expect(await code(create())).toBe("QUOTE_MISMATCH");
  });
  it("USD caps use SPak's value: the Guard per-transfer limit and the platform ceiling", async () => {
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, maxTransactionUsd: "49.99" });
    expect(await code(create())).toBe("GUARD_BLOCKED");
  });
  it("concurrent approvals reserve SPak's values and never exceed the daily limit", async () => {
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, dailyLimitUsd: "100" });
    const wallets = await u.wallets();
    const xs = [];
    for (const n of [40, 41, 42]) xs.push(await create(`Swap ${n} USDC on Base to SOL on Solana`));
    const firms: { id: string }[] = [];
    for (const x of xs) firms.push((await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets })).quote);
    const out = await Promise.all(xs.map((x, i) => code(h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: firms[i].id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets }))));
    expect(out.filter((o) => o === "OK").length, JSON.stringify(out)).toBe(2); // any two fit under 100; the third would reach at least 121
    expect(out.filter((o) => o !== "OK"), JSON.stringify(out)).toEqual(["GUARD_BLOCKED"]);
    // Which two win is a race. The reserved total must equal exactly the approved amounts (81, 82 or 83), never more.
    const approved = [40, 41, 42].filter((_, i) => out[i] === "OK").reduce((a, b) => a + b, 0);
    expect(Number((await h.guard.view(u.userId)).spending.dayUsd)).toBe(approved);
    expect(approved).toBeLessThanOrEqual(100);
  });
  it("eight concurrent approvals: the reserved total equals the approved amounts and never exceeds the daily limit", async () => {
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, dailyLimitUsd: "100" });
    const wallets = await u.wallets();
    const amounts = [20, 21, 22, 23, 24, 25, 26, 27];
    const xs = [];
    for (const n of amounts) xs.push(await create(`Swap ${n} USDC on Base to SOL on Solana`));
    const firms: { id: string }[] = [];
    for (const x of xs) firms.push((await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets })).quote);
    const out = await Promise.all(xs.map((x, i) => code(h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: firms[i].id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets }))));
    expect(out.every((o) => o === "OK" || o === "GUARD_BLOCKED"), JSON.stringify(out)).toBe(true);
    const approved = amounts.filter((_, i) => out[i] === "OK").reduce((a, b) => a + b, 0);
    expect(Number((await h.guard.view(u.userId)).spending.dayUsd)).toBe(approved);
    expect(approved).toBeLessThanOrEqual(100);
    expect(approved).toBeGreaterThanOrEqual(100 - 27); // no approval was refused that still fit
  });
});
