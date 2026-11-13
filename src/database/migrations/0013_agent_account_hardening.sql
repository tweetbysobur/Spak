CREATE TABLE "spak_agent_account_rotations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_row_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"old_public_key" text NOT NULL,
	"new_public_key" text NOT NULL,
	"status" text NOT NULL,
	"domain" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"tx_hash" text,
	"evidence" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "consent_challenge_id" text;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "verification_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "spak_agent_account_rotations" ADD CONSTRAINT "spak_agent_account_rotations_account_row_id_spak_agent_accounts_id_fk" FOREIGN KEY ("account_row_id") REFERENCES "public"."spak_agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_account_rotations" ADD CONSTRAINT "spak_agent_account_rotations_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_account_rotations" ADD CONSTRAINT "spak_agent_account_rotations_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_account_rotations_nonce_uq" ON "spak_agent_account_rotations" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "spak_agent_account_rotations_acct_idx" ON "spak_agent_account_rotations" USING btree ("account_row_id","created_at");--> statement-breakpoint
ALTER TABLE "spak_agent_account_rotations" ADD CONSTRAINT "spak_agent_account_rotations_ck" CHECK ("status" IN ('CHALLENGED','AUTHORIZED','COMPLETED','FAILED','EXPIRED') AND "old_public_key" <> "new_public_key" AND "new_public_key" LIKE 'ed25519:%');--> statement-breakpoint
-- At most one open rotation per dedicated account.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agent_account_rotations_open_uq" ON "spak_agent_account_rotations" ("account_row_id") WHERE "status" IN ('CHALLENGED','AUTHORIZED');--> statement-breakpoint
-- ACTIVE now also needs the consent binding and the evidence that justified it. NOT VALID: applies to new writes.
ALTER TABLE "spak_agent_accounts" ADD CONSTRAINT "spak_agent_accounts_active_evidence_ck" CHECK ("status" <> 'ACTIVE' OR ("consent_challenge_id" IS NOT NULL AND "verification_evidence" IS NOT NULL)) NOT VALID;
