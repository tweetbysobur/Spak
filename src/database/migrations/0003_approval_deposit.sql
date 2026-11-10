CREATE TABLE "spak_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"plan_hash" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "spak_deposit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deposit_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"approval_id" text NOT NULL,
	"family" text NOT NULL,
	"network" text NOT NULL,
	"kind" text NOT NULL,
	"asset_id" text NOT NULL,
	"token_contract" text,
	"deposit_address" text NOT NULL,
	"deposit_memo" text,
	"amount" text NOT NULL,
	"sender" text NOT NULL,
	"method" text NOT NULL,
	"state" text NOT NULL,
	"tx_hash" text,
	"confirmations" integer,
	"verification" jsonb,
	"provider_notified_at" timestamp with time zone,
	"provider_recognized_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD CONSTRAINT "spak_approvals_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD CONSTRAINT "spak_approvals_quote_id_spak_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."spak_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_deposit_events" ADD CONSTRAINT "spak_deposit_events_deposit_id_spak_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."spak_deposits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_deposits" ADD CONSTRAINT "spak_deposits_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_deposits" ADD CONSTRAINT "spak_deposits_quote_id_spak_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."spak_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_deposits" ADD CONSTRAINT "spak_deposits_approval_id_spak_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spak_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_approvals_active_uq" ON "spak_approvals" USING btree ("execution_id") WHERE invalidated_at is null;--> statement-breakpoint
CREATE INDEX "spak_approvals_quote_idx" ON "spak_approvals" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "spak_deposit_events_dep_idx" ON "spak_deposit_events" USING btree ("deposit_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_deposits_tx_uq" ON "spak_deposits" USING btree ("network","tx_hash");--> statement-breakpoint
CREATE INDEX "spak_deposits_exec_idx" ON "spak_deposits" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "spak_deposits_user_idx" ON "spak_deposits" USING btree ("user_id","created_at");