CREATE TABLE "spak_agent_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"method" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"recipient" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "spak_agent_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"owner_network" text,
	"owner_account_id" text,
	"owner_public_key" text,
	"verification_method" text,
	"verified_at" timestamp with time zone,
	"verification_expires_at" timestamp with time zone,
	"attestation_hash" text,
	"attestation" jsonb,
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_agent_challenges" ADD CONSTRAINT "spak_agent_challenges_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_challenges" ADD CONSTRAINT "spak_agent_challenges_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_events" ADD CONSTRAINT "spak_agent_events_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agents" ADD CONSTRAINT "spak_agents_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_agent_challenges_nonce_uq" ON "spak_agent_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "spak_agent_challenges_agent_idx" ON "spak_agent_challenges" USING btree ("agent_id","issued_at");--> statement-breakpoint
CREATE INDEX "spak_agent_events_agent_idx" ON "spak_agent_events" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "spak_agents_user_idx" ON "spak_agents" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "spak_agents" ADD CONSTRAINT "spak_agents_status_ck" CHECK ("status" IN ('CREATED','PENDING_VERIFICATION','VERIFIED','SUSPENDED','REVOKED') AND "schema_version" >= 1 AND "version" >= 1);--> statement-breakpoint
ALTER TABLE "spak_agents" ADD CONSTRAINT "spak_agents_verified_ck" CHECK ("status" <> 'VERIFIED' OR ("owner_account_id" IS NOT NULL AND "owner_public_key" IS NOT NULL AND "verified_at" IS NOT NULL AND "verification_method" IS NOT NULL AND "attestation_hash" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "spak_agents" ADD CONSTRAINT "spak_agents_revoked_ck" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "spak_agent_challenges" ADD CONSTRAINT "spak_agent_challenges_ck" CHECK ("purpose" = 'AGENT_OWNERSHIP' AND "method" = 'NEAR_NEP413_FULL_ACCESS_KEY' AND ("outcome" IS NULL OR "outcome" IN ('VERIFIED','FAILED')));--> statement-breakpoint
-- One live (not revoked) Agent per user for now. A revoked Agent stays as history and a new one can be created.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agents_user_live_uq" ON "spak_agents" ("user_id") WHERE "status" <> 'REVOKED';--> statement-breakpoint
-- A NEAR owner account can own at most one live Agent across all users.
CREATE UNIQUE INDEX IF NOT EXISTS "spak_agents_owner_live_uq" ON "spak_agents" ("owner_account_id") WHERE "status" <> 'REVOKED' AND "owner_account_id" IS NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION spak_agent_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'spak_agent_events is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS spak_agent_events_no_update ON "spak_agent_events";--> statement-breakpoint
CREATE TRIGGER spak_agent_events_no_update BEFORE UPDATE ON "spak_agent_events" FOR EACH ROW EXECUTE FUNCTION spak_agent_events_immutable();
