/**
 * MOCKED price endpoints for the whole unit suite (not LIVE runs). Route tests run the real server wiring, which reads
 * Chainlink over JSON-RPC and CoinGecko over HTTP; this answers those hosts with fixed, fresh prices so no unit test
 * depends on the network. Real reads are covered by tests/live/prices.live.test.ts (LIVE=1).
 */
import { CHAINLINK_FEEDS } from "@/pricing/feeds";

const USD: Record<string, string> = { ETH: "2000", BTC: "60000", USDC: "1", USDT: "1", DAI: "1", SOL: "150", BNB: "600", AVAX: "30", LINK: "15" };
const CG: Record<string, number> = { near: 3 };
const word = (n: bigint) => (n < 0n ? (1n << 256n) + n : n).toString(16).padStart(64, "0");
const real = globalThis.fetch;
const PRICE_HOSTS = /^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.llamarpc\.com|api\.coingecko\.com)\b/;

if (!process.env.LIVE) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!PRICE_HOSTS.test(u)) return real(url as string, init);
    const now = Math.floor(Date.now() / 1000) - 5;
    if (u.includes("coingecko")) {
      const id = new URL(u).searchParams.get("ids") ?? "";
      return new Response(JSON.stringify(CG[id] ? { [id]: { usd: CG[id], last_updated_at: now } } : {}), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { params: [{ to: string; data: string }] };
    const feed = Object.values(CHAINLINK_FEEDS).find((f) => f.address.toLowerCase() === body.params[0].to.toLowerCase());
    if (!feed) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }));
    const [i, f = ""] = USD[feed.key].split(".");
    const answer = BigInt(i + f.padEnd(8, "0"));
    const d = body.params[0].data;
    let result = "0x";
    if (d === "0x313ce567") result = `0x${word(8n)}`;
    else if (d === "0xfeaf968c") result = `0x${word(5n)}${word(answer)}${word(BigInt(now))}${word(BigInt(now))}${word(5n)}`;
    else if (d === "0x7284e416") { const s = Buffer.from(feed.description); result = `0x${word(32n)}${word(BigInt(s.length))}${s.toString("hex").padEnd(64, "0")}`; }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
}

// Structured operational logs are asserted in tests/ops; elsewhere they would only flood test output.
import { setLogSink } from "@/ops/log";
if (!process.env.SPAK_TEST_LOGS) setLogSink(() => undefined);
