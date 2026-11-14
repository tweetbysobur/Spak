import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { alerts } from "../database/schema";
import { NETWORK_ENV } from "../environment";
import { logEvent, redact } from "./log";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM";
export interface AlertInput { kind: string; severity: Severity; dedupeKey: string; message: string; ref?: string | null; data?: Record<string, unknown> }

/** Thresholds for the scan. Minutes unless stated. */
export const ALERT_RULES = {
  stalledProcessingMin: 60,
  depositPastDeadlineMin: 15,
  providerErrorsMin: 15, providerErrorsCount: 3,
  rpcErrorsMin: 15, rpcErrorsCount: 3,
  securityLookbackMin: 60,
  monitorSilentMin: 30,
} as const;

/** Kinds the scan owns: an open alert of these kinds is resolved when the scan no longer finds its condition. */
const SCAN_KINDS = ["STALLED_EXECUTION", "UNVERIFIED_DELIVERY", "MONITOR_GAVE_UP", "PROVIDER_OUTAGE", "RPC_FAILURES", "REFUND_MANUAL_REVIEW", "SECURITY_QUOTE_REJECTED", "MONITOR_RUN_FAILED", "MONITOR_SILENT"];

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/**
 * Operational alerts. raise() is idempotent per dedupe key while the alert is open; scan() derives alerts from the
 * database state (the source of truth) and resolves those whose condition cleared; deliver() sends undelivered
 * alerts to SPAK_ALERT_WEBHOOK_URL, signed with SPAK_ALERT_WEBHOOK_SECRET. Without a destination, alerts stay
 * recorded and undelivered, and each scan logs that fact: nothing is reported as delivered that was not.
 */
export class AlertService {
  private readonly clock: () => Date;
  constructor(private readonly db: Db, private readonly o: { clock?: () => Date; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}) {
    this.clock = o.clock ?? (() => new Date());
  }

  async raise(a: AlertInput): Promise<void> {
    const now = this.clock();
    const data = redact(a.data ?? {}) as Record<string, unknown>;
    await this.db.execute(sql`
      insert into spak_alerts (id, kind, severity, dedupe_key, ref, message, data, count, first_at, last_at)
      values (${`alr_${randomBytes(12).toString("hex")}`}, ${a.kind}, ${a.severity}, ${a.dedupeKey}, ${a.ref ?? null}, ${a.message}, ${JSON.stringify(data)}::jsonb, 1, ${now}, ${now})
      on conflict (dedupe_key) where resolved_at is null do update set count = spak_alerts.count + 1, last_at = ${now}, message = excluded.message, data = excluded.data`);
    logEvent(a.severity === "MEDIUM" ? "warn" : "error", "alert.raised", { kind: a.kind, severity: a.severity, ref: a.ref ?? null });
  }

