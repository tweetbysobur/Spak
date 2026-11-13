CREATE TABLE "spak_guard_asset_rules" (
	"user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"rule" text NOT NULL,
	CONSTRAINT "spak_guard_asset_rules_user_id_asset_id_pk" PRIMARY KEY("user_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "spak_guard_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"execution_id" text,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"plan_hash" text,
	"quote_id" text,
	"policy_version" integer,
	"value_usd" text,
	"rules" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_guard_network_rules" (
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"allow_source" boolean NOT NULL,
	"allow_destination" boolean NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "spak_guard_network_rules_user_id_network_pk" PRIMARY KEY("user_id","network")
);
--> statement-breakpoint
CREATE TABLE "spak_guard_policies" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"execution_disabled" boolean DEFAULT false NOT NULL,
	"max_transaction_usd" text,
	"min_transaction_usd" text,
	"daily_limit_usd" text,
	"weekly_limit_usd" text,
	"monthly_limit_usd" text,
	"max_slippage_bps" integer NOT NULL,
	"asset_mode" text NOT NULL,
	"recipient_mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_guard_policy_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_guard_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_guard_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"amount_usd" text NOT NULL,
	"status" text NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"settle_reason" text
);
--> statement-breakpoint
ALTER TABLE "spak_guard_asset_rules" ADD CONSTRAINT "spak_guard_asset_rules_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_decisions" ADD CONSTRAINT "spak_guard_decisions_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_network_rules" ADD CONSTRAINT "spak_guard_network_rules_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_policies" ADD CONSTRAINT "spak_guard_policies_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_policy_history" ADD CONSTRAINT "spak_guard_policy_history_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_recipients" ADD CONSTRAINT "spak_guard_recipients_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_reservations" ADD CONSTRAINT "spak_guard_reservations_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_guard_reservations" ADD CONSTRAINT "spak_guard_reservations_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spak_guard_decisions_exec_idx" ON "spak_guard_decisions" USING btree ("execution_id","at");--> statement-breakpoint
CREATE INDEX "spak_guard_decisions_user_idx" ON "spak_guard_decisions" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_guard_history_version_uq" ON "spak_guard_policy_history" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "spak_guard_history_user_idx" ON "spak_guard_policy_history" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_guard_recipients_uq" ON "spak_guard_recipients" USING btree ("user_id","network","address");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_guard_reservations_exec_uq" ON "spak_guard_reservations" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "spak_guard_reservations_user_idx" ON "spak_guard_reservations" USING btree ("user_id","status","reserved_at");--> statement-breakpoint
ALTER TABLE "spak_guard_policies" ADD CONSTRAINT "spak_guard_policies_status_ck" CHECK ("status" IN ('ACTIVE','PAUSED') AND "asset_mode" IN ('ANY','ALLOWLIST') AND "recipient_mode" IN ('ANY','APPROVED_ONLY') AND "max_slippage_bps" BETWEEN 1 AND 5000 AND "version" >= 1);--> statement-breakpoint
ALTER TABLE "spak_guard_asset_rules" ADD CONSTRAINT "spak_guard_asset_rules_rule_ck" CHECK ("rule" IN ('ALLOW','BLOCK'));--> statement-breakpoint
ALTER TABLE "spak_guard_decisions" ADD CONSTRAINT "spak_guard_decisions_outcome_ck" CHECK ("outcome" IN ('ALLOWED','BLOCKED','REQUIRES_APPROVAL','NEEDS_CONFIGURATION'));--> statement-breakpoint
ALTER TABLE "spak_guard_reservations" ADD CONSTRAINT "spak_guard_reservations_status_ck" CHECK ("status" IN ('RESERVED','CONSUMED','RELEASED'));
--> statement-breakpoint
-- guard-backfill: transfers approved before Guard existed get the reservation they would have had, so their spending
-- counts and their deposit can still be prepared. Settled states are settled here too. Idempotent.
INSERT INTO "spak_guard_reservations" ("id", "user_id", "execution_id", "quote_id", "decision_id", "amount_usd", "status", "reserved_at", "settled_at", "settle_reason")
SELECT 'grs_' || substr(md5(e."id"), 1, 24), e."user_id", e."id", e."firm_quote_id", 'migration-0009',
  coalesce(substring(q."amount_in_usd" from '^\s*([0-9]+(?:\.[0-9]+)?)'), '0'),
  CASE WHEN e."state" = 'COMPLETED' THEN 'CONSUMED' WHEN e."state" IN ('CANCELLED', 'EXPIRED', 'REFUNDED') THEN 'RELEASED' ELSE 'RESERVED' END,
  coalesce(e."approved_at", e."created_at"),
  CASE WHEN e."state" IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED') THEN e."updated_at" END,
  'Backfilled by migration 0009.'
FROM "spak_executions" e JOIN "spak_quotes" q ON q."id" = e."firm_quote_id"
WHERE e."approved_at" IS NOT NULL AND e."state" NOT IN ('DRAFT', 'QUOTED', 'AWAITING_APPROVAL')
ON CONFLICT ("execution_id") DO NOTHING;
