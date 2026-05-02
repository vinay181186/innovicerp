CREATE TYPE "public"."grn_qc_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('draft', 'open', 'partial', 'qc_pending', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."po_type" AS ENUM('standard', 'job_work', 'outsource', 'service');--> statement-breakpoint
CREATE TYPE "public"."pr_status" AS ENUM('open', 'approved', 'po_created', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."store_txn_source_type" AS ENUM('grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other');--> statement-breakpoint
CREATE TYPE "public"."store_txn_type" AS ENUM('in', 'out', 'adjust');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_receipt_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goods_receipt_note_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"purchase_order_line_id" uuid,
	"item_id" uuid,
	"item_code_text" text,
	"item_name" text NOT NULL,
	"received_qty" integer NOT NULL,
	"dc_ref_no" text,
	"qc_status" "grn_qc_status" DEFAULT 'pending' NOT NULL,
	"qc_accepted_qty" integer DEFAULT 0 NOT NULL,
	"qc_rejected_qty" integer DEFAULT 0 NOT NULL,
	"qc_date" date,
	"qc_remarks" text,
	"qc_inspected_by" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goods_receipt_note_lines_received_qty_nonneg" CHECK ("goods_receipt_note_lines"."received_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_accepted_qty_nonneg" CHECK ("goods_receipt_note_lines"."qc_accepted_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_rejected_qty_nonneg" CHECK ("goods_receipt_note_lines"."qc_rejected_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_total_check" CHECK ("goods_receipt_note_lines"."qc_accepted_qty" + "goods_receipt_note_lines"."qc_rejected_qty" <= "goods_receipt_note_lines"."received_qty")
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_note_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_receipt_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"grn_date" date NOT NULL,
	"purchase_order_id" uuid,
	"po_code_text" text,
	"vendor_id" uuid,
	"vendor_code_text" text,
	"dc_no" text,
	"invoice_no" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"item_code_text" text,
	"item_name" text NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"source_so_line_id" uuid,
	"source_jc_op_id" uuid,
	"line_remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_order_lines_qty_positive" CHECK ("purchase_order_lines"."qty" > 0),
	CONSTRAINT "purchase_order_lines_received_qty_check" CHECK ("purchase_order_lines"."received_qty" >= 0 AND "purchase_order_lines"."received_qty" <= "purchase_order_lines"."qty" + ("purchase_order_lines"."qty" * 0.1)::int)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"po_date" date NOT NULL,
	"po_type" "po_type" DEFAULT 'standard' NOT NULL,
	"vendor_id" uuid,
	"vendor_code_text" text,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"due_date" date,
	"tax_type" text,
	"sgst_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"igst_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"pr_code_text" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_remarks" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"pr_date" date NOT NULL,
	"status" "pr_status" DEFAULT 'open' NOT NULL,
	"vendor_id" uuid,
	"vendor_code_text" text,
	"item_id" uuid,
	"item_code_text" text,
	"item_name" text,
	"qty" integer NOT NULL,
	"est_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"required_date" date,
	"source_jc_op_id" uuid,
	"source_so_line_id" uuid,
	"operation" text,
	"remarks" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"po_id" uuid,
	"po_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_requests_qty_positive" CHECK ("purchase_requests"."qty" > 0),
	CONSTRAINT "purchase_requests_vendor_check" CHECK (num_nonnulls("purchase_requests"."vendor_id", "purchase_requests"."vendor_code_text") >= 1),
	CONSTRAINT "purchase_requests_item_check" CHECK (num_nonnulls("purchase_requests"."item_id", "purchase_requests"."item_code_text") >= 1)
);
--> statement-breakpoint
ALTER TABLE "purchase_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"item_id" uuid,
	"item_code_text" text,
	"txn_type" "store_txn_type" NOT NULL,
	"qty" integer NOT NULL,
	"source_type" "store_txn_source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"stock_before" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "store_transactions_qty_positive" CHECK ("store_transactions"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "store_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jc_ops" ADD COLUMN "outsource_pr_id" uuid;--> statement-breakpoint
