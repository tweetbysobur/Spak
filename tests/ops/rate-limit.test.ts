/** S-10: shared rate limiting on real SQL (PGlite by default; PostgreSQL 16 with SPAK_TEST_PG_URL, separate connections). */
import { describe, expect, it, vi } from "vitest";
import { RateLimiter, trustedClientIp } from "@/ops/rate-limit";
import { freshDb } from "../auth/db";

const req = (h: Record<string, string>) => new Request("http://localhost/x", { headers: h });

describe("RateLimiter", () => {
  it("concurrent requests count exactly once each: 50 parallel hits against a limit of 20 allow exactly 20", async () => {
    const db = await freshDb();
    const l = new RateLimiter(db);
    const out = await Promise.all(Array.from({ length: 50 }, () => l.hit("quote", "u:alice", 20, 60_000)));
    expect(out.filter((r) => r.allowed)).toHaveLength(20);
    expect(Math.max(...out.map((r) => r.count))).toBe(50);
  });
  it("several application instances share one counter, and it survives a restart", async () => {
    const db = await freshDb();
    const a = new RateLimiter(db), b = new RateLimiter(db);
    for (let i = 0; i < 3; i++) { await a.hit("exec", "u:bob", 5, 60_000); await b.hit("exec", "u:bob", 5, 60_000); }
    expect((await a.hit("exec", "u:bob", 5, 60_000)).allowed).toBe(false); // 7th across both instances
    const restarted = new RateLimiter(db); // new process, same store
    expect(await restarted.hit("exec", "u:bob", 5, 60_000)).toMatchObject({ allowed: false, count: 8 });
  });
  it("counters expire with their window; buckets and subjects are independent", async () => {
    const db = await freshDb();
    let now = Date.parse("2026-11-14T10:00:00Z");
    const l = new RateLimiter(db, () => new Date(now));
    for (let i = 0; i < 3; i++) await l.hit("auth", "ip:1.2.3.4", 3, 60_000);
    expect((await l.hit("auth", "ip:1.2.3.4", 3, 60_000)).allowed).toBe(false);
    expect((await l.hit("auth", "ip:5.6.7.8", 3, 60_000)).allowed).toBe(true);
    expect((await l.hit("refresh", "ip:1.2.3.4", 3, 60_000)).allowed).toBe(true);
    now += 60_001;
    expect(await l.hit("auth", "ip:1.2.3.4", 3, 60_000)).toMatchObject({ allowed: true, count: 1 });
  });
  it("stores no clear user id or address", async () => {
    const db = await freshDb();
    await new RateLimiter(db).hit("auth", "u:usr_secret_id", 3, 60_000);
    const rows = (await db.execute("select key from spak_rate_limits" as never)) as unknown as { rows: { key: string }[] };
    expect(JSON.stringify(rows.rows ?? rows)).not.toContain("usr_secret_id");
  });
  it("a storage failure throws (callers fail closed)", async () => {
    const broken = { execute: async () => { throw new Error("connection refused"); } };
    await expect(new RateLimiter(broken as never).hit("auth", "x", 3, 60_000)).rejects.toThrow(/connection refused/);
  });
});

describe("trusted client address", () => {
  it("never trusts a forwarded header unless the deployment says its proxy overwrites it", () => {
    const spoof = req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "9.9.9.9" });
    expect(trustedClientIp(spoof, "")).toBeNull();
    expect(trustedClientIp(spoof, "vercel")).toBe("9.9.9.9");
    expect(trustedClientIp(spoof, "x-forwarded-for")).toBe("6.6.6.6");
  });
});

describe("rateLimit() in the request path", () => {
  it("unauthenticated callers get half the limit; a spoofed header does not open new buckets without a trusted proxy; storage failure is 503", async () => {
    vi.resetModules();
    const prev = process.env.SPAK_TRUSTED_PROXY;
    process.env.SPAK_TRUSTED_PROXY = "";
    const { rateLimit } = await import("@/server/auth");
    const code = (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as { code?: string }).code);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await code(rateLimit(req({ "x-forwarded-for": `10.0.0.${i}` }), "t-unauth", 4, 60_000)));
    expect(results).toEqual(["OK", "OK", "RATE_LIMITED", "RATE_LIMITED"]); // 4 / 2 = 2, every spoofed address shares one bucket
    expect(await code(rateLimit(req({}), "t-auth", 4, 60_000, "usr_a"))).toBe("OK");
    process.env.SPAK_TRUSTED_PROXY = prev;
    vi.doMock("@/database", () => ({ getDb: async () => ({ execute: async () => { throw new Error("db down"); } }) }));
    vi.resetModules();
    const again = await import("@/server/auth");
    expect(await code(again.rateLimit(req({}), "t-down", 4, 60_000, "usr_b"))).toBe("RATE_LIMIT_UNAVAILABLE");
    vi.doUnmock("@/database");
  });
});
