CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_ts_idx" ON "activity_log" USING btree ("company_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_action_idx" ON "activity_log" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_user_idx" ON "activity_log" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE POLICY "activity_log_company_read" ON "activity_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "activity_log_manager_insert" ON "activity_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());