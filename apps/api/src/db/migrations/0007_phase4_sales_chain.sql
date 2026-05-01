CREATE TYPE "public"."so_status" AS ENUM('open', 'closed', 'dispatched', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."so_type" AS ENUM('component_manufacturing', 'equipment', 'with_material');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_work_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_work_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"item_code_text" text,
	"part_name" text NOT NULL,
	"material" text,
	"drawing_no" text,
	"uom" "uom" DEFAULT 'NOS' NOT NULL,
	"order_qty" integer NOT NULL,
	"due_date" date,
	"client_material" text,
	"client_material_qty" numeric(12, 2),
	"material_received_date" date,
	"material_received_qty" numeric(12, 2),
	"status" "so_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_work_order_lines_order_qty_positive" CHECK ("job_work_order_lines"."order_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "job_work_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"jw_date" date NOT NULL,
	"client_id" uuid,
	"customer_name" text,
	"client_po_no" text,
	"status" "so_status" DEFAULT 'open' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "job_work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"item_code_text" text,
	"part_name" text NOT NULL,
	"material" text,
	"drawing_no" text,
	"uom" "uom" DEFAULT 'NOS' NOT NULL,
	"order_qty" integer NOT NULL,
	"rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"client_po_line_no" text,
	"status" "so_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sales_order_lines_order_qty_positive" CHECK ("sales_order_lines"."order_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"so_date" date NOT NULL,
	"client_id" uuid,
	"customer_name" text,
	"client_po_no" text,
	"type" "so_type" NOT NULL,
	"status" "so_status" DEFAULT 'open' NOT NULL,
	"gst_percent" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"bom_master_id" text,
	"bom_status" text,
	"cost_center" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_job_work_order_id_job_work_orders_id_fk" FOREIGN KEY ("job_work_order_id") REFERENCES "public"."job_work_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_work_order_lines_jw_line_uniq" ON "job_work_order_lines" USING btree ("job_work_order_id","line_no") WHERE "job_work_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_order_lines_item_idx" ON "job_work_order_lines" USING btree ("item_id") WHERE "job_work_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_work_orders_company_code_uniq" ON "job_work_orders" USING btree ("company_id","code") WHERE "job_work_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_orders_company_client_idx" ON "job_work_orders" USING btree ("company_id","client_id") WHERE "job_work_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_orders_company_status_idx" ON "job_work_orders" USING btree ("company_id","status") WHERE "job_work_orders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_order_lines_so_line_uniq" ON "sales_order_lines" USING btree ("sales_order_id","line_no") WHERE "sales_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_lines_item_idx" ON "sales_order_lines" USING btree ("item_id") WHERE "sales_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_lines_company_status_idx" ON "sales_order_lines" USING btree ("company_id","status") WHERE "sales_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_company_code_uniq" ON "sales_orders" USING btree ("company_id","code") WHERE "sales_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_company_client_idx" ON "sales_orders" USING btree ("company_id","client_id") WHERE "sales_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_company_status_idx" ON "sales_orders" USING btree ("company_id","status") WHERE "sales_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_company_date_idx" ON "sales_orders" USING btree ("company_id","so_date") WHERE "sales_orders"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "job_work_order_lines_company_read" ON "job_work_order_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "job_work_order_lines_manager_write" ON "job_work_order_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "job_work_orders_company_read" ON "job_work_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "job_work_orders_manager_write" ON "job_work_orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "sales_order_lines_company_read" ON "sales_order_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "sales_order_lines_manager_write" ON "sales_order_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "sales_orders_company_read" ON "sales_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "sales_orders_manager_write" ON "sales_orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());