-- ============================================================
-- 0159_instruments_tool_issue.sql  (ADR-193 phase 4)
--
-- Instrument / tool register and the Tool Issue rewrite (spec §14).
--   store_txn_source_type  += tool_writeoff (Scrap of an in-store instrument,
--                             on an approved write-off — the only write-off
--                             that moves stock)
--   items                  += track_serial (Tool / Instrument items only: one
--                             register row per piece)
--   instruments            NEW — one row per serial piece: status, calibration
--   instrument_calibrations NEW — calibration history (pass / fail)
--   tool_issues            qty → numeric; += operator, job card, cancel columns;
--                             return_* running totals DROPPED (derived from the
--                             return rows now); return_status += 'cancelled';
--                             item_name nullable
--   tool_issue_instruments NEW — which instruments went out on an issue, and
--                             how each came back
--   tool_issue_returns     qty columns → numeric; += lost_qty, reason;
--                             returned_by DROPPED
--   tool_writeoffs         NEW — Damaged / Lost / Scrap awaiting the Store
--                             In-charge's decision
--
-- tool_issues and tool_issue_returns had 0 rows on TEST and PROD (checked
-- 2026-09-28), so the dropped columns carry no data.
-- Idempotent. Apply to BOTH the test and the production database.
-- The ALTER TYPE runs first, OUTSIDE the transaction (Postgres refuses to use
-- a new enum value inside the transaction that added it).
--
-- Rollback (in this order):
--   DROP TABLE public.tool_writeoffs;
--   DROP TABLE public.tool_issue_instruments;
--   DROP TABLE public.instrument_calibrations;
--   DROP TABLE public.instruments;
--   ALTER TABLE public.tool_issue_returns DROP COLUMN lost_qty, DROP COLUMN reason,
--     ADD COLUMN returned_by text; (qty columns may stay numeric)
--   ALTER TABLE public.tool_issues DROP COLUMN issued_to_operator_id,
--     DROP COLUMN job_card_id, DROP COLUMN cancelled_at, DROP COLUMN cancelled_by,
--     DROP COLUMN cancel_reason, then re-add return_good_qty / return_damaged_qty /
--     return_consumed_qty integer NOT NULL DEFAULT 0 (see 0029);
--   ALTER TABLE public.items DROP COLUMN track_serial;
--   (Enum values cannot be removed; 'tool_writeoff' is harmless when unused.)
-- ============================================================

ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'tool_writeoff';
--> statement-breakpoint

BEGIN;
--> statement-breakpoint

