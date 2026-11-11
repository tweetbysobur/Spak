ALTER TABLE "spak_refunds" ADD COLUMN "completion_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "watch_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "reconciliation" text;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "reconciliation_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "quoted_refund_fee" text;