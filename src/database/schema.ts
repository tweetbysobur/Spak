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
