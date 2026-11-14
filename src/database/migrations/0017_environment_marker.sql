CREATE TABLE "spak_environment" (
	"id" integer PRIMARY KEY NOT NULL,
	"network_env" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_environment" ADD CONSTRAINT "spak_environment_ck" CHECK ("id" = 1 AND "network_env" IN ('mainnet','tidepool-testnet'));
