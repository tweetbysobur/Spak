ALTER TABLE "spak_refund_txs" ADD COLUMN "timing" text DEFAULT 'TIMING_UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "provider_listed_amount" text;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "evidence_capability" text;