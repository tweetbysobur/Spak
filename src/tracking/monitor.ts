import { randomBytes } from "node:crypto";
import type { DepositRecords } from "../deposits/records";
import type { DepositService } from "../deposits/service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { ExecutionService } from "../execution/service";
import { TERMINAL, type ExecutionState } from "../execution/state";
import type { DestinationVerifier } from "./destination";
import type { TrackingRecords } from "./records";
import type { FailureService } from "../failures/service";
import type { RefundVerifier } from "../failures/refunds";

export const MONITOR = {
  leaseMs: 2 * 60_000, // a crashed worker's claim expires after this; another run takes over
  baseRetryMs: 30_000,
  maxRetryMs: 30 * 60_000,
  maxFailures: 24, // consecutive failed attempts before monitoring stops and asks for reconciliation
  maxAgeMs: 7 * 24 * 3600_000, // in-flight executions older than this stop being polled (refund cases slow down instead)
  lateRefundIntervalMs: 6 * 3600_000,
  interval: { AWAITING_DEPOSIT: 60_000, PROCESSING: 30_000, VERIFYING_DESTINATION: 30_000, FAILED: 2 * 60_000, REFUNDING: 60_000, UNKNOWN: 5 * 60_000 } as Record<string, number>,
};

export interface RunSummary { runId: string; claimed: number; processed: number; retried: number; gaveUp: number; skipped: number; durationMs: number }

/**
 * Execution Monitor: the background half of SPak Execution. It does not decide anything new; it calls the existing
 * deposit verifier, the existing provider status check, and the destination verifier, on a schedule, for executions
 * it has atomically claimed. Safe to run concurrently and to re-run: every step is idempotent and compare-and-set.
 */
