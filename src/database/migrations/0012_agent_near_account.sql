CREATE TABLE "spak_agent_account_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"owner_public_key" text NOT NULL,
	"domain" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spak_agent_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"account_id" text NOT NULL,
	"parent_account_id" text NOT NULL,
	"owner_public_key" text NOT NULL,
	"key_type" text NOT NULL,
	"status" text NOT NULL,
	"sponsorship" text NOT NULL,
	"funding_yocto" text,
	"creation_tx_hash" text,
	"creation_outcome" text,
	"creation_error" text,
	"idempotency_key" text NOT NULL,
	"created_on_chain_at" timestamp with time zone,
	"ownership_verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"recovery_reason" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_agent_account_challenges" ADD CONSTRAINT "spak_agent_account_challenges_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_account_challenges" ADD CONSTRAINT "spak_agent_account_challenges_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD CONSTRAINT "spak_agent_accounts_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD CONSTRAINT "spak_agent_accounts_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_account_challenges_nonce_uq" ON "spak_agent_account_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_accounts_idem_uq" ON "spak_agent_accounts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "spak_agent_accounts_user_idx" ON "spak_agent_accounts" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "spak_agent_accounts" ADD CONSTRAINT "spak_agent_accounts_ck" CHECK (
  "network" = 'testnet'
  AND "account_id" ~ '^[a-z0-9]+\.[a-z0-9._-]+\.testnet$'
  AND "parent_account_id" LIKE '%.testnet' AND right("account_id", length("parent_account_id") + 1) = '.' || "parent_account_id"
  AND "key_type" = 'ed25519' AND "owner_public_key" LIKE 'ed25519:%'
  AND "status" IN ('NOT_CREATED','CREATION_PENDING','CREATED','OWNERSHIP_VERIFICATION_PENDING','ACTIVE','SUSPENDED','RECOVERY_REQUIRED','REVOKED','CREATION_FAILED')
  AND "sponsorship" IN ('NOT_FUNDED','RESERVED','FUNDED','NOT_SPENT')
  AND ("creation_outcome" IS NULL OR "creation_outcome" IN ('SUCCESS','FAILURE','UNKNOWN'))
  AND ("status" <> 'ACTIVE' OR ("creation_tx_hash" IS NOT NULL AND "creation_outcome" = 'SUCCESS' AND "created_on_chain_at" IS NOT NULL AND "ownership_verified_at" IS NOT NULL AND "activated_at" IS NOT NULL AND "sponsorship" = 'FUNDED'))
  AND "version" >= 1 AND "schema_version" >= 1);--> statement-breakpoint
-- One live dedicated account per Agent; a failed attempt stays as history and a retry creates a new row.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agent_accounts_agent_live_uq" ON "spak_agent_accounts" ("agent_id") WHERE "status" <> 'CREATION_FAILED';--> statement-breakpoint
-- An account id belongs to one Agent per network, ever.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agent_accounts_account_uq" ON "spak_agent_accounts" ("network", "account_id") WHERE "status" <> 'CREATION_FAILED' OR "creation_outcome" IS DISTINCT FROM 'FAILURE';
