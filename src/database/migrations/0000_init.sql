CREATE TABLE "spak_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"ref" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_intents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"revision" integer NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text,
	"input" text NOT NULL,
	"intent_type" text NOT NULL,
	"status" text NOT NULL,
	"plan_hash" text,
	"result" jsonb NOT NULL,
	"processing_ms" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"intent_id" text NOT NULL,
	"revision" integer NOT NULL,
	"draft" jsonb NOT NULL,
	"last_status" text NOT NULL,
	"submitted" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"idempotency_key" text,
	"provider" text,
	"state" text NOT NULL,
	"provider_ref" text,
	"deposit" jsonb,
	"quote" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spak_audit_ref_idx" ON "spak_audit_log" USING btree ("ref","at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_intents_rev_uq" ON "spak_intents" USING btree ("intent_id","revision");--> statement-breakpoint
CREATE INDEX "spak_intents_user_idx" ON "spak_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "spak_sessions_updated_idx" ON "spak_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_submissions_plan_uq" ON "spak_submissions" USING btree ("plan_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_submissions_idem_uq" ON "spak_submissions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "spak_submissions_fp_idx" ON "spak_submissions" USING btree ("user_id","fingerprint","created_at");