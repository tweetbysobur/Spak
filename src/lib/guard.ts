/**
 * SPak Guard in the browser: types, API calls and wording. It only reads and displays what the server decided.
 * Nothing here evaluates a policy or computes spending; the server is the only source of truth.
 */
import { api } from "./client";
import type { GuardDecision, GuardPolicy, GuardStage, RuleId, RuleStatus, Spending } from "@/guard/types";

export type { GuardDecision, GuardPolicy, RuleId, Spending };

export interface GuardView { policy: GuardPolicy; spending: Spending; ceilingUsd: string; unconfiguredNetworks: string[] }
export interface HistoryItem { version: number; actor: string; action: string; changes: Record<string, { from: unknown; to: unknown } | unknown>; at: string }
export interface DecisionRow { id: string; stage: GuardStage; outcome: GuardDecision["outcome"]; rules: { rule: RuleId; status: RuleStatus; reason: string }[]; reasons: string[]; policyVersion: number | null; valueUsd: string | null; at: string }
export interface Reservation { status: "RESERVED" | "CONSUMED" | "RELEASED"; amountUsd: string; reservedAt: string; settledAt: string | null }
export type GuardPatch = Partial<{
  maxTransactionUsd: string | null; minTransactionUsd: string | null; dailyLimitUsd: string | null; weeklyLimitUsd: string | null; monthlyLimitUsd: string | null;
  maxSlippageBps: number; assetMode: "ANY" | "ALLOWLIST"; recipientMode: "ANY" | "APPROVED_ONLY";
  networks: { network: string; allowSource: boolean; allowDestination: boolean; disabled: boolean }[];
  assets: { assetId: string; rule: "ALLOW" | "BLOCK" }[];
}>;

/** Every write sends the version the user was looking at. The server refuses it if the policy changed since. */
export const guardApi = {
  get: () => api<GuardView>("/api/guard"),
  update: (version: number, patch: GuardPatch) => api<GuardView>("/api/guard", { version, ...patch }, "PATCH"),
  addRecipient: (version: number, r: { network: string; address: string; label?: string }) => api<GuardView>("/api/guard/recipients", { version, ...r }),
  removeRecipient: (version: number, id: string) => api<GuardView>(`/api/guard/recipients/${encodeURIComponent(id)}`, { version }, "DELETE"),
  pause: (scope: "REQUESTS" | "ALL") => api<GuardView>("/api/guard/pause", { scope }),
  resume: (version: number) => api<GuardView>("/api/guard/resume", { version }),
  history: (limit = 50) => api<{ items: HistoryItem[] }>(`/api/guard/history?limit=${limit}`),
  forExecution: (id: string) => api<{ decisions: DecisionRow[]; reservation: Reservation | null }>(`/api/executions/${encodeURIComponent(id)}/guard`),
};

export type GuardState = "ACTIVE" | "PAUSED" | "EXECUTION_DISABLED" | "NEEDS_CONFIGURATION";
/** The status the server's policy describes. */
export function guardState(v: GuardView): GuardState {
  if (v.policy.executionDisabled) return "EXECUTION_DISABLED";
  if (v.policy.status === "PAUSED") return "PAUSED";
  if (v.unconfiguredNetworks.length || (v.policy.assetMode === "ALLOWLIST" && !Object.values(v.policy.assets).includes("ALLOW"))) return "NEEDS_CONFIGURATION";
  return "ACTIVE";
}
export const STATE_TEXT: Record<GuardState | "UNAVAILABLE", { title: string; role: string; body: string }> = {
  ACTIVE: { title: "Active", role: "success", body: "Guard checks every transfer against your settings before it is quoted, approved and funded." },
  PAUSED: { title: "Paused", role: "warning", body: "No new transfers start. Transfers you already approved can still be funded, and every transfer keeps being tracked and recovered." },
  EXECUTION_DISABLED: { title: "Execution disabled", role: "error", body: "No new transfers start and no deposit instructions are given, even for approved transfers. Transfers already funded keep being tracked, verified and refunded." },
  NEEDS_CONFIGURATION: { title: "Configuration required", role: "warning", body: "Some settings need a decision before transfers that use them can go ahead." },
  UNAVAILABLE: { title: "Temporarily unavailable", role: "warning", body: "Guard settings could not be loaded. Nothing goes ahead while Guard cannot check it. Try again shortly." },
};