ALTER TABLE "jc_ops" ADD COLUMN "outsource_po_line_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_goods_receipt_note_id_goods_receipt_notes_id_fk" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "public"."goods_receipt_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_qc_inspected_by_users_id_fk" FOREIGN KEY ("qc_inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_source_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("source_so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_source_jc_op_id_jc_ops_id_fk" FOREIGN KEY ("source_jc_op_id") REFERENCES "public"."jc_ops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_source_jc_op_id_jc_ops_id_fk" FOREIGN KEY ("source_jc_op_id") REFERENCES "public"."jc_ops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_source_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("source_so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goods_receipt_note_lines_grn_line_uniq" ON "goods_receipt_note_lines" USING btree ("goods_receipt_note_id","line_no") WHERE "goods_receipt_note_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_note_lines_po_line_idx" ON "goods_receipt_note_lines" USING btree ("purchase_order_line_id") WHERE "goods_receipt_note_lines"."purchase_order_line_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_note_lines_item_idx" ON "goods_receipt_note_lines" USING btree ("item_id") WHERE "goods_receipt_note_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_note_lines_qc_status_idx" ON "goods_receipt_note_lines" USING btree ("company_id","qc_status") WHERE "goods_receipt_note_lines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goods_receipt_notes_company_code_uniq" ON "goods_receipt_notes" USING btree ("company_id","code") WHERE "goods_receipt_notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_company_po_idx" ON "goods_receipt_notes" USING btree ("company_id","purchase_order_id") WHERE "goods_receipt_notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_company_vendor_idx" ON "goods_receipt_notes" USING btree ("company_id","vendor_id") WHERE "goods_receipt_notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_company_date_idx" ON "goods_receipt_notes" USING btree ("company_id","grn_date") WHERE "goods_receipt_notes"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_po_line_uniq" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no") WHERE "purchase_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_item_idx" ON "purchase_order_lines" USING btree ("item_id") WHERE "purchase_order_lines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_so_line_idx" ON "purchase_order_lines" USING btree ("source_so_line_id") WHERE "purchase_order_lines"."source_so_line_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_jc_op_idx" ON "purchase_order_lines" USING btree ("source_jc_op_id") WHERE "purchase_order_lines"."source_jc_op_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_company_code_uniq" ON "purchase_orders" USING btree ("company_id","code") WHERE "purchase_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_company_vendor_idx" ON "purchase_orders" USING btree ("company_id","vendor_id") WHERE "purchase_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_company_status_idx" ON "purchase_orders" USING btree ("company_id","status") WHERE "purchase_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_company_date_idx" ON "purchase_orders" USING btree ("company_id","po_date") WHERE "purchase_orders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_company_code_uniq" ON "purchase_requests" USING btree ("company_id","code") WHERE "purchase_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_requests_company_status_idx" ON "purchase_requests" USING btree ("company_id","status") WHERE "purchase_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_requests_company_vendor_idx" ON "purchase_requests" USING btree ("company_id","vendor_id") WHERE "purchase_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_requests_source_jc_op_idx" ON "purchase_requests" USING btree ("source_jc_op_id") WHERE "purchase_requests"."source_jc_op_id" is not null AND "purchase_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_transactions_company_item_date_idx" ON "store_transactions" USING btree ("company_id","item_id","txn_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_transactions_company_source_idx" ON "store_transactions" USING btree ("company_id","source_type","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_transactions_company_date_idx" ON "store_transactions" USING btree ("company_id","txn_date");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_outsource_pr_id_purchase_requests_id_fk" FOREIGN KEY ("outsource_pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_outsource_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("outsource_po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jc_ops_outsource_pr_id_idx" ON "jc_ops" USING btree ("outsource_pr_id") WHERE "jc_ops"."outsource_pr_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jc_ops_outsource_po_line_id_idx" ON "jc_ops" USING btree ("outsource_po_line_id") WHERE "jc_ops"."outsource_po_line_id" is not null;--> statement-breakpoint
CREATE POLICY "goods_receipt_note_lines_company_read" ON "goods_receipt_note_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "goods_receipt_note_lines_manager_write" ON "goods_receipt_note_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "goods_receipt_note_lines_qc_update" ON "goods_receipt_note_lines" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (current_user_role() = 'qc' AND company_id = current_company_id()) WITH CHECK (current_user_role() = 'qc' AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "goods_receipt_notes_company_read" ON "goods_receipt_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "goods_receipt_notes_manager_write" ON "goods_receipt_notes" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_order_lines_company_read" ON "purchase_order_lines" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_order_lines_manager_write" ON "purchase_order_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_orders_company_read" ON "purchase_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_orders_manager_write" ON "purchase_orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_requests_company_read" ON "purchase_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "purchase_requests_manager_write" ON "purchase_requests" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "store_transactions_company_read" ON "store_transactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "store_transactions_manager_insert" ON "store_transactions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());