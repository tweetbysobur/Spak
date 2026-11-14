CREATE TABLE "spak_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"ref" text,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"delivery_error" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spak_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spak_alerts_open_uq" ON "spak_alerts" USING btree ("dedupe_key") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "spak_alerts_undelivered_idx" ON "spak_alerts" USING btree ("delivered_at","last_at");--> statement-breakpoint
CREATE INDEX "spak_rate_limits_updated_idx" ON "spak_rate_limits" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "spak_rate_limits" ADD CONSTRAINT "spak_rate_limits_ck" CHECK ("count" >= 0);--> statement-breakpoint
ALTER TABLE "spak_alerts" ADD CONSTRAINT "spak_alerts_ck" CHECK ("severity" IN ('CRITICAL','HIGH','MEDIUM') AND "count" >= 1 AND "delivery_attempts" >= 0);
