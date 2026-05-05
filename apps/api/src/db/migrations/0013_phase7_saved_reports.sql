CREATE TABLE IF NOT EXISTS "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source_key" text NOT NULL,
	"spec" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_reports_company_owner_name_uniq" ON "saved_reports" USING btree ("company_id","owner_id","name") WHERE "saved_reports"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_reports_company_shared_idx" ON "saved_reports" USING btree ("company_id","is_shared") WHERE "saved_reports"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_reports_owner_idx" ON "saved_reports" USING btree ("owner_id") WHERE "saved_reports"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "saved_reports_company_read" ON "saved_reports" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "saved_reports_company_write" ON "saved_reports" AS PERMISSIVE FOR ALL TO "authenticated" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());