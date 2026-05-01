CREATE TYPE "public"."jc_priority" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."op_log_type" AS ENUM('start', 'complete', 'qc');--> statement-breakpoint
CREATE TYPE "public"."op_type" AS ENUM('process', 'qc', 'outsource');--> statement-breakpoint
CREATE TYPE "public"."outsource_status" AS ENUM('pending', 'pr_raised', 'po_created', 'sent', 'received');--> statement-breakpoint
CREATE TYPE "public"."running_op_status" AS ENUM('running', 'done', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."shift" AS ENUM('day', 'night');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jc_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_card_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"machine_id" uuid,
	"machine_code_text" text,
	"operation" text NOT NULL,
	"op_type" "op_type" DEFAULT 'process' NOT NULL,
	"cycle_time_min" numeric(10, 2) DEFAULT '0' NOT NULL,
	"program" text,
	"tool_no" text,
	"tool_details" text,
	"qc_required" boolean DEFAULT false NOT NULL,
	"qc_call_date" date,
	"qc_attended_date" date,
	"rework_qty" integer DEFAULT 0 NOT NULL,
	"outsource_vendor_id" uuid,
	"outsource_vendor_text" text,
	"outsource_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"outsource_status" "outsource_status",
	"outsource_pr_no" text,
	"outsource_po_no" text,
	"outsource_dc_no" text,
	"outsource_sent_qty" integer DEFAULT 0 NOT NULL,
	"outsource_sent_date" date,
	"outsource_returned_qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jc_ops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"jc_date" date NOT NULL,
	"item_id" uuid NOT NULL,
	"order_qty" integer NOT NULL,
	"priority" "jc_priority" DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"drawing_file_path" text,
	"source_so_line_id" uuid,
	"source_jw_id" uuid,
	"source_legacy_ref" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_cards_order_qty_positive" CHECK ("job_cards"."order_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "job_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "op_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"jc_op_id" uuid NOT NULL,
	"log_no" text NOT NULL,
	"log_type" "op_log_type" NOT NULL,
	"log_date" date NOT NULL,
	"shift" "shift" NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"reject_qty" integer DEFAULT 0 NOT NULL,
	"operator_id" uuid,
	"operator_name" text,
	"start_time" time,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "op_log_qty_nonneg" CHECK ("op_log"."qty" >= 0),
	CONSTRAINT "op_log_reject_qty_nonneg" CHECK ("op_log"."reject_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "op_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_card_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"route_card_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"machine_id" uuid,
	"machine_code_text" text,
	"operation" text NOT NULL,
	"op_type" "op_type" DEFAULT 'process' NOT NULL,
	"cycle_time_min" numeric(10, 2) DEFAULT '0' NOT NULL,
	"program" text,
	"tool_no" text,
	"tool_details" text,
	"qc_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "route_card_ops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_card_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"route_card_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"notes" text,
	"ops_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_card_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "route_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "running_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"jc_op_id" uuid NOT NULL,
	"machine_id" uuid,
	"is_osp" boolean DEFAULT false NOT NULL,
	"operator_id" uuid,
	"operator_name" text,
	"start_date" date NOT NULL,
	"start_time" time NOT NULL,
	"shift" "shift" NOT NULL,
	"status" "running_op_status" DEFAULT 'running' NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "running_ops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_outsource_vendor_id_vendors_id_fk" FOREIGN KEY ("outsource_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jc_ops" ADD CONSTRAINT "jc_ops_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "op_log" ADD CONSTRAINT "op_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "op_log" ADD CONSTRAINT "op_log_jc_op_id_jc_ops_id_fk" FOREIGN KEY ("jc_op_id") REFERENCES "public"."jc_ops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "op_log" ADD CONSTRAINT "op_log_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "op_log" ADD CONSTRAINT "op_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_ops" ADD CONSTRAINT "route_card_ops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_ops" ADD CONSTRAINT "route_card_ops_route_card_id_route_cards_id_fk" FOREIGN KEY ("route_card_id") REFERENCES "public"."route_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_ops" ADD CONSTRAINT "route_card_ops_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_ops" ADD CONSTRAINT "route_card_ops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_ops" ADD CONSTRAINT "route_card_ops_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_revisions" ADD CONSTRAINT "route_card_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_revisions" ADD CONSTRAINT "route_card_revisions_route_card_id_route_cards_id_fk" FOREIGN KEY ("route_card_id") REFERENCES "public"."route_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_card_revisions" ADD CONSTRAINT "route_card_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_cards" ADD CONSTRAINT "route_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_cards" ADD CONSTRAINT "route_cards_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_cards" ADD CONSTRAINT "route_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_cards" ADD CONSTRAINT "route_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_jc_op_id_jc_ops_id_fk" FOREIGN KEY ("jc_op_id") REFERENCES "public"."jc_ops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "running_ops" ADD CONSTRAINT "running_ops_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jc_ops_card_seq_uniq" ON "jc_ops" USING btree ("job_card_id","op_seq") WHERE "jc_ops"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jc_ops_machine_idx" ON "jc_ops" USING btree ("machine_id") WHERE "jc_ops"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jc_ops_company_type_idx" ON "jc_ops" USING btree ("company_id","op_type") WHERE "jc_ops"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jc_ops_outsource_vendor_idx" ON "jc_ops" USING btree ("outsource_vendor_id") WHERE "jc_ops"."deleted_at" is null AND "jc_ops"."op_type" = 'outsource';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_cards_company_code_uniq" ON "job_cards" USING btree ("company_id","code") WHERE "job_cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_company_item_idx" ON "job_cards" USING btree ("company_id","item_id") WHERE "job_cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_company_due_idx" ON "job_cards" USING btree ("company_id","due_date") WHERE "job_cards"."deleted_at" is null AND "job_cards"."closed_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_company_date_idx" ON "job_cards" USING btree ("company_id","jc_date") WHERE "job_cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_log_company_op_date_idx" ON "op_log" USING btree ("company_id","jc_op_id","log_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_log_company_date_complete_idx" ON "op_log" USING btree ("company_id","log_date") WHERE "op_log"."log_type" = 'complete';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_log_operator_date_idx" ON "op_log" USING btree ("operator_id","log_date") WHERE "op_log"."operator_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_card_ops_card_seq_uniq" ON "route_card_ops" USING btree ("route_card_id","op_seq") WHERE "route_card_ops"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_card_ops_machine_idx" ON "route_card_ops" USING btree ("machine_id") WHERE "route_card_ops"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_card_revisions_card_rev_uniq" ON "route_card_revisions" USING btree ("route_card_id","revision_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_card_revisions_card_created_idx" ON "route_card_revisions" USING btree ("route_card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_cards_company_code_uniq" ON "route_cards" USING btree ("company_id","code") WHERE "route_cards"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_cards_company_item_uniq" ON "route_cards" USING btree ("company_id","item_id") WHERE "route_cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_cards_item_idx" ON "route_cards" USING btree ("item_id") WHERE "route_cards"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "running_ops_op_running_uniq" ON "running_ops" USING btree ("company_id","jc_op_id") WHERE "running_ops"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "running_ops_machine_running_uniq" ON "running_ops" USING btree ("machine_id") WHERE "running_ops"."status" = 'running' AND "running_ops"."is_osp" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "running_ops_company_status_date_idx" ON "running_ops" USING btree ("company_id","status","start_date");--> statement-breakpoint
CREATE POLICY "jc_ops_company_read" ON "jc_ops" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "jc_ops_manager_write" ON "jc_ops" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "job_cards_company_read" ON "job_cards" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "job_cards_manager_write" ON "job_cards" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "op_log_company_read" ON "op_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "op_log_operator_insert" ON "op_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() = 'operator' AND company_id = current_company_id() AND log_type IN ('start', 'complete'));--> statement-breakpoint
CREATE POLICY "op_log_qc_insert" ON "op_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() = 'qc' AND company_id = current_company_id() AND log_type = 'qc');--> statement-breakpoint
CREATE POLICY "op_log_manager_insert" ON "op_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_card_ops_company_read" ON "route_card_ops" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_card_ops_manager_write" ON "route_card_ops" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_card_revisions_company_read" ON "route_card_revisions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_card_revisions_manager_insert" ON "route_card_revisions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_cards_company_read" ON "route_cards" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "route_cards_manager_write" ON "route_cards" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "running_ops_company_read" ON "running_ops" AS PERMISSIVE FOR SELECT TO "authenticated" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "running_ops_operator_write" ON "running_ops" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() = 'operator' AND company_id = current_company_id() AND created_by = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid) WITH CHECK (current_user_role() = 'operator' AND company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "running_ops_manager_write" ON "running_ops" AS PERMISSIVE FOR ALL TO "authenticated" USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()) WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());