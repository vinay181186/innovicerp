CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"gst_number" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"pincode" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"machine_type" text,
	"capacity_per_shift" integer,
	"shifts_per_day" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'Idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "machines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department" text,
	"skills" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "operators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"gst_number" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"pincode" text,
	"materials_supplied" text,
	"rating" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machines" ADD CONSTRAINT "machines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machines" ADD CONSTRAINT "machines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operators" ADD CONSTRAINT "operators_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operators" ADD CONSTRAINT "operators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operators" ADD CONSTRAINT "operators_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operators" ADD CONSTRAINT "operators_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_company_code_uniq" ON "clients" USING btree ("company_id","code") WHERE "clients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_company_id_idx" ON "clients" USING btree ("company_id") WHERE "clients"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "machines_company_code_uniq" ON "machines" USING btree ("company_id","code") WHERE "machines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_company_id_idx" ON "machines" USING btree ("company_id") WHERE "machines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_company_status_idx" ON "machines" USING btree ("company_id","status") WHERE "machines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operators_company_code_uniq" ON "operators" USING btree ("company_id","code") WHERE "operators"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operators_company_id_idx" ON "operators" USING btree ("company_id") WHERE "operators"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operators_user_id_idx" ON "operators" USING btree ("user_id") WHERE "operators"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_company_code_uniq" ON "vendors" USING btree ("company_id","code") WHERE "vendors"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_company_id_idx" ON "vendors" USING btree ("company_id") WHERE "vendors"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "clients_company_read" ON "clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "clients_manager_write" ON "clients" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "machines_company_read" ON "machines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "machines_manager_write" ON "machines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "operators_company_read" ON "operators" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "operators_manager_write" ON "operators" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "vendors_company_read" ON "vendors" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "vendors_manager_write" ON "vendors" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());