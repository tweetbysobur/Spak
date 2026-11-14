import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../database/repositories";

export interface RateResult { allowed: boolean; count: number; limit: number; resetAt: Date }

/**
 * S-10: shared fixed-window rate limiting in PostgreSQL. One atomic INSERT ... ON CONFLICT DO UPDATE per request, so
 * concurrent requests on any number of instances count exactly once each, and counters survive restarts. Keys are
 * hashed: no user id or address is stored in clear. Errors propagate: the caller decides to fail closed.
 */
export class RateLimiter {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async hit(bucket: string, subject: string, limit: number, windowMs: number): Promise<RateResult> {
    const now = this.clock();
    const key = `${bucket}:${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;
    const cutoff = new Date(now.getTime() - windowMs);
    const res = await this.db.execute(sql`
      insert into spak_rate_limits (key, window_start, count, updated_at) values (${key}, ${now}, 1, ${now})
      on conflict (key) do update set
        count = case when spak_rate_limits.window_start <= ${cutoff} then 1 else spak_rate_limits.count + 1 end,
        window_start = case when spak_rate_limits.window_start <= ${cutoff} then ${now} else spak_rate_limits.window_start end,
        updated_at = ${now}
      returning count, window_start`);
    const row = ((res as unknown as { rows?: { count: number; window_start: string | Date }[] }).rows ?? (res as unknown as { count: number; window_start: string | Date }[]))[0];
    const start = new Date(row.window_start);
    return { allowed: Number(row.count) <= limit, count: Number(row.count), limit, resetAt: new Date(start.getTime() + windowMs) };
  }

  /** Housekeeping: drop counters idle for a day. */
  async prune(olderThanMs = 24 * 3600_000) {
    await this.db.execute(sql`delete from spak_rate_limits where updated_at < ${new Date(this.clock().getTime() - olderThanMs)}`);
  }
}

/**
 * The client address SPak may trust, by deployment (SPAK_TRUSTED_PROXY):
 * - "vercel": Vercel sets x-real-ip from the connection; a client-supplied value is overwritten by the platform.
 * - "x-forwarded-for": the leftmost address, only behind a proxy that overwrites the header (also used by tests).
 * - unset or anything else: no header is trusted; every unauthenticated request shares one strict bucket.
 */
export function trustedClientIp(req: Request, mode = process.env.SPAK_TRUSTED_PROXY): string | null {
  if (mode === "vercel") return req.headers.get("x-real-ip")?.trim() || null;
  if (mode === "x-forwarded-for") return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  return null;
}
