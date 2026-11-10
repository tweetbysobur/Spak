import type { ExecutionPlan } from "../schemas/plan";
import { DuplicateKeyError, type AuditEvent, type AuditLog, type Submission, type SubmissionRepository } from "./types";

export class MemorySubmissionRepository implements SubmissionRepository {
  private readonly rows = new Map<string, Submission>();
  async create(s: Submission) {
    for (const r of this.rows.values()) {
      if (r.planHash === s.planHash) throw new DuplicateKeyError("planHash");
      if (s.idempotencyKey && r.userId === s.userId && r.idempotencyKey === s.idempotencyKey) throw new DuplicateKeyError("idempotencyKey");
    }
    this.rows.set(s.id, structuredClone(s));
  }
  async update(id: string, patch: Partial<Submission>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...structuredClone(patch) });
  }
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async findByPlanHash(h: string) { return structuredClone([...this.rows.values()].find((r) => r.planHash === h) ?? null); }
  async findByIdempotencyKey(u: string, k: string) {
    return structuredClone([...this.rows.values()].find((r) => r.userId === u && r.idempotencyKey === k) ?? null);
  }
  async findRecentByFingerprint(u: string, fp: string, since: string) {
    return [...this.rows.values()].filter((r) => r.userId === u && r.fingerprint === fp && r.createdAt >= since).map((r) => structuredClone(r));
  }
}

export class MemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];
  async record(e: AuditEvent) { this.events.push(structuredClone(e)); }
}

/** Plans SPak-in issued, by hash. Feed it from SpakIn's onResult. Bounded. */
export class MemoryPlanStore {
  private readonly m = new Map<string, ExecutionPlan>();
  constructor(private readonly max = 10_000) {}
  async put(p: ExecutionPlan) {
    if (this.m.size >= this.max) { const k = this.m.keys().next().value; if (k) this.m.delete(k); }
    this.m.set(p.hash, structuredClone(p));
  }
  async get(hash: string) { return structuredClone(this.m.get(hash) ?? null); }
}
