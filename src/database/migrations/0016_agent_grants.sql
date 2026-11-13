CREATE TABLE "spak_agent_grant_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_hash" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"owner_public_key" text NOT NULL,
	"domain" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"grant_expires_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "spak_agent_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_hash" text NOT NULL,
	"max_transaction_usd" text NOT NULL,
	"daily_limit_usd" text NOT NULL,
	"max_transactions" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"owner_account_id" text NOT NULL,
	"signer_public_key" text NOT NULL,
	"challenge_id" text NOT NULL,
	"message_sha256" text NOT NULL,
	"signature" text NOT NULL,
	"paused_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"end_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD COLUMN "approved_by" text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD COLUMN "grant_version" integer;--> statement-breakpoint
ALTER TABLE "spak_agent_grant_challenges" ADD CONSTRAINT "spak_agent_grant_challenges_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_grant_challenges" ADD CONSTRAINT "spak_agent_grant_challenges_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_grants" ADD CONSTRAINT "spak_agent_grants_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_grants" ADD CONSTRAINT "spak_agent_grants_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_grant_challenges_nonce_uq" ON "spak_agent_grant_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "spak_agent_grant_challenges_agent_idx" ON "spak_agent_grant_challenges" USING btree ("agent_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_grants_version_uq" ON "spak_agent_grants" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_grants_live_uq" ON "spak_agent_grants" USING btree ("agent_id") WHERE status in ('ACTIVE','PAUSED');--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_grants_challenge_uq" ON "spak_agent_grants" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "spak_approvals_grant_idx" ON "spak_approvals" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "spak_agent_grants" ADD CONSTRAINT "spak_agent_grants_ck" CHECK ("status" IN ('ACTIVE','PAUSED','REVOKED','SUPERSEDED') AND "version" >= 1 AND "row_version" >= 1 AND "max_transactions" BETWEEN 1 AND 20 AND "expires_at" > "valid_from" AND "max_transaction_usd" ~ '^[0-9]+(\.[0-9]+)?$' AND "daily_limit_usd" ~ '^[0-9]+(\.[0-9]+)?$' AND ("status" <> 'PAUSED' OR "paused_at" IS NOT NULL) AND ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "spak_approvals" ADD CONSTRAINT "spak_approvals_by_ck" CHECK (("approved_by" = 'USER' AND "grant_id" IS NULL AND "grant_version" IS NULL) OR ("approved_by" = 'AGENT_GRANT' AND "grant_id" IS NOT NULL AND "grant_version" IS NOT NULL));
