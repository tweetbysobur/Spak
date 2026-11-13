CREATE TABLE "spak_agent_funding_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_row_id" text NOT NULL,
	"network" text NOT NULL,
	"account_id" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"balance_yocto" text,
	"locked_yocto" text,
	"storage_usage" integer,
	"spendable_yocto" text,
	"minimum_yocto" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_executions" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "spak_agent_funding_checks" ADD CONSTRAINT "spak_agent_funding_checks_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_funding_checks" ADD CONSTRAINT "spak_agent_funding_checks_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_agent_funding_checks" ADD CONSTRAINT "spak_agent_funding_checks_account_row_id_spak_agent_accounts_id_fk" FOREIGN KEY ("account_row_id") REFERENCES "public"."spak_agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spak_agent_funding_checks_agent_idx" ON "spak_agent_funding_checks" USING btree ("agent_id","checked_at");--> statement-breakpoint
ALTER TABLE "spak_executions" ADD CONSTRAINT "spak_executions_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spak_executions_agent_idx" ON "spak_executions" USING btree ("agent_id","created_at");--> statement-breakpoint
ALTER TABLE "spak_agent_funding_checks" ADD CONSTRAINT "spak_agent_funding_checks_result_ck" CHECK ("result" IN ('FUNDED','UNFUNDED','INCONCLUSIVE'));
