CREATE TABLE "spak_admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"reviewer_id" text NOT NULL,
	"credential_ref" text NOT NULL,
	"action" text NOT NULL,
	"execution_id" text,
	"review_id" text,
	"reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "refund_id" text;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "association" text DEFAULT 'PENDING_ASSOCIATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "association_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "sender" text;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "tx_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spak_refund_txs" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "associated_amount" text;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "outstanding_amount" text;--> statement-breakpoint
ALTER TABLE "spak_refunds" ADD COLUMN "deposit_tx_timestamp" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "spak_admin_audit_review_idx" ON "spak_admin_audit" USING btree ("review_id","at");--> statement-breakpoint
CREATE INDEX "spak_admin_audit_reviewer_idx" ON "spak_admin_audit" USING btree ("reviewer_id","at");