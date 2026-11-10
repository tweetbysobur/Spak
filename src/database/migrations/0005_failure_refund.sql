CREATE TABLE "spak_failure_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"code" text NOT NULL,
	"temporary" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_recovery_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_refund_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text NOT NULL,
	"source" text NOT NULL,
	"outcome" text NOT NULL,
	"recipient" text NOT NULL,
	"asset_id" text NOT NULL,
	"token_contract" text,
	"received_amount" text,
	"confirmations" integer,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_checked_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spak_refunds" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"network" text NOT NULL,
	"asset_id" text NOT NULL,
	"refund_to" text NOT NULL,
	"refund_type" text NOT NULL,
	"deposited_amount" text,
	"provider_refunded_amount" text,
	"provider_refund_reason" text,
	"verified_amount" text,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spak_review_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"author" text NOT NULL,
	"note" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "refund_verified_amount" text;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "refund_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "failure" jsonb;--> statement-breakpoint
ALTER TABLE "spak_failure_events" ADD CONSTRAINT "spak_failure_events_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_recovery_attempts" ADD CONSTRAINT "spak_recovery_attempts_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD CONSTRAINT "spak_refund_txs_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD CONSTRAINT "spak_refunds_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD CONSTRAINT "spak_refunds_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_review_notes" ADD CONSTRAINT "spak_review_notes_review_id_spak_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."spak_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_reviews" ADD CONSTRAINT "spak_reviews_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spak_failure_events_exec_idx" ON "spak_failure_events" USING btree ("execution_id","at");--> statement-breakpoint
CREATE INDEX "spak_recovery_attempts_exec_idx" ON "spak_recovery_attempts" USING btree ("execution_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_refund_txs_tx_uq" ON "spak_refund_txs" USING btree ("network","tx_hash");--> statement-breakpoint
CREATE INDEX "spak_refund_txs_exec_idx" ON "spak_refund_txs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "spak_refunds_state_idx" ON "spak_refunds" USING btree ("state");--> statement-breakpoint
CREATE INDEX "spak_review_notes_review_idx" ON "spak_review_notes" USING btree ("review_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_reviews_open_uq" ON "spak_reviews" USING btree ("execution_id") WHERE "spak_reviews"."status" <> 'RESOLVED';--> statement-breakpoint
CREATE INDEX "spak_reviews_status_idx" ON "spak_reviews" USING btree ("status","opened_at");