export class ExecutionMonitor {
  constructor(private readonly d: {
    tracking: TrackingRecords; executions: ExecutionRecords; execution: ExecutionService; deposits: DepositService; depositRecords: DepositRecords;
    destination: DestinationVerifier; refunds?: RefundVerifier; failures?: FailureService; clock?: () => Date; log?: (msg: string, data?: Record<string, unknown>) => void;
  }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  async run(opts: { trigger: string; limit?: number; budgetMs?: number; workerId?: string }): Promise<RunSummary> {
    const started = Date.now();
    const runId = `run_${randomBytes(9).toString("hex")}`;
    const worker = opts.workerId ?? runId;
    await this.d.tracking.startRun(runId, opts.trigger);
    const s: RunSummary = { runId, claimed: 0, processed: 0, retried: 0, gaveUp: 0, skipped: 0, durationMs: 0 };
    let error: string | null = null;
    try {
      for (const { id } of await this.d.tracking.candidates(opts.limit ?? 20)) {
        if (Date.now() - started > (opts.budgetMs ?? 25_000)) break; // stay inside the function time limit; the rest waits for the next run
        const row = await this.d.tracking.claim(id, worker, MONITOR.leaseMs);
        if (!row) { s.skipped++; continue; } // another worker has it
        s.claimed++;
        const r = await this.processClaimed(row, worker);
        s.processed++;
        if (r === "RETRY") s.retried++;
        if (r === "GAVE_UP") s.gaveUp++;
      }
    } catch (e) {
      error = (e as Error).message;
      this.d.log?.("monitor run failed", { runId, error });
    }
    s.durationMs = Date.now() - started;
    await this.d.tracking.finishRun(runId, { claimed: s.claimed, processed: s.processed, failed: s.retried + s.gaveUp, error });
    return s;
  }

  /** One monitoring attempt for an execution this worker holds. Always releases the lease. */
  async processClaimed(row: ExecutionRow, worker: string): Promise<"OK" | "RETRY" | "GAVE_UP"> {
    const attempt = await this.d.tracking.startAttempt({ executionId: row.id, workerId: worker, fromState: row.state });
    let current = row, ok = true;
    const errors: string[] = [];
    try {
      // 1. Source deposits still being verified.
      for (const dep of await this.d.depositRecords.inStates(row.id, ["SUBMITTED", "VERIFICATION_PENDING"])) {
        const v = await this.d.deposits.verify({ userId: dep.userId, depositId: dep.id, force: true });
        if (v.state === "VERIFICATION_PENDING" && v.reason && /reach|RPC|chain check/i.test(v.reason)) { ok = false; errors.push(`deposit: ${v.reason}`); }
      }
      current = (await this.d.executions.get(row.id))!;
      // 2. Provider progress (never trusted for completion).
      const p = await this.d.execution.checkProvider(current, { force: true });
      current = p.row;
      if (!p.ok) { ok = false; errors.push(`provider: ${p.error}`); }
      // 3. Destination chain.
      if (current.state === "VERIFYING_DESTINATION") {
        const v = await this.d.destination.verify(current);
        current = v.row;
        if (!v.ok) { ok = false; errors.push(`destination: ${v.error}`); }
      }
      // 4. Failed swaps and refunds: track the refund to the refund address and verify it on the source chain.
      if (this.d.refunds && (current.state === "FAILED" || current.state === "REFUNDING")) {
        const v = await this.d.refunds.verify(current);
        current = v.row;
        if (!v.ok) { ok = false; errors.push(`refund: ${v.error}`); }
        if (v.needsReview) await this.d.failures?.flagForReview(current.id, v.needsReview, "spak");
      }
    } catch (e) {
      ok = false;
      errors.push((e as Error).message);
      current = (await this.d.executions.get(row.id)) ?? current;
    }

    const now = this.now();
    const failures = ok ? 0 : (row.monitorFailures ?? 0) + 1;
    const terminal = TERMINAL.has(current.state as ExecutionState);
    const reconcile = (current.error as { code?: string } | null)?.code === "NEEDS_RECONCILIATION" && current.state === "UNKNOWN";
    const tooOld = now.getTime() - (current.approvedAt ?? current.createdAt).getTime() > MONITOR.maxAgeMs;
    let outcome: "OK" | "RETRY" | "GAVE_UP" = ok ? "OK" : "RETRY";
    let gaveUpAt: Date | null = null;
    // Refunds are never abandoned: a refund can arrive late and the provider may update much later. Failed swaps and
    // refunds keep being checked (slower when old or failing) and get a review case instead of a give-up.
    const refundCase = current.state === "FAILED" || current.state === "REFUNDING";
    if (refundCase && !terminal && (failures >= MONITOR.maxFailures || tooOld)) {
      await this.d.failures?.flagForReview(current.id, tooOld ? "Refund still open after 7 days; monitoring continues." : `${failures} consecutive refund checks failed; monitoring continues.`, "spak");
    } else if (!terminal && (failures >= MONITOR.maxFailures || tooOld || reconcile)) {
      outcome = "GAVE_UP";
      gaveUpAt = now;
      if (!reconcile && current.state !== "UNKNOWN") {
        const why = tooOld ? "Still in flight after 7 days." : `${failures} consecutive monitoring attempts failed.`;
        current = (await this.d.executions.transition(current.id, current.state as ExecutionState, "UNKNOWN", `${why} Automatic monitoring stopped; needs manual reconciliation.`,
          { error: { code: "NEEDS_RECONCILIATION", reason: why, destinationTxHashes: current.destinationTxHashes } })) ?? current;
      }
      this.d.log?.("monitor gave up", { executionId: current.id, failures, tooOld, reconcile });
      await this.d.failures?.flagForReview(current.id, (current.error as { reason?: string } | null)?.reason ?? "Automatic monitoring stopped.", "spak");
    }
    // 5. Classification (history is written only when it changes).
    try { await this.d.failures?.record(current); } catch (e) { errors.push(`classify: ${(e as Error).message}`); }
    const base = ok ? (MONITOR.interval[current.state] ?? 60_000) : Math.min(MONITOR.baseRetryMs * 2 ** Math.min(failures - 1, 20), MONITOR.maxRetryMs);
    const delay = refundCase && tooOld ? Math.max(base, MONITOR.lateRefundIntervalMs) : base;
    await this.d.tracking.release(row.id, worker, {
      monitorNextAt: terminal || gaveUpAt ? null : new Date(now.getTime() + delay), monitorFailures: failures, ...(gaveUpAt ? { monitorGaveUpAt: gaveUpAt } : {}),
    });
    await this.d.tracking.finishAttempt(attempt, { outcome, toState: current.state, detail: errors.length ? errors.join(" | ") : null });
    if (!ok) this.d.log?.("monitor attempt failed", { executionId: row.id, failures, errors });
    return outcome;
  }
}