-- ─── items.track_serial ──────────────────────────────────────────────────
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS track_serial boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ─── instruments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  serial_no text NOT NULL,
  status text NOT NULL DEFAULT 'in_store'
    CHECK (status IN ('in_store', 'issued', 'at_calibration', 'lost', 'scrapped')),
  calibration_interval_days integer CHECK (calibration_interval_days > 0),
  last_calibrated_on date,
  calibration_due_on date,
  location text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  CONSTRAINT instruments_serial_not_blank CHECK (length(btrim(serial_no)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS instruments_item_serial_uniq
  ON public.instruments (company_id, item_id, lower(serial_no)) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS instruments_item_idx
  ON public.instruments (item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS instruments_company_due_idx
  ON public.instruments (company_id, calibration_due_on)
  WHERE deleted_at IS NULL AND status NOT IN ('lost', 'scrapped');
--> statement-breakpoint

-- ─── instrument_calibrations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.instrument_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  instrument_id uuid NOT NULL REFERENCES public.instruments(id),
  calibrated_on date NOT NULL,
  result text NOT NULL CHECK (result IN ('pass', 'fail')),
  certificate_no text,
  agency text,
  next_due_on date,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS instrument_calibrations_instrument_idx
  ON public.instrument_calibrations (instrument_id, calibrated_on) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ─── tool_issues (0 rows — reshaped) ─────────────────────────────────────
ALTER TABLE public.tool_issues DROP CONSTRAINT IF EXISTS tool_issues_return_qtys_within_issue;
--> statement-breakpoint
ALTER TABLE public.tool_issues DROP CONSTRAINT IF EXISTS tool_issues_return_qtys_nonneg;
--> statement-breakpoint
ALTER TABLE public.tool_issues
  DROP COLUMN IF EXISTS return_good_qty,
  DROP COLUMN IF EXISTS return_damaged_qty,
  DROP COLUMN IF EXISTS return_consumed_qty;
--> statement-breakpoint
ALTER TABLE public.tool_issues ALTER COLUMN qty TYPE numeric(14,3);
--> statement-breakpoint
ALTER TABLE public.tool_issues ALTER COLUMN item_name DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.tool_issues
  ADD COLUMN IF NOT EXISTS issued_to_operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
--> statement-breakpoint
ALTER TABLE public.tool_issues DROP CONSTRAINT IF EXISTS tool_issues_return_status_valid;
--> statement-breakpoint
ALTER TABLE public.tool_issues ADD CONSTRAINT tool_issues_return_status_valid
  CHECK (return_status IN ('issued', 'partial', 'returned', 'cancelled'));
--> statement-breakpoint

-- ─── tool_issue_instruments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tool_issue_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tool_issue_id uuid NOT NULL REFERENCES public.tool_issues(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES public.instruments(id),
  returned_on date,
  return_condition text CHECK (return_condition IN ('good', 'damaged', 'lost')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tool_issue_instruments_issue_instrument_uniq
  ON public.tool_issue_instruments (tool_issue_id, instrument_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_issue_instruments_instrument_idx
  ON public.tool_issue_instruments (instrument_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ─── tool_issue_returns (0 rows — reshaped) ──────────────────────────────
ALTER TABLE public.tool_issue_returns DROP CONSTRAINT IF EXISTS tool_issue_returns_qtys_nonneg;
--> statement-breakpoint
ALTER TABLE public.tool_issue_returns DROP CONSTRAINT IF EXISTS tool_issue_returns_any_qty;
--> statement-breakpoint
ALTER TABLE public.tool_issue_returns
  ALTER COLUMN good_qty TYPE numeric(14,3),
  ALTER COLUMN damaged_qty TYPE numeric(14,3),
  ALTER COLUMN consumed_qty TYPE numeric(14,3);
--> statement-breakpoint
ALTER TABLE public.tool_issue_returns
  ADD COLUMN IF NOT EXISTS lost_qty numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason text,
  DROP COLUMN IF EXISTS returned_by;
--> statement-breakpoint
ALTER TABLE public.tool_issue_returns ADD CONSTRAINT tool_issue_returns_qtys_nonneg
  CHECK (good_qty >= 0 AND damaged_qty >= 0 AND lost_qty >= 0 AND consumed_qty >= 0);
--> statement-breakpoint
ALTER TABLE public.tool_issue_returns ADD CONSTRAINT tool_issue_returns_any_qty
  CHECK (good_qty + damaged_qty + lost_qty + consumed_qty > 0);
--> statement-breakpoint

-- ─── tool_writeoffs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tool_writeoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  instrument_id uuid REFERENCES public.instruments(id),
  tool_issue_id uuid REFERENCES public.tool_issues(id),
  tool_issue_return_id uuid REFERENCES public.tool_issue_returns(id),
  kind text NOT NULL CHECK (kind IN ('damaged', 'lost', 'scrap')),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_remarks text,
  store_transaction_id uuid REFERENCES public.store_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_writeoffs_pending_idx
  ON public.tool_writeoffs (company_id, status) WHERE deleted_at IS NULL AND status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_writeoffs_issue_idx
  ON public.tool_writeoffs (tool_issue_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_writeoffs_instrument_idx
  ON public.tool_writeoffs (instrument_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ─── RLS (same pattern as 0158) ──────────────────────────────────────────
ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.instrument_calibrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tool_issue_instruments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tool_writeoffs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY instruments_company_all ON public.instruments
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY instrument_calibrations_company_all ON public.instrument_calibrations
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tool_issue_instruments_company_all ON public.tool_issue_instruments
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tool_writeoffs_company_all ON public.tool_writeoffs
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

COMMIT;
