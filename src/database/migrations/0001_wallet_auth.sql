CREATE TABLE "spak_agent_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"near_account_id" text,
	"wallet_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "spak_users" (
	"id" text PRIMARY KEY NOT NULL,
	"active_wallet_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_wallet_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"purpose" text NOT NULL,
	"family" text NOT NULL,
	"address" text NOT NULL,
	"user_id" text,
	"message" text NOT NULL,
	"domain" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spak_wallet_networks" (
	"wallet_id" text NOT NULL,
	"network_id" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family" text NOT NULL,
	"address" text NOT NULL,
	"public_key" text,
	"label" text,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_agent_identities" ADD CONSTRAINT "spak_agent_identities_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_identities" ADD CONSTRAINT "spak_agent_identities_wallet_id_spak_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."spak_wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_auth_sessions" ADD CONSTRAINT "spak_auth_sessions_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_wallet_networks" ADD CONSTRAINT "spak_wallet_networks_wallet_id_spak_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."spak_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_wallets" ADD CONSTRAINT "spak_wallets_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_identities_user_uq" ON "spak_agent_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_identities_near_uq" ON "spak_agent_identities" USING btree ("near_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_auth_sessions_token_uq" ON "spak_auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "spak_auth_sessions_user_idx" ON "spak_auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_wallet_challenges_nonce_uq" ON "spak_wallet_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "spak_wallet_challenges_exp_idx" ON "spak_wallet_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_wallet_networks_pk" ON "spak_wallet_networks" USING btree ("wallet_id","network_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_wallets_addr_uq" ON "spak_wallets" USING btree ("family","address");--> statement-breakpoint
CREATE INDEX "spak_wallets_user_idx" ON "spak_wallets" USING btree ("user_id");