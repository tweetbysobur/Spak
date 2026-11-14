ALTER TABLE "spak_quotes" ADD COLUMN "valuation_usd" text;--> statement-breakpoint
ALTER TABLE "spak_quotes" ADD COLUMN "valuation" jsonb;--> statement-breakpoint
ALTER TABLE "spak_quotes" ADD CONSTRAINT "spak_quotes_valuation_usd_ck" CHECK ("valuation_usd" IS NULL OR "valuation_usd" ~ '^[0-9]+(\.[0-9]+)?$');
