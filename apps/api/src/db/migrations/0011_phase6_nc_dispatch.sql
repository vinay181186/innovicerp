CREATE TYPE "public"."dc_status" AS ENUM('issued', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."nc_disposition" AS ENUM('rework', 'scrap', 'use_as_is', 'return_to_vendor', 'make_fresh');--> statement-breakpoint
CREATE TYPE "public"."nc_reason_category" AS ENUM('dimensional', 'surface', 'material', 'process', 'operator_error', 'machine_fault', 'other');--> statement-breakpoint
CREATE TYPE "public"."nc_status" AS ENUM('pending', 'disposed', 'rework_done', 'closed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_challan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delivery_challan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"item_code_text" text NOT NULL,
	"item_name_text" text,
	"qty" numeric(12, 2) NOT NULL,
	"uom" "uom" NOT NULL,
	"material_text" text,
	"dc_remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "delivery_challan_lines_qty_positive" CHECK ("delivery_challan_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_challan_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"dc_date" date NOT NULL,
	"purchase_order_id" uuid,
	"po_code_text" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"vendor_code_text" text NOT NULL,
	"sales_order_line_id" uuid,
	"so_ref_text" text,
	"transport" text,
	"status" "dc_status" DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_challans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nc_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"nc_date" date NOT NULL,
	"job_card_id" uuid NOT NULL,
	"jc_op_id" uuid,
	"op_seq" integer,
	"operation_text" text,
	"qc_operation_text" text,
	"item_id" uuid NOT NULL,
	"item_code_text" text NOT NULL,
	"item_name_text" text,
	"so_code_text" text,
	"machine_code_text" text,
	"rejected_qty" numeric(12, 2) NOT NULL,
	"reason_category" "nc_reason_category" DEFAULT 'other' NOT NULL,
	"reason" text,
	"disposition" "nc_disposition",
	"disposition_date" date,
	"disposition_by_text" text,
	"disposition_remarks" text,
	"rework_jc_code_text" text,
	"rework_op_seq" integer,
	"rework_done_qty" numeric(12, 2),
	"scrap_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "nc_status" DEFAULT 'pending' NOT NULL,
	"reported_by_text" text,
	"time_logged" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "nc_register_rejected_qty_positive" CHECK ("nc_register"."rejected_qty" > 0),
	CONSTRAINT "nc_register_rework_done_qty_check" CHECK ("nc_register"."rework_done_qty" is null OR "nc_register"."rework_done_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "nc_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_delivery_challan_id_delivery_challans_id_fk" FOREIGN KEY ("delivery_challan_id") REFERENCES "public"."delivery_challans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_jc_op_id_jc_ops_id_fk" FOREIGN KEY ("jc_op_id") REFERENCES "public"."jc_ops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_challan_lines_dc_line_uniq" ON "delivery_challan_lines" USING btree ("delivery_challan_id","line_no") WHERE "delivery_challan_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challan_lines_item_idx" ON "delivery_challan_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_challans_company_code_uniq" ON "delivery_challans" USING btree ("company_id","code") WHERE "delivery_challans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challans_company_date_idx" ON "delivery_challans" USING btree ("company_id","dc_date") WHERE "delivery_challans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challans_company_po_idx" ON "delivery_challans" USING btree ("company_id","purchase_order_id") WHERE "delivery_challans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challans_company_status_idx" ON "delivery_challans" USING btree ("company_id","status") WHERE "delivery_challans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challans_so_line_idx" ON "delivery_challans" USING btree ("sales_order_line_id") WHERE "delivery_challans"."sales_order_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nc_register_company_code_uniq" ON "nc_register" USING btree ("company_id","code") WHERE "nc_register"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nc_register_company_status_idx" ON "nc_register" USING btree ("company_id","status") WHERE "nc_register"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nc_register_company_jc_idx" ON "nc_register" USING btree ("company_id","job_card_id") WHERE "nc_register"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nc_register_company_date_idx" ON "nc_register" USING btree ("company_id","nc_date") WHERE "nc_register"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nc_register_jc_op_idx" ON "nc_register" USING btree ("jc_op_id") WHERE "nc_register"."jc_op_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nc_register_item_idx" ON "nc_register" USING btree ("item_id");--> statement-breakpoint
CREATE POLICY "delivery_challan_lines_company_read" ON "delivery_challan_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "delivery_challan_lines_manager_write" ON "delivery_challan_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "delivery_challans_company_read" ON "delivery_challans" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "delivery_challans_manager_write" ON "delivery_challans" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "nc_register_company_read" ON "nc_register" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "nc_register_manager_write" ON "nc_register" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());