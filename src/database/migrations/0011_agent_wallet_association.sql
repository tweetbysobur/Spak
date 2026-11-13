CREATE TABLE "spak_agent_wallet_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"association_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"family" text NOT NULL,
	"method" text NOT NULL,
	"address" text NOT NULL,
	"chain_id" text,
	"domain" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "spak_agent_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text,
	"family" text NOT NULL,
	"network" text NOT NULL,
	"chain_id" text,
	"address" text NOT NULL,
	"public_key" text,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_agent_wallet_challenges" ADD CONSTRAINT "spak_agent_wallet_challenges_association_id_spak_agent_wallets_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."spak_agent_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_wallet_challenges" ADD CONSTRAINT "spak_agent_wallet_challenges_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_wallet_challenges" ADD CONSTRAINT "spak_agent_wallet_challenges_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_wallets" ADD CONSTRAINT "spak_agent_wallets_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_wallets" ADD CONSTRAINT "spak_agent_wallets_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_wallets" ADD CONSTRAINT "spak_agent_wallets_wallet_id_spak_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."spak_wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_wallet_challenges_nonce_uq" ON "spak_agent_wallet_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "spak_agent_wallet_challenges_assoc_idx" ON "spak_agent_wallet_challenges" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX "spak_agent_wallets_agent_idx" ON "spak_agent_wallets" USING btree ("agent_id","status");--> statement-breakpoint
ALTER TABLE "spak_agent_wallets" ADD CONSTRAINT "spak_agent_wallets_ck" CHECK (
  "family" IN ('evm','solana','near')
  AND "status" IN ('PENDING','ACTIVE','SUSPENDED','EXPIRED','REVOKED')
  AND "method" IN ('EIP4361_PERSONAL_SIGN','SIWS_ED25519','NEAR_NEP413_FULL_ACCESS_KEY')
  AND (("family" = 'evm') = ("method" = 'EIP4361_PERSONAL_SIGN'))
  AND (("family" = 'solana') = ("method" = 'SIWS_ED25519'))
  AND (("family" = 'evm') = ("chain_id" IS NOT NULL))
  AND ("status" NOT IN ('ACTIVE','EXPIRED') OR ("verified_at" IS NOT NULL AND "expires_at" IS NOT NULL))
  AND (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL))
  AND "version" >= 1);--> statement-breakpoint
ALTER TABLE "spak_agent_wallet_challenges" ADD CONSTRAINT "spak_agent_wallet_challenges_ck" CHECK ("family" IN ('evm','solana','near') AND ("outcome" IS NULL OR "outcome" IN ('VERIFIED','FAILED')));--> statement-breakpoint
-- A wallet (family + canonical address) can have only one live association across all Agents and users.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agent_wallets_live_uq" ON "spak_agent_wallets" ("family", "address") WHERE "status" <> 'REVOKED';
