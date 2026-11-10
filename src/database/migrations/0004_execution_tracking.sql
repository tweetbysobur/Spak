CREATE TABLE "spak_destination_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text NOT NULL,
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
CREATE TABLE "spak_monitor_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"from_state" text NOT NULL,
	"to_state" text,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "spak_monitor_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"claimed" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "amount_out_verified" text;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "destination_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "monitor_lease_owner" text;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "monitor_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "monitor_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "monitor_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "monitor_gave_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_destination_verifications" ADD CONSTRAINT "spak_destination_verifications_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_monitor_attempts" ADD CONSTRAINT "spak_monitor_attempts_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_dest_verif_tx_uq" ON "spak_destination_verifications" USING btree ("network","tx_hash");--> statement-breakpoint
CREATE INDEX "spak_dest_verif_exec_idx" ON "spak_destination_verifications" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "spak_monitor_attempts_exec_idx" ON "spak_monitor_attempts" USING btree ("execution_id","started_at");--> statement-breakpoint
CREATE INDEX "spak_monitor_runs_started_idx" ON "spak_monitor_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "spak_executions_monitor_idx" ON "spak_executions" USING btree ("state","monitor_next_at");