  /** Derive alerts from current state. Returns the dedupe keys found. */
  async scan(): Promise<string[]> {
    const now = this.clock();
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    const found: AlertInput[] = [];
    for (const r of rows<{ id: string; state: string }>(await this.db.execute(sql`
      select id, state from spak_executions where (state in ('PROCESSING','VERIFYING_DESTINATION') and updated_at < ${ago(ALERT_RULES.stalledProcessingMin)})
        or (state = 'AWAITING_DEPOSIT' and deposit_deadline < ${ago(ALERT_RULES.depositPastDeadlineMin)}) limit 50`))) {
      found.push({ kind: "STALLED_EXECUTION", severity: "HIGH", dedupeKey: `stalled:${r.id}`, ref: r.id, message: `Execution ${r.id} has been ${r.state} longer than expected.`, data: { state: r.state } });
    }
    for (const r of rows<{ id: string; reason: string | null }>(await this.db.execute(sql`
      select id, error->>'reason' as reason from spak_executions where state = 'UNKNOWN' and error->>'code' = 'NEEDS_RECONCILIATION' limit 50`))) {
      found.push({ kind: "UNVERIFIED_DELIVERY", severity: "CRITICAL", dedupeKey: `unverified:${r.id}`, ref: r.id, message: `Execution ${r.id} needs manual reconciliation: delivery could not be verified.`, data: { reason: r.reason } });
    }
    for (const r of rows<{ id: string; state: string }>(await this.db.execute(sql`
      select id, state from spak_executions where monitor_gave_up_at is not null and state not in ('COMPLETED','EXPIRED','REFUNDED','CANCELLED') limit 50`))) {
      found.push({ kind: "MONITOR_GAVE_UP", severity: "HIGH", dedupeKey: `gaveup:${r.id}`, ref: r.id, message: `Monitoring stopped for ${r.id} (${r.state}) after repeated failures.` });
    }
    const [prov] = rows<{ n: number }>(await this.db.execute(sql`
      select count(*)::int as n from spak_executions where last_checked_at > ${ago(ALERT_RULES.providerErrorsMin)} and last_status_error ~* '(UNAVAILABLE|TIMEOUT|RATE_LIMITED|did not respond)'`));
    if (prov && prov.n >= ALERT_RULES.providerErrorsCount) found.push({ kind: "PROVIDER_OUTAGE", severity: "HIGH", dedupeKey: "provider-outage", message: `${prov.n} executions could not read provider status in the last ${ALERT_RULES.providerErrorsMin} minutes.`, data: { executions: prov.n } });
    const [rpc] = rows<{ n: number }>(await this.db.execute(sql`
      select (select count(*) from spak_executions where updated_at > ${ago(ALERT_RULES.rpcErrorsMin)} and last_status_error ~* '(Could not reach|chain check failed|RPC)')
        + (select count(*) from spak_destination_verifications where last_checked_at > ${ago(ALERT_RULES.rpcErrorsMin)} and observed ? 'lastError') as n`));
    if (rpc && Number(rpc.n) >= ALERT_RULES.rpcErrorsCount) found.push({ kind: "RPC_FAILURES", severity: "HIGH", dedupeKey: "rpc-failures", message: `${rpc.n} chain reads failed in the last ${ALERT_RULES.rpcErrorsMin} minutes.`, data: { failures: Number(rpc.n) } });
    for (const r of rows<{ id: string; execution_id: string }>(await this.db.execute(sql`select id, execution_id from spak_reviews where status in ('OPEN','IN_REVIEW') limit 50`))) {
      found.push({ kind: "REFUND_MANUAL_REVIEW", severity: "HIGH", dedupeKey: `review:${r.id}`, ref: r.execution_id, message: `Execution ${r.execution_id} is waiting for manual review.` });
    }
    for (const r of rows<{ id: string; execution_id: string; reason: string }>(await this.db.execute(sql`
      select id, execution_id, rejection_reason as reason from spak_quotes where status = 'REJECTED' and created_at > ${ago(ALERT_RULES.securityLookbackMin)}
        and rejection_reason ~* '(signature|price check|quote-signing key)' limit 50`))) {
      found.push({ kind: "SECURITY_QUOTE_REJECTED", severity: "CRITICAL", dedupeKey: `security-quote:${r.id}`, ref: r.execution_id, message: `A provider quote failed a security check: ${r.reason.slice(0, 200)}`, data: { quoteId: r.id } });
    }
    const [run] = rows<{ failed: number; last: string | null; inflight: number }>(await this.db.execute(sql`
      select (select count(*)::int from spak_monitor_runs where error is not null and started_at > ${ago(60)}) as failed,
        (select max(started_at) from spak_monitor_runs) as last,
        (select count(*)::int from spak_executions where state in ('AWAITING_DEPOSIT','PROCESSING','VERIFYING_DESTINATION','FAILED','REFUNDING','UNKNOWN')) as inflight`));
    if (run?.failed) found.push({ kind: "MONITOR_RUN_FAILED", severity: "HIGH", dedupeKey: "monitor-run-failed", message: `${run.failed} monitor runs failed in the last hour.` });
    if (run && run.inflight > 0 && (!run.last || new Date(run.last).getTime() < ago(ALERT_RULES.monitorSilentMin).getTime())) {
      found.push({ kind: "MONITOR_SILENT", severity: "HIGH", dedupeKey: "monitor-silent", message: `${run.inflight} executions are in flight and the monitor has not run for ${ALERT_RULES.monitorSilentMin} minutes.` });
    }
    for (const a of found) await this.raise(a);
    // Resolve scan-owned alerts whose condition is gone. History is kept (resolved_at), never deleted.
    const keys = found.map((a) => a.dedupeKey);
    const open = await this.db.select({ id: alerts.id, key: alerts.dedupeKey, kind: alerts.kind }).from(alerts).where(isNull(alerts.resolvedAt));
    for (const a of open) if (SCAN_KINDS.includes(a.kind) && !keys.includes(a.key)) await this.db.update(alerts).set({ resolvedAt: now }).where(and(eq(alerts.id, a.id), isNull(alerts.resolvedAt)));
    return keys;
  }

  /** Send undelivered open alerts. Returns how many were delivered. Never claims delivery without a 2xx response. */
  async deliver(limit = 20): Promise<{ delivered: number; pending: number; configured: boolean }> {
    const env = this.o.env ?? process.env;
    const url = env.SPAK_ALERT_WEBHOOK_URL, secret = env.SPAK_ALERT_WEBHOOK_SECRET;
    const pending = await this.db.select().from(alerts).where(and(isNull(alerts.deliveredAt), isNull(alerts.resolvedAt))).limit(limit);
    const configured = !!url && /^https:\/\//.test(url) && !!secret && secret.length >= 16;
    if (!configured) {
      if (pending.length) logEvent("error", "alert.undeliverable", { pending: pending.length, reason: "SPAK_ALERT_WEBHOOK_URL (https) and SPAK_ALERT_WEBHOOK_SECRET (16+ chars) are not configured" });
      return { delivered: 0, pending: pending.length, configured };
    }
    let delivered = 0;
    for (const a of pending) {
      const body = JSON.stringify({ service: "spak", environment: NETWORK_ENV, kind: a.kind, severity: a.severity, message: a.message, ref: a.ref, count: a.count, firstAt: a.firstAt, lastAt: a.lastAt, data: a.data });
      const sig = createHmac("sha256", secret!).update(body).digest("hex");
      let error: string | null = null;
      try {
        const r = await (this.o.fetchImpl ?? fetch)(url!, { method: "POST", headers: { "content-type": "application/json", "x-spak-signature": `sha256=${sig}` }, body, signal: AbortSignal.timeout(8_000) });
        if (!r.ok) error = `HTTP ${r.status}`;
      } catch (e) { error = (e as Error).message.slice(0, 200); }
      await this.db.update(alerts).set({ deliveryAttempts: sql`${alerts.deliveryAttempts} + 1`, ...(error ? { deliveryError: error } : { deliveredAt: this.clock(), deliveryError: null }) }).where(eq(alerts.id, a.id));
      if (!error) delivered++;
      else logEvent("error", "alert.delivery_failed", { kind: a.kind, error });
    }
    return { delivered, pending: pending.length - delivered, configured };
  }
}
