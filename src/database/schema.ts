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