/** Headline per failed rule. The server's own reason gives the details. */
export const RULE_FAILED: Partial<Record<RuleId, string>> = {
  MAX_TRANSACTION: "Transfer exceeds your per-transfer limit.",
  MIN_TRANSACTION: "Transfer is below your minimum amount.",
  DAILY_LIMIT: "Daily spending limit reached.",
  WEEKLY_LIMIT: "Weekly spending limit reached.",
  MONTHLY_LIMIT: "Monthly spending limit reached.",
  SOURCE_NETWORK: "This network is not allowed by your Guard settings.",
  DESTINATION_NETWORK: "This network is not allowed by your Guard settings.",
  SOURCE_ASSET: "This token is not allowed by your Guard settings.",
  DESTINATION_ASSET: "This token is not allowed by your Guard settings.",
  RECIPIENT: "This recipient has not been approved.",
  SLIPPAGE: "Slippage exceeds your configured limit.",
  PAUSED: "Guard is paused. New transfers are currently disabled.",
  EXECUTION_DISABLED: "All execution is disabled in Guard.",
  VALUE_KNOWN: "Guard could not confirm the USD value of this transfer.",
  QUOTE_CHECKED: "This quote was not checked by Guard. Get a new quote.",
  POLICY: "Your Guard policy needs to be set up.",
};
/** Short label per rule, for decision lists. */
export const RULE_LABEL: Record<RuleId, string> = {
  POLICY: "Guard policy", PAUSED: "Guard active", EXECUTION_DISABLED: "Execution enabled", SOURCE_NETWORK: "Source network permission",
  DESTINATION_NETWORK: "Destination network permission", SOURCE_ASSET: "Token sent", DESTINATION_ASSET: "Token received", QUOTE_CHECKED: "Quote checked by Guard",
  SLIPPAGE: "Slippage limit", RECIPIENT: "Recipient approval", VALUE_KNOWN: "USD value known", MAX_TRANSACTION: "Amount limit", MIN_TRANSACTION: "Minimum amount",
  DAILY_LIMIT: "24-hour limit", WEEKLY_LIMIT: "7-day limit", MONTHLY_LIMIT: "30-day limit",
};
export const STATUS_WORD: Record<RuleStatus, string> = { PASS: "passed", FAIL: "blocked", NEEDS_CONFIGURATION: "needs a setting", NOT_APPLICABLE: "checked later" };
export const STAGE_LABEL: Record<GuardStage, string> = { PLAN: "Plan", QUOTE: "Quote", FIRM_QUOTE: "Firm quote", APPROVAL: "Approval", DEPOSIT: "Deposit" };

export interface GuardMessage { title: string; reasons: string[] }

/** Explanation of a Guard decision the server returned with a plan. Null when the plan may go ahead. */
export function planBlock(d: GuardDecision | null | undefined): GuardMessage | null {
  if (!d || (d.outcome !== "BLOCKED" && d.outcome !== "NEEDS_CONFIGURATION")) return null;
  const failed = d.rules.filter((r) => r.status === "FAIL" || r.status === "NEEDS_CONFIGURATION").map((r) => r.rule);
  return { title: titleFor(failed, d.outcome === "NEEDS_CONFIGURATION"), reasons: d.reasons };
}

/** Translate a Guard error from any SPak API into a clear message. Null for errors that are not Guard's. */
export function guardMessage(e: unknown): GuardMessage | null {
  const err = e as { code?: string; message?: string; details?: { failedRules?: RuleId[]; reasons?: string[] } };
  const reasons = err.details?.reasons?.length ? err.details.reasons : err.message ? [err.message] : [];
  switch (err.code) {
    case "GUARD_BLOCKED": return { title: titleFor(err.details?.failedRules ?? [], false), reasons };
    case "GUARD_NEEDS_CONFIGURATION": return { title: titleFor(err.details?.failedRules ?? [], true), reasons };
    case "GUARD_UNAVAILABLE": return { title: "Guard is temporarily unavailable.", reasons: ["Nothing went ahead. Try again shortly."] };
    case "GUARD_VERSION_CONFLICT": return { title: "Your Guard settings changed elsewhere.", reasons: ["The latest settings are now shown. Review your change and save again."] };
    case "GUARD_INVALID_SETTING": return { title: "That setting was not accepted.", reasons };
    case "GUARD_RECIPIENT_NOT_FOUND": return { title: "That recipient no longer exists.", reasons: [] };
    default: return null;
  }
}

function titleFor(failed: RuleId[], config: boolean): string {
  // The most actionable rule first: emergency controls, then limits, then permissions.
  const order: RuleId[] = ["EXECUTION_DISABLED", "PAUSED", "DAILY_LIMIT", "WEEKLY_LIMIT", "MONTHLY_LIMIT", "MAX_TRANSACTION", "MIN_TRANSACTION", "RECIPIENT", "SOURCE_NETWORK", "DESTINATION_NETWORK", "SOURCE_ASSET", "DESTINATION_ASSET", "SLIPPAGE", "VALUE_KNOWN", "QUOTE_CHECKED", "POLICY"];
  const first = order.find((r) => failed.includes(r));
  if (first) return config && first !== "POLICY" ? `Guard needs a setting: ${RULE_LABEL[first].toLowerCase()}.` : RULE_FAILED[first]!;
  return config ? "Guard needs a setting before this can go ahead." : "Guard stopped this transfer.";
}

/** Share of a limit used, 0 to 100, only when the limit is set. Display only; enforcement happens on the server. */
export function usage(spent: string, limit: string | null): number | null {
  if (!limit) return null;
  const l = Number(limit), s = Number(spent);
  if (!(l > 0) || !Number.isFinite(s)) return null;
  return Math.min(100, Math.max(0, (s / l) * 100));
}
export const usd = (v: string | null | undefined) => (v == null ? "–" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
