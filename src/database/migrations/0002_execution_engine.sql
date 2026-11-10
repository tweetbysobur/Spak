CREATE TABLE "spak_execution_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_id" text NOT NULL,
	"plan_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"provider" text NOT NULL,
	"source_network" text NOT NULL,
	"destination_network" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"destination_asset_id" text NOT NULL,
	"amount_in" text NOT NULL,
	"recipient" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"refund_address" text NOT NULL,
	"current_quote_id" text,
	"firm_quote_id" text,
	"approved_at" timestamp with time zone,
	"deposit_address" text,
	"deposit_memo" text,
	"deposit_deadline" timestamp with time zone,
	"provider_status" text,
	"provider_updated_at" timestamp with time zone,
	"origin_tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"destination_tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_out_settled" text,
	"refunded_amount" text,
	"last_checked_at" timestamp with time zone,
	"last_successful_check_at" timestamp with time zone,
	"last_status_error" text,
	"error" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_hash" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"source_network" text NOT NULL,
	"destination_network" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"destination_asset_id" text NOT NULL,
	"provider_origin_asset" text NOT NULL,
	"provider_destination_asset" text NOT NULL,
	"amount_in" text NOT NULL,
	"amount_out" text,
	"min_amount_out" text,
	"amount_in_usd" text,
	"amount_out_usd" text,
	"slippage_bps" integer NOT NULL,
	"fees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deposit_address" text,
	"deposit_memo" text,
	"time_estimate_sec" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"provider_deadline" timestamp with time zone,
	"provider_correlation_id" text,
	"provider_signature" text,
	"provider_timestamp" text,
	"rejection_reason" text,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_execution_events" ADD CONSTRAINT "spak_execution_events_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD CONSTRAINT "spak_executions_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_quotes" ADD CONSTRAINT "spak_quotes_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spak_execution_events_exec_idx" ON "spak_execution_events" USING btree ("execution_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_executions_idem_uq" ON "spak_executions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_executions_plan_uq" ON "spak_executions" USING btree ("user_id","plan_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_executions_deposit_uq" ON "spak_executions" USING btree ("deposit_address");--> statement-breakpoint
CREATE INDEX "spak_executions_user_idx" ON "spak_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "spak_executions_fp_idx" ON "spak_executions" USING btree ("user_id","fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "spak_quotes_exec_idx" ON "spak_quotes" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "spak_quotes_user_idx" ON "spak_quotes" USING btree ("user_id");