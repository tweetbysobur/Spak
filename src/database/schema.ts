import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, bigserial } from "drizzle-orm/pg-core";

/** Conversation context for follow-ups. One row per session. */
export const sessions = pgTable("spak_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  intentId: text("intent_id").notNull(),
  revision: integer("revision").notNull(),
  draft: jsonb("draft").notNull(),
  lastStatus: text("last_status").notNull(),
  submitted: integer("submitted").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_sessions_updated_idx").on(t.updatedAt)]);

/** Every interpreted instruction and revision. Feeds accuracy metrics and support. */
export const intents = pgTable("spak_intents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  intentId: text("intent_id").notNull(),
  revision: integer("revision").notNull(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id"),
  input: text("input").notNull(),
  intentType: text("intent_type").notNull(),
  status: text("status").notNull(),
  planHash: text("plan_hash"),
  result: jsonb("result").notNull(),
  processingMs: text("processing_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("spak_intents_rev_uq").on(t.intentId, t.revision), index("spak_intents_user_idx").on(t.userId, t.createdAt)]);

/** Approved plans handed to SPak Execution. Unique plan hash and idempotency key prevent double execution. */
export const submissions = pgTable("spak_submissions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  intentId: text("intent_id").notNull(),
  planId: text("plan_id").notNull(),
  planHash: text("plan_hash").notNull(),
  fingerprint: text("fingerprint").notNull(),
  idempotencyKey: text("idempotency_key"),
  provider: text("provider"),
  state: text("state").notNull(),
  providerRef: text("provider_ref"),
  deposit: jsonb("deposit"),
  quote: jsonb("quote"),
  error: jsonb("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("spak_submissions_plan_uq").on(t.planHash),
  uniqueIndex("spak_submissions_idem_uq").on(t.userId, t.idempotencyKey),
  index("spak_submissions_fp_idx").on(t.userId, t.fingerprint, t.createdAt),
]);

/** Append-only audit trail. */
export const auditLog = pgTable("spak_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  actor: text("actor").notNull(),
  event: text("event").notNull(),
  ref: text("ref").notNull(),
  data: jsonb("data").notNull(),
}, (t) => [index("spak_audit_ref_idx").on(t.ref, t.at)]);

// ---------------------------------------------------------------------------
// Identity and wallets (milestone: wallet auth). SPak-in tables above are unchanged.
// ---------------------------------------------------------------------------

/** A SPak user. Created on first wallet sign-in. No email or password. */
export const users = pgTable("spak_users", {
  id: text("id").primaryKey(),
  /** The wallet SPak-in uses by default. Must belong to this user (checked in code). */
  activeWalletId: text("active_wallet_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Login sessions. Only a SHA-256 of the cookie token is stored, never the token. */
export const authSessions = pgTable("spak_auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
}, (t) => [uniqueIndex("spak_auth_sessions_token_uq").on(t.tokenHash), index("spak_auth_sessions_user_idx").on(t.userId)]);

/** Verified wallets. One wallet (family + address) can belong to one user only. */
export const wallets = pgTable("spak_wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  family: text("family").notNull(), // evm | solana | near
  address: text("address").notNull(), // normalized: evm lower-case, near lower-case, solana base58 as is
  /** For NEAR: the public key that signed. Evidence of which key proved ownership. */
  publicKey: text("public_key"),
  label: text("label"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_wallets_addr_uq").on(t.family, t.address), index("spak_wallets_user_idx").on(t.userId)]);

/** Which SPak networks a wallet is used on. EVM wallets can serve several EVM networks. */
export const walletNetworks = pgTable("spak_wallet_networks", {
  walletId: text("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
  networkId: text("network_id").notNull(),
  enabled: integer("enabled").notNull().default(1),
}, (t) => [uniqueIndex("spak_wallet_networks_pk").on(t.walletId, t.networkId)]);

/** One-time sign-in or link challenges. used_at is set atomically before the signature is checked. */
export const walletChallenges = pgTable("spak_wallet_challenges", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull(),
  purpose: text("purpose").notNull(), // SIGN_IN | LINK
  family: text("family").notNull(),
  address: text("address").notNull(),
  /** Set for LINK: only this user may complete it. */
  userId: text("user_id"),
  message: text("message").notNull(),
  domain: text("domain").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [uniqueIndex("spak_wallet_challenges_nonce_uq").on(t.nonce), index("spak_wallet_challenges_exp_idx").on(t.expiresAt)]);

/** SPak Agent identity. Foundation only: links a verified NEAR account. No keys, no signing. */
export const agentIdentities = pgTable("spak_agent_identities", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  nearAccountId: text("near_account_id"),
  walletId: text("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
  status: text("status").notNull(), // NOT_LINKED | LINKED
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_agent_identities_user_uq").on(t.userId), uniqueIndex("spak_agent_identities_near_uq").on(t.nearAccountId)]);

// ---------------------------------------------------------------------------
// SPak Execution (phase 2). spak_submissions above is superseded and no longer written.
// ---------------------------------------------------------------------------

/** One execution of one SPak-in plan for one user. */
export const executions = pgTable("spak_executions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  intentId: text("intent_id").notNull(),
  planRevision: integer("plan_revision").notNull(),
  planId: text("plan_id").notNull(),
  planHash: text("plan_hash").notNull(),
  /** Snapshot of the plan as issued by SPak-in. Execution never reads plan data from the browser. */
  plan: jsonb("plan").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  /** Hash of user + leg, for the "same transfer twice in a short window" guard. */
  fingerprint: text("fingerprint").notNull(),
  state: text("state").notNull(),
  provider: text("provider").notNull(),
  sourceNetwork: text("source_network").notNull(),
  destinationNetwork: text("destination_network").notNull(),
  sourceAssetId: text("source_asset_id").notNull(),
  destinationAssetId: text("destination_asset_id").notNull(),
  amountIn: text("amount_in").notNull(), // smallest units
  recipient: text("recipient").notNull(),
  recipientKind: text("recipient_kind").notNull(), // SELF | EXTERNAL
  refundAddress: text("refund_address").notNull(),
  currentQuoteId: text("current_quote_id"),
  firmQuoteId: text("firm_quote_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  depositAddress: text("deposit_address"),
  depositMemo: text("deposit_memo"),
  depositDeadline: timestamp("deposit_deadline", { withTimezone: true }),
  providerStatus: text("provider_status"),
  providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
  originTxHashes: jsonb("origin_tx_hashes").notNull().default([]),
  destinationTxHashes: jsonb("destination_tx_hashes").notNull().default([]),
  amountOutSettled: text("amount_out_settled"),
  refundedAmount: text("refunded_amount"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
  lastStatusError: text("last_status_error"),
  error: jsonb("error"),
  /** Destination delivery verified by SPak on the destination chain (sum received by the recipient). */
  amountOutVerified: text("amount_out_verified"),
  destinationVerifiedAt: timestamp("destination_verified_at", { withTimezone: true }),
  /** Background monitor: lease (atomic claim), schedule, consecutive failures, and give-up marker. */
  monitorLeaseOwner: text("monitor_lease_owner"),
  monitorLeaseUntil: timestamp("monitor_lease_until", { withTimezone: true }),
  monitorNextAt: timestamp("monitor_next_at", { withTimezone: true }),
  monitorFailures: integer("monitor_failures").notNull().default(0),
  monitorGaveUpAt: timestamp("monitor_gave_up_at", { withTimezone: true }),
  /** Refund facts. refundedAmount/refundReason are what NEAR Intents reports; refundVerified* is what SPak saw on chain. */
  refundReason: text("refund_reason"),
  refundVerifiedAmount: text("refund_verified_amount"),
  refundVerifiedAt: timestamp("refund_verified_at", { withTimezone: true }),
  /** Latest failure classification (see src/failures). */
  failure: jsonb("failure"),
  /**
   * Stage 9: the SPak Agent this execution acts for, when the user started it through their Agent. Validated on the
   * server (owned, verified, ownership current) at creation and checked again at approval and deposit. Null for manual.
   */
  agentId: text("agent_id").references((): AnyPgColumn => agents.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("spak_executions_agent_idx").on(t.agentId, t.createdAt),
  uniqueIndex("spak_executions_idem_uq").on(t.userId, t.idempotencyKey),
  uniqueIndex("spak_executions_plan_uq").on(t.userId, t.planHash),
  uniqueIndex("spak_executions_deposit_uq").on(t.depositAddress),
  index("spak_executions_user_idx").on(t.userId, t.createdAt),
  index("spak_executions_fp_idx").on(t.userId, t.fingerprint, t.createdAt),
  index("spak_executions_monitor_idx").on(t.state, t.monitorNextAt),
]);

/** Every quote received from the provider, indicative or firm, with the provider's signature for disputes. */
export const quotes = pgTable("spak_quotes", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  planId: text("plan_id").notNull(),
  planHash: text("plan_hash").notNull(),
  planRevision: integer("plan_revision").notNull(),
  kind: text("kind").notNull(), // INDICATIVE (dry) | FIRM (deposit address)
  status: text("status").notNull(), // VALID | EXPIRED | REJECTED | SUPERSEDED | USED
  sourceNetwork: text("source_network").notNull(),
  destinationNetwork: text("destination_network").notNull(),
  sourceAssetId: text("source_asset_id").notNull(),
  destinationAssetId: text("destination_asset_id").notNull(),
  providerOriginAsset: text("provider_origin_asset").notNull(),
  providerDestinationAsset: text("provider_destination_asset").notNull(),
  amountIn: text("amount_in").notNull(),
  amountOut: text("amount_out"),
  minAmountOut: text("min_amount_out"),
  amountInUsd: text("amount_in_usd"),
  amountOutUsd: text("amount_out_usd"),
  slippageBps: integer("slippage_bps").notNull(),
  fees: jsonb("fees").notNull().default([]),
  depositAddress: text("deposit_address"),
  depositMemo: text("deposit_memo"),
  timeEstimateSec: integer("time_estimate_sec"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  providerDeadline: timestamp("provider_deadline", { withTimezone: true }),
  providerCorrelationId: text("provider_correlation_id"),
  providerSignature: text("provider_signature"),
  providerTimestamp: text("provider_timestamp"),
  rejectionReason: text("rejection_reason"),
  request: jsonb("request").notNull(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_quotes_exec_idx").on(t.executionId, t.createdAt), index("spak_quotes_user_idx").on(t.userId)]);

/** Append-only state history of each execution. */
export const executionEvents = pgTable("spak_execution_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  reason: text("reason").notNull(),
  data: jsonb("data").notNull().default({}),
}, (t) => [index("spak_execution_events_exec_idx").on(t.executionId, t.at)]);

// ---------------------------------------------------------------------------
// Approval and deposit (phase 3). Deposit states are separate from execution states.
// ---------------------------------------------------------------------------

/** An explicit user approval of one firm quote for one execution at one plan revision. */
export const approvals = pgTable("spak_approvals", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  quoteId: text("quote_id").notNull().references(() => quotes.id),
  planHash: text("plan_hash").notNull(),
  planRevision: integer("plan_revision").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidationReason: text("invalidation_reason"),
  /** Stage 10: USER (the user approved this exact quote) or AGENT_GRANT (approved under the Agent grant named below). */
  approvedBy: text("approved_by").notNull().default("USER"),
  grantId: text("grant_id"),
  grantVersion: integer("grant_version"),
}, (t) => [
  index("spak_approvals_grant_idx").on(t.grantId),
  // At most one live approval per execution: concurrent approvals cannot both succeed.
  uniqueIndex("spak_approvals_active_uq").on(t.executionId).where(sql`invalidated_at is null`),
  index("spak_approvals_quote_idx").on(t.quoteId),
]);

/** One attempt to fund an execution's deposit address from a user's wallet. */
export const deposits = pgTable("spak_deposits", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  quoteId: text("quote_id").notNull().references(() => quotes.id),
  approvalId: text("approval_id").notNull().references(() => approvals.id),
  family: text("family").notNull(), // evm | solana | near
  network: text("network").notNull(),
  kind: text("kind").notNull(), // NATIVE | ERC20 | SPL | NEP141
  assetId: text("asset_id").notNull(),
  tokenContract: text("token_contract"),
  depositAddress: text("deposit_address").notNull(),
  depositMemo: text("deposit_memo"),
  amount: text("amount").notNull(), // smallest units
  sender: text("sender").notNull(), // the user's verified wallet expected to sign
  method: text("method").notNull(), // WALLET | MANUAL
  state: text("state").notNull(),
  txHash: text("tx_hash"),
  confirmations: integer("confirmations"),
  verification: jsonb("verification"),
  providerNotifiedAt: timestamp("provider_notified_at", { withTimezone: true }),
  providerRecognizedAt: timestamp("provider_recognized_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  // A transaction can fund one deposit only, across all users.
  uniqueIndex("spak_deposits_tx_uq").on(t.network, t.txHash),
  index("spak_deposits_exec_idx").on(t.executionId, t.createdAt),
  index("spak_deposits_user_idx").on(t.userId, t.createdAt),
]);

/** Append-only deposit state history. */
export const depositEvents = pgTable("spak_deposit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  depositId: text("deposit_id").notNull().references(() => deposits.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  reason: text("reason").notNull(),
  data: jsonb("data").notNull().default({}),
}, (t) => [index("spak_deposit_events_dep_idx").on(t.depositId, t.at)]);

/**
 * One row per destination-chain transaction the provider reported for an execution, with SPak's own
 * verification of it. A destination transaction can belong to one execution only.
 */
export const destinationVerifications = pgTable("spak_destination_verifications", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  network: text("network").notNull(),
  txHash: text("tx_hash").notNull(),
  /** CONFIRMED | PENDING | NOT_FOUND | FAILED | NO_TRANSFER | UNVERIFIABLE | ERROR */
  outcome: text("outcome").notNull(),
  recipient: text("recipient").notNull(),
  assetId: text("asset_id").notNull(),
  tokenContract: text("token_contract"),
  receivedAmount: text("received_amount"),
  confirmations: integer("confirmations"),
  problems: jsonb("problems").notNull().default([]),
  observed: jsonb("observed").notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  firstCheckedAt: timestamp("first_checked_at", { withTimezone: true }).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("spak_dest_verif_tx_uq").on(t.network, t.txHash),
  index("spak_dest_verif_exec_idx").on(t.executionId),
]);

/** Every background monitoring attempt, for audit and reconciliation. */
export const monitorAttempts = pgTable("spak_monitor_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  workerId: text("worker_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** OK | RETRY | GAVE_UP | ERROR */
  outcome: text("outcome"),
  fromState: text("from_state").notNull(),
  toState: text("to_state"),
  detail: text("detail"),
}, (t) => [index("spak_monitor_attempts_exec_idx").on(t.executionId, t.startedAt)]);

/** Monitoring runs (one per cron or worker invocation). */
export const monitorRuns = pgTable("spak_monitor_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  claimed: integer("claimed").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  error: text("error"),
}, (t) => [index("spak_monitor_runs_started_idx").on(t.startedAt)]);

/**
 * Refund transactions seen for an execution: reported by NEAR Intents (origin-chain hashes that are not the deposit)
 * or submitted by the user. Each is verified on the source chain. A transaction can belong to one execution only.
 */
export const refundTxs = pgTable("spak_refund_txs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  network: text("network").notNull(),
  txHash: text("tx_hash").notNull(),
  source: text("source").notNull(), // PROVIDER | USER | ADMIN
  /** Refund record this candidate belongs to (spak_refunds is keyed by execution id). */
  refundId: text("refund_id"),
  outcome: text("outcome").notNull(),
  /** PROVIDER_LISTED (verified association) | PENDING_ASSOCIATION (candidate, relationship unproven) | REJECTED. */
  association: text("association").notNull().default("PENDING_ASSOCIATION"),
  associationEvidence: jsonb("association_evidence").notNull().default({}),
  /** Separate results: exists, success, network, recipient, asset, amount, finality, time, association, provider. */
  checks: jsonb("checks").notNull().default({}),
  sender: text("sender"),
  txTimestamp: timestamp("tx_timestamp", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  /** EXPECTED_WINDOW | LATE_TRANSACTION | EARLY_TRANSACTION | TIMING_UNKNOWN. Timing never associates. */
  timing: text("timing").notNull().default("TIMING_UNKNOWN"),
  recipient: text("recipient").notNull(),
  assetId: text("asset_id").notNull(),
  tokenContract: text("token_contract"),
  receivedAmount: text("received_amount"),
  confirmations: integer("confirmations"),
  problems: jsonb("problems").notNull().default([]),
  observed: jsonb("observed").notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  firstCheckedAt: timestamp("first_checked_at", { withTimezone: true }).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("spak_refund_txs_tx_uq").on(t.network, t.txHash),
  index("spak_refund_txs_exec_idx").on(t.executionId),
]);

/** One refund record per execution that needs one. State is SPak's refund lifecycle, separate from the execution state. */
export const refunds = pgTable("spak_refunds", {
  executionId: text("execution_id").primaryKey().references(() => executions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  network: text("network").notNull(),
  assetId: text("asset_id").notNull(),
  refundTo: text("refund_to").notNull(),
  refundType: text("refund_type").notNull(),
  depositedAmount: text("deposited_amount"),
  providerRefundedAmount: text("provider_refunded_amount"),
  providerRefundReason: text("provider_refund_reason"),
  verifiedAmount: text("verified_amount"),
  /** Verified on chain AND reliably associated with this execution (only this counts toward completion). */
  associatedAmount: text("associated_amount"),
  /** Provider-reported refund minus associated amount, when the provider stated an amount. */
  outstandingAmount: text("outstanding_amount"),
  /** Verified, in-time transfers NEAR Intents listed for this execution, counted only when the capability is CONFIRMED. */
  providerListedAmount: text("provider_listed_amount"),
  /** Refund-evidence capability in force at the last check: CONFIRMED | UNCONFIRMED | UNSUPPORTED. */
  evidenceCapability: text("evidence_capability"),
  /** Snapshot taken when the refund completed: provider amount and counted transactions. Never rewritten. */
  completionSnapshot: jsonb("completion_snapshot"),
  /** After completion SPak keeps comparing provider facts against the snapshot until this time. */
  watchUntil: timestamp("watch_until", { withTimezone: true }),
  /** CONSISTENT | DISCREPANCY (set by post-completion checks; never reverses COMPLETED). */
  reconciliation: text("reconciliation"),
  reconciliationCheckedAt: timestamp("reconciliation_checked_at", { withTimezone: true }),
  /** refundFee from the approved firm quote (documented on Quote). Displayed only; never used in arithmetic. */
  quotedRefundFee: text("quoted_refund_fee"),
  depositTxTimestamp: timestamp("deposit_tx_timestamp", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("spak_refunds_state_idx").on(t.state)]);

/** Append-only failure and refund history (classification changes, refund state changes). */
export const failureEvents = pgTable("spak_failure_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull(),
  category: text("category").notNull(),
  code: text("code").notNull(),
  temporary: integer("temporary").notNull().default(0),
  detail: jsonb("detail").notNull().default({}),
}, (t) => [index("spak_failure_events_exec_idx").on(t.executionId, t.at)]);

/** User-initiated recovery actions (submit refund tx, verify), for audit and abuse limits. */
export const recoveryAttempts = pgTable("spak_recovery_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  outcome: text("outcome").notNull(),
  detail: jsonb("detail").notNull().default({}),
}, (t) => [index("spak_recovery_attempts_exec_idx").on(t.executionId, t.at)]);

/** Manual review cases. At most one open case per execution. Reviewers add notes and evidence; they never set outcomes. */
export const reviews = pgTable("spak_reviews", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // OPEN | IN_REVIEW | RESOLVED
  reason: text("reason").notNull(),
  openedBy: text("opened_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
}, (t) => [
  uniqueIndex("spak_reviews_open_uq").on(t.executionId).where(sql`${t.status} <> 'RESOLVED'`),
  index("spak_reviews_status_idx").on(t.status, t.openedAt),
]);

export const reviewNotes = pgTable("spak_review_notes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull(),
  author: text("author").notNull(),
  note: text("note").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
}, (t) => [index("spak_review_notes_review_idx").on(t.reviewId, t.at)]);

/** Every reviewer action, with the reviewer identity resolved from server-side credentials. Append-only. */
export const adminAudit = pgTable("spak_admin_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  reviewerId: text("reviewer_id").notNull(),
  /** Short fingerprint of the credential used (hash prefix), never the credential. */
  credentialRef: text("credential_ref").notNull(),
  action: text("action").notNull(),
  executionId: text("execution_id"),
  reviewId: text("review_id"),
  reason: text("reason"),
  evidence: jsonb("evidence").notNull().default({}),
  outcome: text("outcome").notNull(),
}, (t) => [index("spak_admin_audit_review_idx").on(t.reviewId, t.at), index("spak_admin_audit_reviewer_idx").on(t.reviewerId, t.at)]);

/* ---------------------------------------------------------------- SPak Guard ---------------------------------------------------------------- */

/**
 * One Guard policy per user. `version` increases on every change; decisions record the version they used.
 * The row is also the lock that serialises spending reservations for the user (SELECT ... FOR UPDATE).
 * Money values are decimal strings in USD. Null limit means "not set" (the platform ceiling still applies).
 */
export const guardPolicies = pgTable("spak_guard_policies", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull(), // ACTIVE | PAUSED (paused: no new requests)
  executionDisabled: boolean("execution_disabled").notNull().default(false), // emergency: no deposit preparation either
  maxTransactionUsd: text("max_transaction_usd"),
  minTransactionUsd: text("min_transaction_usd"),
  dailyLimitUsd: text("daily_limit_usd"),
  weeklyLimitUsd: text("weekly_limit_usd"),
  monthlyLimitUsd: text("monthly_limit_usd"),
  maxSlippageBps: integer("max_slippage_bps").notNull(),
  assetMode: text("asset_mode").notNull(), // ANY | ALLOWLIST
  recipientMode: text("recipient_mode").notNull(), // ANY | APPROVED_ONLY
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Per-network rule. A network with no row needs configuration before it can be used. */
export const guardNetworkRules = pgTable("spak_guard_network_rules", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  network: text("network").notNull(),
  allowSource: boolean("allow_source").notNull(),
  allowDestination: boolean("allow_destination").notNull(),
  disabled: boolean("disabled").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.network] })]);

/** Per-asset rule by canonical asset id (network:address), never by symbol. */
export const guardAssetRules = pgTable("spak_guard_asset_rules", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull(),
  rule: text("rule").notNull(), // ALLOW | BLOCK
}, (t) => [primaryKey({ columns: [t.userId, t.assetId] })]);

/** Approved recipients. Approval is for one network only. Addresses are stored normalised for their family. */
export const guardRecipients = pgTable("spak_guard_recipients", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  network: text("network").notNull(),
  address: text("address").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_guard_recipients_uq").on(t.userId, t.network, t.address)]);

/** Append-only change history of a user's policy. */
export const guardPolicyHistory = pgTable("spak_guard_policy_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  changes: jsonb("changes").notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_guard_history_version_uq").on(t.userId, t.version), index("spak_guard_history_user_idx").on(t.userId, t.at)]);

/** Every Guard decision, bound to the plan hash, quote and policy version it evaluated. Append-only. */
export const guardDecisions = pgTable("spak_guard_decisions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  executionId: text("execution_id"),
  stage: text("stage").notNull(), // PLAN | QUOTE | FIRM_QUOTE | APPROVAL | DEPOSIT
  outcome: text("outcome").notNull(), // ALLOWED | BLOCKED | REQUIRES_APPROVAL | NEEDS_CONFIGURATION
  planHash: text("plan_hash"),
  quoteId: text("quote_id"),
  policyVersion: integer("policy_version"),
  valueUsd: text("value_usd"),
  rules: jsonb("rules").notNull(),
  reasons: jsonb("reasons").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_guard_decisions_exec_idx").on(t.executionId, t.at), index("spak_guard_decisions_user_idx").on(t.userId, t.at)]);

/**
 * Spending reservations. One per execution (unique), created atomically with approval.
 * RESERVED and CONSUMED count against limits; RELEASED does not.
 */
export const guardReservations = pgTable("spak_guard_reservations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
  quoteId: text("quote_id").notNull(),
  decisionId: text("decision_id").notNull(),
  amountUsd: text("amount_usd").notNull(),
  status: text("status").notNull(), // RESERVED | CONSUMED | RELEASED
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settleReason: text("settle_reason"),
}, (t) => [uniqueIndex("spak_guard_reservations_exec_uq").on(t.executionId), index("spak_guard_reservations_user_idx").on(t.userId, t.status, t.reservedAt)]);

/* ------------------------------------------------------------ SPak Agent identity ------------------------------------------------------------ */

/**
 * SPak Agent identity (Stage 5). Independent of connected wallets. Creating one grants no transaction permission.
 * Ownership is proven by a NEP-413 signature from a full-access key of the owner's NEAR account (checked on chain).
 * Owner fields are set only by a successful proof; nothing a client sends sets them directly.
 */
export const agents = pgTable("spak_agents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  status: text("status").notNull(), // CREATED | PENDING_VERIFICATION | VERIFIED | SUSPENDED | REVOKED
  ownerNetwork: text("owner_network"), // near
  ownerAccountId: text("owner_account_id"),
  ownerPublicKey: text("owner_public_key"),
  verificationMethod: text("verification_method"), // NEAR_NEP413_FULL_ACCESS_KEY
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
  /** sha256 of the canonical attestation record for the last successful proof. Off-chain evidence, not an on-chain proof. */
  attestationHash: text("attestation_hash"),
  attestation: jsonb("attestation"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  schemaVersion: integer("schema_version").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_agents_user_idx").on(t.userId)]);

/** One-time ownership challenges. The exact message is stored; the server verifies against its own copy. */
export const agentChallenges = pgTable("spak_agent_challenges", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // AGENT_OWNERSHIP
  method: text("method").notNull(), // NEAR_NEP413_FULL_ACCESS_KEY
  ownerAccountId: text("owner_account_id").notNull(),
  recipient: text("recipient").notNull(),
  nonce: text("nonce").notNull(), // 32 bytes, hex
  message: text("message").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  outcome: text("outcome"), // VERIFIED | FAILED
}, (t) => [uniqueIndex("spak_agent_challenges_nonce_uq").on(t.nonce), index("spak_agent_challenges_agent_idx").on(t.agentId, t.issuedAt)]);

/** Append-only identity audit trail. Updates are refused by a database trigger. */
export const agentEvents = pgTable("spak_agent_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  event: text("event").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  data: jsonb("data").notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_agent_events_agent_idx").on(t.agentId, t.at)]);

/* ------------------------------------------------------- SPak Agent wallet associations ------------------------------------------------------- */

/**
 * A wallet associated with an Agent (Stage 6). Proves the Agent owner controlled the wallet when it signed.
 * Grants SPak no signing authority and changes nothing in Guard. The wallet must already be one of the user's
 * verified wallets (spak_wallets); family, network and canonical address are kept as a snapshot so history
 * survives the wallet being disconnected.
 */
export const agentWallets = pgTable("spak_agent_wallets", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  walletId: text("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
  family: text("family").notNull(), // evm | solana | near
  network: text("network").notNull(), // SPak network the proof was made on (e.g. base, solana, near)
  chainId: text("chain_id"), // EVM only: the chain id signed in the EIP-4361 message
  address: text("address").notNull(), // canonical (EVM lowercase, NEAR lowercase, Solana exact)
  publicKey: text("public_key"), // NEAR: the signing key; Solana: the address is the key; EVM: null
  method: text("method").notNull(), // EIP4361_PERSONAL_SIGN | SIWS_ED25519 | NEAR_NEP413_FULL_ACCESS_KEY
  status: text("status").notNull(), // PENDING | ACTIVE | SUSPENDED | EXPIRED | REVOKED
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokeReason: text("revoke_reason"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_agent_wallets_agent_idx").on(t.agentId, t.status)]);

/** One-time association challenges. The exact message is stored; verification uses this copy only. */
export const agentWalletChallenges = pgTable("spak_agent_wallet_challenges", {
  id: text("id").primaryKey(),
  associationId: text("association_id").notNull().references(() => agentWallets.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  family: text("family").notNull(),
  method: text("method").notNull(),
  address: text("address").notNull(),
  chainId: text("chain_id"),
  domain: text("domain").notNull(),
  nonce: text("nonce").notNull(),
  message: text("message").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  outcome: text("outcome"),
}, (t) => [uniqueIndex("spak_agent_wallet_challenges_nonce_uq").on(t.nonce), index("spak_agent_wallet_challenges_assoc_idx").on(t.associationId)]);

/* ---------------------------------------------------------- Dedicated Agent NEAR account ---------------------------------------------------------- */

/**
 * The dedicated NEAR account for an Agent (Stage 7). Created by SPak's parent account in one atomic transaction
 * (CreateAccount + Transfer + AddKey) whose only full-access key is the Agent owner's verified public key.
 * SPak never holds a key on it. ACTIVE only after the backend reads the account and its keys from NEAR itself.
 */
export const agentAccounts = pgTable("spak_agent_accounts", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  network: text("network").notNull(), // testnet only in this stage
  accountId: text("account_id").notNull(),
  parentAccountId: text("parent_account_id").notNull(),
  ownerPublicKey: text("owner_public_key").notNull(),
  keyType: text("key_type").notNull(), // ed25519
  status: text("status").notNull(),
  sponsorship: text("sponsorship").notNull(), // NOT_FUNDED | RESERVED | FUNDED | NOT_SPENT
  fundingYocto: text("funding_yocto"), // amount attached by the sponsor, decimal string of yoctoNEAR
  creationTxHash: text("creation_tx_hash"),
  creationOutcome: text("creation_outcome"), // SUCCESS | FAILURE | UNKNOWN
  creationError: text("creation_error"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdOnChainAt: timestamp("created_on_chain_at", { withTimezone: true }),
  ownershipVerifiedAt: timestamp("ownership_verified_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  recoveryReason: text("recovery_reason"),
  /** The owner consent this account was created under (binds Agent, account id and approved key). */
  consentChallengeId: text("consent_challenge_id"),
  /** Last verification evidence read from NEAR: chain id, every access key and permission, decision, reason. Public data only. */
  verificationEvidence: jsonb("verification_evidence"),
  /** Background re-verification. The latest check, decisive or not; verificationEvidence keeps the last decisive one. */
  lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
  lastCheckResult: text("last_check_result"), // VERIFIED | RECOVERY_REQUIRED | INCONCLUSIVE
  lastCheckReason: text("last_check_reason"),
  lastCheckEvidence: jsonb("last_check_evidence"),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  checkLeaseUntil: timestamp("check_lease_until", { withTimezone: true }),
  schemaVersion: integer("schema_version").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_agent_accounts_idem_uq").on(t.idempotencyKey), index("spak_agent_accounts_user_idx").on(t.userId, t.createdAt)]);

/** One-time consent challenges for creating a dedicated account: the owner signs, with NEP-413, the exact account to create. */
export const agentAccountChallenges = pgTable("spak_agent_account_challenges", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  ownerPublicKey: text("owner_public_key").notNull(),
  domain: text("domain").notNull(),
  nonce: text("nonce").notNull(),
  message: text("message").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [uniqueIndex("spak_agent_account_challenges_nonce_uq").on(t.nonce)]);

/**
 * Key rotation for a dedicated Agent account. The owner proves authority with the key currently installed on the
 * dedicated account, then signs and sends, from their own wallet, one transaction on that account:
 * AddKey(new, FullAccess) + DeleteKey(old). SPak never signs it and never holds either private key.
 */
export const agentAccountRotations = pgTable("spak_agent_account_rotations", {
  id: text("id").primaryKey(),
  accountRowId: text("account_row_id").notNull().references(() => agentAccounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  oldPublicKey: text("old_public_key").notNull(),
  newPublicKey: text("new_public_key").notNull(),
  status: text("status").notNull(), // CHALLENGED | AUTHORIZED | COMPLETED | FAILED | EXPIRED
  domain: text("domain").notNull(),
  nonce: text("nonce").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  txHash: text("tx_hash"),
  evidence: jsonb("evidence"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("spak_agent_account_rotations_nonce_uq").on(t.nonce), index("spak_agent_account_rotations_acct_idx").on(t.accountRowId, t.createdAt)]);

/* ------------------------------------------------------------ Agent account funding ------------------------------------------------------------ */

/**
 * Stage 9: what NEAR showed about an ACTIVE dedicated Agent account's balance, read by the backend. Append-only
 * observations. FUNDED only when the read succeeded and the spendable balance (liquid minus storage reserve) meets
 * the minimum. A failed read is INCONCLUSIVE, never FUNDED. SPak sends no funds here: the owner funds from a wallet.
 */
export const agentFundingChecks = pgTable("spak_agent_funding_checks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountRowId: text("account_row_id").notNull().references(() => agentAccounts.id, { onDelete: "cascade" }),
  network: text("network").notNull(),
  accountId: text("account_id").notNull(),
  result: text("result").notNull(), // FUNDED | UNFUNDED | INCONCLUSIVE
  reason: text("reason"),
  balanceYocto: text("balance_yocto"),
  lockedYocto: text("locked_yocto"),
  storageUsage: integer("storage_usage"),
  spendableYocto: text("spendable_yocto"),
  minimumYocto: text("minimum_yocto").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
}, (t) => [index("spak_agent_funding_checks_agent_idx").on(t.agentId, t.checkedAt)]);

/* ------------------------------------------------------------ Agent permission grants ------------------------------------------------------------ */

/**
 * Stage 10: what an Agent may approve without asking the user each time. Default is no grant (manual: the user
 * approves every quote). A grant is created only from a NEP-413 signature by the Agent owner's verified key over the
 * exact scope; a session alone cannot create or widen one. It only narrows Guard: Guard still checks every transfer.
 * Versions are immutable: a change creates a new version and supersedes the old one. Pause and revoke need only a
 * session, because they take authority away. The user's wallet still signs every deposit; SPak signs nothing.
 */
export const agentGrants = pgTable("spak_agent_grants", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull(), // ACTIVE | PAUSED | REVOKED | SUPERSEDED
  scope: jsonb("scope").notNull(),
  scopeHash: text("scope_hash").notNull(),
  maxTransactionUsd: text("max_transaction_usd").notNull(),
  dailyLimitUsd: text("daily_limit_usd").notNull(),
  maxTransactions: integer("max_transactions").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ownerAccountId: text("owner_account_id").notNull(),
  signerPublicKey: text("signer_public_key").notNull(),
  challengeId: text("challenge_id").notNull(),
  messageSha256: text("message_sha256").notNull(),
  signature: text("signature").notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  endReason: text("end_reason"),
  rowVersion: integer("row_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("spak_agent_grants_version_uq").on(t.agentId, t.version),
  uniqueIndex("spak_agent_grants_live_uq").on(t.agentId).where(sql`status in ('ACTIVE','PAUSED')`),
  uniqueIndex("spak_agent_grants_challenge_uq").on(t.challengeId),
]);

/** One-time grant challenges: the exact scope and message the owner signs. Verification uses this stored copy only. */
export const agentGrantChallenges = pgTable("spak_agent_grant_challenges", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  scope: jsonb("scope").notNull(),
  scopeHash: text("scope_hash").notNull(),
  ownerAccountId: text("owner_account_id").notNull(),
  ownerPublicKey: text("owner_public_key").notNull(),
  domain: text("domain").notNull(),
  nonce: text("nonce").notNull(),
  message: text("message").notNull(),
  grantExpiresAt: timestamp("grant_expires_at", { withTimezone: true }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  outcome: text("outcome"),
}, (t) => [uniqueIndex("spak_agent_grant_challenges_nonce_uq").on(t.nonce), index("spak_agent_grant_challenges_agent_idx").on(t.agentId, t.issuedAt)]);

/* ------------------------------------------------------------ Environment marker ------------------------------------------------------------ */

/**
 * Which network environment this database belongs to. One row, written by the first server that starts on it. A
 * server for the other environment refuses to start: a Tidepool testnet build can never write into a mainnet
 * database, and a mainnet build never reads testnet records as real.
 */
export const environmentMarker = pgTable("spak_environment", {
  id: integer("id").primaryKey(),
  networkEnv: text("network_env").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
