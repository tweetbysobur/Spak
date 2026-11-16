/**
 * Alerting and structured logging on real SQL (PGlite or PostgreSQL 16). Conditions are produced through the real
 * services where practical, otherwise by setting rows directly. Delivery goes over real HTTP to a LOCAL receiver
 * (local integration test): it proves signing and bookkeeping, not that an external pager is configured.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { AlertService } from "@/ops/alerts";
import { logEvent, redact, setLogSink } from "@/ops/log";
import { alerts, executions, quotes } from "@/database/schema";
import { approval, harness } from "../execution/harness";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });

async function approved(text = "Swap 50 USDC on Base to SOL on Solana") {
  const r = await u.plan(text); const w = await u.wallets();
  const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random()}`, wallets: w });
  const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: w });
  return (await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets: w })).execution;
}
const open = async () => (await h.db.select().from(alerts)).filter((a) => !a.resolvedAt).map((a) => a.kind).sort();

describe("alert scan", () => {
  it("raises stalled, unverified-delivery, gave-up, security and monitor-silent alerts from state; dedupes; resolves when cleared", async () => {
    const ops = new AlertService(h.db, { clock: h.now });
    const ex = await approved();
    await h.db.update(executions).set({ state: "PROCESSING", updatedAt: new Date(h.now().getTime() - 2 * 3600_000) }).where(eq(executions.id, ex.id));
    const ex2 = await approved("Swap 51 USDC on Base to SOL on Solana");
    await h.db.update(executions).set({ state: "UNKNOWN", error: { code: "NEEDS_RECONCILIATION", reason: "below minimum" }, monitorGaveUpAt: h.now() }).where(eq(executions.id, ex2.id));
    await h.db.update(quotes).set({ status: "REJECTED", rejectionReason: "SPak could not verify the signature from NEAR Intents on this quote against its published key, so it will not use it. Nothing was sent" }).where(eq(quotes.executionId, ex.id));
    await ops.scan();
    expect(await open()).toEqual(["MONITOR_GAVE_UP", "MONITOR_SILENT", "SECURITY_QUOTE_REJECTED", "SECURITY_QUOTE_REJECTED", "STALLED_EXECUTION", "UNVERIFIED_DELIVERY"]);
    await ops.scan(); // same conditions: counts go up, no duplicate open alerts
    const stalled = (await h.db.select().from(alerts)).find((a) => a.kind === "STALLED_EXECUTION")!;
    expect(stalled.count).toBe(2);
    await h.db.update(executions).set({ state: "VERIFYING_DESTINATION", updatedAt: h.now() }).where(eq(executions.id, ex.id));
    await ops.scan();
    expect(await open()).not.toContain("STALLED_EXECUTION");
    expect((await h.db.select().from(alerts)).find((a) => a.kind === "STALLED_EXECUTION")!.resolvedAt).not.toBeNull(); // kept, resolved
  });
  it("provider outage and repeated RPC failures", async () => {
    const ops = new AlertService(h.db, { clock: h.now });
    for (const t of ["Swap 52 USDC on Base to SOL on Solana", "Swap 53 USDC on Base to SOL on Solana", "Swap 54 USDC on Base to SOL on Solana"]) {
      h.clock.now += 3 * 60_000;
      const ex = await approved(t);
      await h.db.update(executions).set({ lastCheckedAt: h.now(), lastStatusError: "UNAVAILABLE: NEAR Intents did not respond.", updatedAt: h.now() }).where(eq(executions.id, ex.id));
    }
    await ops.scan();
    expect(await open()).toContain("PROVIDER_OUTAGE");
    await h.db.update(executions).set({ lastStatusError: "Could not reach base: timeout" });
    await ops.scan();
    expect(await open()).toContain("RPC_FAILURES");
  });
  it("an unexpected state transition is refused and raises a critical alert", async () => {
    const ex = await approved();
    await expect(h.records.transition(ex.id, "AWAITING_DEPOSIT", "COMPLETED", "forced")).rejects.toThrow();
    expect((await h.db.select().from(alerts))[0]).toMatchObject({ kind: "UNEXPECTED_TRANSITION", severity: "CRITICAL", ref: ex.id });
    expect((await h.records.get(ex.id))!.state).toBe("AWAITING_DEPOSIT");
  });
});

describe("alert delivery (local HTTP receiver)", () => {
  let server: Server; let got: { body: string; sig: string }[] = []; let status = 200; let url = "";
  beforeEach(async () => {
    got = []; status = 200;
    server = createServer((rq, rs) => { let b = ""; rq.on("data", (c) => (b += c)); rq.on("end", () => { got.push({ body: b, sig: String(rq.headers["x-spak-signature"]) }); rs.statusCode = status; rs.end(); }); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  });
  afterEach(() => server.close());
  const SECRET = "test-alert-secret-0123456789";
  it("delivers signed alerts once, records failures, and refuses a non-https destination", async () => {
    await new AlertService(h.db).raise({ kind: "UNVERIFIED_DELIVERY", severity: "CRITICAL", dedupeKey: "k1", message: "needs review", data: { token: "dp.st.abcdefghijk", note: "Bearer abcdefghijklmnop" } });
    // Plain http is refused even for a local receiver: production delivery must be https.
    expect(await new AlertService(h.db, { env: { SPAK_ALERT_WEBHOOK_URL: url, SPAK_ALERT_WEBHOOK_SECRET: SECRET } }).deliver()).toMatchObject({ configured: false, delivered: 0, pending: 1 });
    const ok = new AlertService(h.db, { env: { SPAK_ALERT_WEBHOOK_URL: "https://alerts.example/hook", SPAK_ALERT_WEBHOOK_SECRET: SECRET }, fetchImpl: ((_u: string, init: RequestInit) => fetch(url, init)) as typeof fetch });
    status = 500;
    expect(await ok.deliver()).toMatchObject({ delivered: 0, pending: 1 });
    expect((await h.db.select().from(alerts))[0]).toMatchObject({ deliveredAt: null, deliveryError: "HTTP 500", deliveryAttempts: 1 });
    status = 200;
    expect(await ok.deliver()).toMatchObject({ delivered: 1, pending: 0 });
    expect(await ok.deliver()).toMatchObject({ delivered: 0, pending: 0 }); // never twice
    const last = got[got.length - 1];
    expect(last.sig).toBe(`sha256=${createHmac("sha256", SECRET).update(last.body).digest("hex")}`);
    expect(last.body).not.toMatch(/dp\.st\.abc|abcdefghijklmnop/);
  });
});

describe("structured logging never leaks secrets", () => {
  it("redacts sensitive keys and token-shaped values", () => {
    const lines: string[] = [];
    const prev = setLogSink((l) => lines.push(l));
    logEvent("info", "x", { privateKey: "0xabc", authorization: "Bearer zzzzzzzzzzzz", nested: { serviceToken: "dp.st.dev.AAAAAAAAAAAA", note: "token dp.st.dev.BBBBBBBBBBBB here" }, txHash: `0x${"a".repeat(64)}` });
    setLogSink(prev);
    expect(lines[0]).not.toMatch(/0xabc|zzzzzzzz|AAAAAAAA|BBBBBBBB/);
    expect(lines[0]).toContain(`0x${"a".repeat(64)}`); // transaction hashes stay: they are public evidence
    expect(redact({ seed: "word word" })).toEqual({ seed: "[redacted]" });
  });
});

describe("monitoring boundaries (static)", () => {
  it("the monitor and the scheduled route never approve, prepare or sign a deposit", () => {
    for (const f of ["src/tracking/monitor.ts", "src/app/api/internal/monitor/route.ts", "src/ops/alerts.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\.approve\(|approveByAgent|deposits\.prepare|\.submit\(|signTransaction|sendTransaction/);
    }
  });
  it("no application code reads the testnet wallet key or Doppler (S-2)", () => {
    const hits = execSync("grep -rlE 'api\.doppler\.com|SPAK_TESTNET_WALLET_PRIVATE_KEY' src || true").toString().trim();
    expect(hits).toBe("");
  });
});
void sql;
