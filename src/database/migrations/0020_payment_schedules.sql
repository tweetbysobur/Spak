CREATE TABLE "spak_payment_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seq" integer NOT NULL,
	"due_date" text NOT NULL,
	"status" text NOT NULL,
	"execution_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"lease_until" timestamp with time zone,
	"prepared_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spak_payment_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"source_network" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"destination_network" text NOT NULL,
	"destination_asset_id" text NOT NULL,
	"amount" text NOT NULL,
	"recipient" text NOT NULL,
	"agent_id" text,
	"frequency" text NOT NULL,
	"interval_days" integer,
	"start_date" text NOT NULL,
	"end_date" text,
	"max_occurrences" integer,
	"timezone" text NOT NULL,
	"next_seq" integer DEFAULT 0 NOT NULL,
	"next_due_date" text,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spak_payment_occurrences" ADD CONSTRAINT "spak_payment_occurrences_schedule_id_spak_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."spak_payment_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_occurrences" ADD CONSTRAINT "spak_payment_occurrences_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_occurrences" ADD CONSTRAINT "spak_payment_occurrences_execution_id_spak_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."spak_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_schedules" ADD CONSTRAINT "spak_payment_schedules_user_id_spak_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spak_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spak_payment_schedules" ADD CONSTRAINT "spak_payment_schedules_agent_id_spak_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."spak_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spak_payment_occurrences_seq_uq" ON "spak_payment_occurrences" USING btree ("schedule_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "spak_payment_occurrences_execution_uq" ON "spak_payment_occurrences" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "spak_payment_occurrences_schedule_idx" ON "spak_payment_occurrences" USING btree ("schedule_id","seq");--> statement-breakpoint
CREATE INDEX "spak_payment_occurrences_preparing_idx" ON "spak_payment_occurrences" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "spak_payment_schedules_user_idx" ON "spak_payment_schedules" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "spak_payment_schedules_due_idx" ON "spak_payment_schedules" USING btree ("status","next_due_date");