import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, bigserial } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("spak_executions_idem_uq").on(t.userId, t.idempotencyKey),
  uniqueIndex("spak_executions_plan_uq").on(t.userId, t.planHash),
  uniqueIndex("spak_executions_deposit_uq").on(t.depositAddress),
  index("spak_executions_user_idx").on(t.userId, t.createdAt),
  index("spak_executions_fp_idx").on(t.userId, t.fingerprint, t.createdAt),
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
}, (t) => [
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
