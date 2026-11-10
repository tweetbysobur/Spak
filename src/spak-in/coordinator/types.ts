import { z } from "zod";
import type { SpakError } from "../errors/codes";
import type { ExecutionPlan } from "../schemas/plan";

/** A person's (or the policy's) approval, bound to one exact plan by its hash. */
export const approvalSchema = z.object({
  intentId: z.string(),
  planId: z.string(),
  planHash: z.string().length(64),
  approvedBy: z.enum(["USER", "POLICY"]),
  approvedAt: z.string().datetime(),
  /** Client-generated. Retrying with the same key never creates a second execution. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** The user confirmed they really want a second identical transfer. */
  allowDuplicate: z.boolean().default(false),
});
export type Approval = z.infer<typeof approvalSchema>;
export type ApprovalInput = z.input<typeof approvalSchema>;

export type ExecutionState =
  | "PREPARING" | "AWAITING_DEPOSIT" | "PROCESSING" | "COMPLETED" | "FAILED" | "REFUNDED" | "EXPIRED" | "CANCELLED" | "UNKNOWN";

export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set(["COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "CANCELLED"]);

export interface ProviderQuote {
  provider: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountInUsd: string | null;
  amountOutUsd: string | null;
  fees: { kind: "PROVIDER" | "NETWORK" | "REFUND"; amount: string; asset: string | null; note?: string }[];
  estimatedSeconds: number | null;
  expiresAt: string | null;
}

/** What the user's wallet must do. SPak never sends this transaction itself. */
export interface DepositInstruction {
  network: string;
  assetId: string;
  amount: string;
  address: string;
  memo: string | null;
  deadline: string;
}

export interface PreparedExecution {
  provider: string;
  providerRef: string;
  deposit: DepositInstruction;
  quote: ProviderQuote;
}

export interface ProviderStatus {
  state: ExecutionState;
  originTxHashes: string[];
  destinationTxHashes: string[];
  amountOut: string | null;
  raw: string;
}

/** SPak Execution providers implement this. NEAR Intents is the first; others plug in without touching SPak-in. */
export interface ExecutionProvider {
  readonly id: string;
  supports(plan: ExecutionPlan): { ok: true } | { ok: false; reason: string };
  quote(plan: ExecutionPlan): Promise<ProviderQuote>;
  prepare(plan: ExecutionPlan): Promise<PreparedExecution>;
  status(providerRef: string, deadline: string | null): Promise<ProviderStatus>;
}

export interface Submission {
  id: string;
  userId: string;
  intentId: string;
  planId: string;
  planHash: string;
  fingerprint: string;
  idempotencyKey: string | null;
  provider: string | null;
  state: ExecutionState;
  providerRef: string | null;
  deposit: DepositInstruction | null;
  quote: ProviderQuote | null;
  error: SpakError | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionRepository {
  /** Must fail with DuplicateKeyError when planHash or (userId, idempotencyKey) already exists. Atomic. */
  create(s: Submission): Promise<void>;
  update(id: string, patch: Partial<Submission>): Promise<void>;
  get(id: string): Promise<Submission | null>;
  findByPlanHash(planHash: string): Promise<Submission | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<Submission | null>;
  findRecentByFingerprint(userId: string, fingerprint: string, sinceIso: string): Promise<Submission[]>;
}

export interface AuditEvent {
  at: string;
  actor: string;
  event: string;
  ref: string;
  data: Record<string, unknown>;
}

export interface AuditLog {
  record(e: AuditEvent): Promise<void>;
}

export class DuplicateKeyError extends Error {
  constructor(public readonly key: string) { super(`Duplicate key: ${key}`); }
}
