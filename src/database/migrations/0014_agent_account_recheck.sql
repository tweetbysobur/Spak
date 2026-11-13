ALTER TABLE "spak_agent_accounts" ADD COLUMN "last_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "last_check_result" text;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "last_check_reason" text;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "last_check_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD COLUMN "check_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD CONSTRAINT "spak_agent_accounts_check_ck" CHECK (("last_check_result" IS NULL OR "last_check_result" IN ('VERIFIED','RECOVERY_REQUIRED','INCONCLUSIVE')) AND "consecutive_failures" >= 0);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spak_agent_accounts_due_idx" ON "spak_agent_accounts" ("next_check_at") WHERE "status" = 'ACTIVE';
