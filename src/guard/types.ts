/**
 * SPak Guard types. A policy is always read from the database on the server; nothing here is ever taken from
 * a request body as authority.
 */
export const GUARD_STAGES = ["PLAN", "QUOTE", "FIRM_QUOTE", "APPROVAL", "DEPOSIT"] as const;
export type GuardStage = (typeof GUARD_STAGES)[number];

export const GUARD_OUTCOMES = ["ALLOWED", "BLOCKED", "REQUIRES_APPROVAL", "NEEDS_CONFIGURATION"] as const;
export type GuardOutcome = (typeof GUARD_OUTCOMES)[number];

export type RuleId =
  | "POLICY" | "PAUSED" | "EXECUTION_DISABLED" | "SOURCE_NETWORK" | "DESTINATION_NETWORK" | "SOURCE_ASSET" | "DESTINATION_ASSET"
  | "QUOTE_CHECKED" | "SLIPPAGE" | "RECIPIENT" | "VALUE_KNOWN" | "MAX_TRANSACTION" | "MIN_TRANSACTION" | "DAILY_LIMIT" | "WEEKLY_LIMIT" | "MONTHLY_LIMIT";

export type RuleStatus = "PASS" | "FAIL" | "NEEDS_CONFIGURATION" | "NOT_APPLICABLE";
export interface RuleResult { rule: RuleId; status: RuleStatus; reason: string }

export interface NetworkRule { allowSource: boolean; allowDestination: boolean; disabled: boolean }
export interface Recipient { id: string; network: string; address: string; label: string | null }

export interface GuardPolicy {
  userId: string;
  version: number;
  status: "ACTIVE" | "PAUSED";
  executionDisabled: boolean;
  limits: { maxTransactionUsd: string | null; minTransactionUsd: string | null; dailyUsd: string | null; weeklyUsd: string | null; monthlyUsd: string | null };
  maxSlippageBps: number;
  assetMode: "ANY" | "ALLOWLIST";
  recipientMode: "ANY" | "APPROVED_ONLY";
  networks: Record<string, NetworkRule>;
  assets: Record<string, "ALLOW" | "BLOCK">;
  recipients: Recipient[];
  updatedAt: string;
}

/** What is being evaluated. Built by the server from its own records (plan, execution, quote), never from the browser. */
export interface GuardSubject {
  sourceNetwork: string;
  destinationNetwork: string;
  sourceAssetId: string;
  destinationAssetId: string;
  recipient: string;
  recipientKind: "SELF" | "EXTERNAL";
  slippageBps: number;
  /** USD value of what the user sends. Null when it is not known yet. */
  valueUsd: string | null;
  /** Quote output, when a quote exists: the implied slippage is checked too. */
  quote?: { amountOut: string | null; minAmountOut: string | null } | null;
  planHash: string | null;
  quoteId: string | null;
  executionId: string | null;
}

/** Spending already counted in each rolling window, excluding the subject's own execution. */
export interface Spending { dayUsd: string; weekUsd: string; monthUsd: string }

export interface GuardDecision {
  outcome: GuardOutcome;
  stage: GuardStage;
  rules: RuleResult[];
  /** Plain-language reasons for anything that blocks or needs configuration. Safe to show the user. */
  reasons: string[];
  policyVersion: number | null;
  valueUsd: string | null;
  planHash: string | null;
  quoteId: string | null;
  executionId: string | null;
  evaluatedAt: string;
}

export const WINDOWS_MS = { day: 24 * 3600_000, week: 7 * 24 * 3600_000, month: 30 * 24 * 3600_000 } as const;
