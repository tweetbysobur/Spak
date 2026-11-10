import type { SpakError } from "../errors/codes";
import type { RecipientSlot, VerbClass } from "../parser/frame";
import type { Allocation, AmountSpec, Condition, Constraints, Schedule, Target } from "../schemas/intent";

/** The engine's working copy of an intent. Stored in the session so follow-ups can amend it. */
export interface Draft {
  intentType: string;
  innerType: string | null;
  verb: VerbClass | null;
  amount: AmountSpec | null;
  sourceSymbol: string | null;
  sourceNetwork: string | null;
  destSymbol: string | null;
  destNetwork: string | null;
  /** Exact registry ids, set by Manual Access pickers or when a user picks one of several same-symbol assets. */
  sourceAssetId?: string | null;
  destAssetId?: string | null;
  recipient: RecipientSlot | null;
  refundAddress: string | null;
  schedule: Schedule | null;
  condition: Condition | null;
  constraints: Constraints;
  target: Target | null;
  query: { assets: string[]; networks: string[] } | null;
  allocations: Allocation[] | null;
  unknownSymbols: string[];
  /** Problems from parsing. Validation problems are recomputed on every turn. */
  parseIssues: SpakError[];
  assumptions: string[];
}

export interface SessionState {
  sessionId: string;
  userId: string | null;
  intentId: string;
  revision: number;
  draft: Draft;
  lastStatus: string;
  /** Set once the coordinator has accepted a plan for this intent; later edits start a new intent. */
  submitted: boolean;
  updatedAt: string;
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionState | null>;
  put(state: SessionState): Promise<void>;
  markSubmitted(sessionId: string, intentId: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly m = new Map<string, SessionState>();
  constructor(private readonly maxSessions = 10_000) {}
  async get(id: string) { return structuredClone(this.m.get(id) ?? null); }
  async put(s: SessionState) {
    if (this.m.size >= this.maxSessions && !this.m.has(s.sessionId)) {
      const oldest = this.m.keys().next().value; // insertion order = LRU approximation
      if (oldest) this.m.delete(oldest);
    }
    this.m.delete(s.sessionId);
    this.m.set(s.sessionId, structuredClone(s));
  }
  async markSubmitted(id: string, intentId: string) {
    const s = this.m.get(id);
    if (s && s.intentId === intentId) s.submitted = true;
  }
  async delete(id: string) { this.m.delete(id); }
}
