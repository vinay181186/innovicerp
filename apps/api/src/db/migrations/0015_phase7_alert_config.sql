CREATE TABLE IF NOT EXISTS "alert_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_config" ADD CONSTRAINT "alert_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_config" ADD CONSTRAINT "alert_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_config" ADD CONSTRAINT "alert_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_config_company_code_uniq" ON "alert_config" USING btree ("company_id","code");--> statement-breakpoint
CREATE POLICY "alert_config_company_read" ON "alert_config" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "alert_config_manager_write" ON "alert_config" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());