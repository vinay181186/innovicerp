-- Job-Work cycle completion (ADR-079): close the customer-material loop.
--   + job_work_order_lines.returned_qty / invoiced_qty (reconciliation counters)
--   + party_material_issues  (issue client material to a JC — debits party stock)
--   + jw_return_challans      (return processed goods to the customer)
--   + jw_invoices             (labour/processing invoice — rate x qty + GST)
-- Party (customer-owned) material stays OUT of store_transactions; issues move
-- party_materials.stock_qty/issued_qty only.

ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS returned_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.party_material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  issue_date date NOT NULL,
  job_work_order_id uuid REFERENCES public.job_work_orders(id) ON DELETE SET NULL,
  jw_code_text text,
  job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  jc_code_text text,
  party_material_id uuid NOT NULL REFERENCES public.party_materials(id),
  party_material_code_text text,
  party_material_name text,
  qty integer NOT NULL,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS party_material_issues_company_code_uniq
  ON public.party_material_issues (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_material_issues_company_jw_idx
  ON public.party_material_issues (company_id, job_work_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_material_issues_company_pm_idx
  ON public.party_material_issues (company_id, party_material_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.party_material_issues ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY party_material_issues_company_read ON public.party_material_issues
  FOR SELECT TO authenticated USING (company_id = current_company_id());
--> statement-breakpoint
CREATE POLICY party_material_issues_manager_write ON public.party_material_issues
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin','manager') AND company_id = current_company_id());
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.jw_return_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  return_date date NOT NULL,
  job_work_order_id uuid NOT NULL REFERENCES public.job_work_orders(id),
  job_work_order_line_id uuid NOT NULL REFERENCES public.job_work_order_lines(id),
  jw_code_text text,
  job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  qty integer NOT NULL,
  transport text,
  vehicle_no text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jw_return_challans_company_code_uniq
  ON public.jw_return_challans (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jw_return_challans_company_jw_idx
  ON public.jw_return_challans (company_id, job_work_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jw_return_challans_company_line_idx
  ON public.jw_return_challans (company_id, job_work_order_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY jw_return_challans_company_read ON public.jw_return_challans
  FOR SELECT TO authenticated USING (company_id = current_company_id());
--> statement-breakpoint
CREATE POLICY jw_return_challans_manager_write ON public.jw_return_challans
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin','manager') AND company_id = current_company_id());
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.jw_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  invoice_date date NOT NULL,
  job_work_order_id uuid NOT NULL REFERENCES public.job_work_orders(id),
  job_work_order_line_id uuid NOT NULL REFERENCES public.job_work_order_lines(id),
  jw_code_text text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  qty integer NOT NULL,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  gst_percent numeric(5,2) NOT NULL DEFAULT 18,
  gst_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jw_invoices_company_code_uniq
  ON public.jw_invoices (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jw_invoices_company_jw_idx
  ON public.jw_invoices (company_id, job_work_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY jw_invoices_company_read ON public.jw_invoices
  FOR SELECT TO authenticated USING (company_id = current_company_id());
--> statement-breakpoint
CREATE POLICY jw_invoices_manager_write ON public.jw_invoices
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin','manager') AND company_id = current_company_id());
