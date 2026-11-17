CREATE TABLE "spak_payment_request_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"payer_user_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_token" text NOT NULL,
	"status" text NOT NULL,
	"destination_network" text NOT NULL,
	"destination_asset_id" text NOT NULL,
	"amount" text NOT NULL,
	"recipient" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_user_id" text,
	"claim_until" timestamp with time zone,
	"paid_execution_id" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_payment_request_attempts" ADD CONSTRAINT "spak_payment_request_attempts_request_id_spak_payment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."spak_payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_request_attempts" ADD CONSTRAINT "spak_payment_request_attempts_payer_user_id_spak_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_request_attempts" ADD CONSTRAINT "spak_payment_request_attempts_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_requests" ADD CONSTRAINT "spak_payment_requests_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_requests" ADD CONSTRAINT "spak_payment_requests_paid_execution_id_spak_executions_id_fk" FOREIGN KEY ("paid_execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_payment_request_attempts_execution_uq" ON "spak_payment_request_attempts" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "spak_payment_request_attempts_request_idx" ON "spak_payment_request_attempts" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_payment_requests_token_uq" ON "spak_payment_requests" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "spak_payment_requests_user_idx" ON "spak_payment_requests" USING btree ("user_id","created_at");