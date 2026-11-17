-- ADR-306: ONE SO number (owner 17-11-2026).
--
-- The SO No. (sales_orders.code) is the order's one number:
--   - an Internal SO No. typed on the form (digits, 433) gives SO-433;
--   - left blank, the order gets the next IN-SO-##### (series unchanged);
--   - the typed number can be changed later; the SO No. then changes and every
--     saved copy of it follows (trigger below). It can never be cleared.
--
-- This file:
--  1. sales_orders.legacy_code (NEW, text): every number the SO had before
--     ("IN-SO-00013" or "IN-SO-00013 SO-433"), space-separated. Search finds an
--     order by it and the numberer never gives one of them again. Never shown.
--  2. so_rewrite_text_copies(company, old, new): rewrites the saved TEXT copies
--     of an SO No. — every so_code / so_no / so_ref / doc_code / ref column in
--     the schema (information_schema, 17-11-2026). Exact value in:
--     plans.so_code_text, production_orders.so_code_text, invoices.so_code_text, customer_dispatches.so_code_text, qc_documents.so_code_text, nc_register.so_code_text, design_projects.so_code_text, design_tracker.so_code_text, file_registry.so_code_text, assembly_units.so_code_text, assembly_part_reservations.so_code_text, so_stock_reservations.so_code_text, delivery_challans.so_ref_text, service_pos.so_no_text, capa_records.so_no, document_edit_requests.doc_code, cancel_requests.doc_code, activity_log.ref_id.
--     Whole token (a line suffix may follow, "IN-SO-00012 ln 3") in:
--     tasks.linked_ref_display, item_revisions.source_ref, store_transactions.source_ref, stock_reservation_events.source_ref, engineering_change_impacts.label.
--     LEFT AS WRITTEN: activity_log.detail, reasons, remarks, task descriptions,
--     idempotency_keys (history and the user's own words); assembly unit
--     serials ("IN-SO-00013-U5": permanent identifiers printed on the unit);
--     item_revision_drawings (append-only history, 0248 refuses any change).
--     store_transactions.source_ref IS rewritten (so-link.ts joins on it) under
--     the ledger's own maintenance flag; no quantity moves.
--     SECURITY DEFINER (writes across company tables like the stock-balance
--     trigger, 0233); EXECUTE revoked from everyone — only the trigger calls it.
--  3. BEFORE UPDATE OF code trigger on sales_orders: when the code changes, the
--     old number is appended to legacy_code and the copies are rewritten, in
--     the SAME transaction as the change. One place for the rule: this
--     migration's rename and a user's edit both go through it.
--  4. One-time rename: every live SO with an Internal SO No. gets it as its SO
--     No. (IN-SO-00013 -> SO-433) and internal_so_no is cleared, so every
--     "IN-SO · SO" join on screen shows the one number. A deleted SO only when
--     no other SO uses the number (PROD: deleted IN-SO-00001 shares SO-519
--     with live IN-SO-00011 and keeps IN-SO-00001 — owner, 17-11-2026). An SO
--     with no Internal SO No. keeps IN-SO-##### (owner answer 1a).
--  5. Catch-up for an SO renamed by an earlier run of this file (TEST): its
--     copies are re-checked through legacy_code. Re-running is safe.
--
-- One transaction (apply-sql.ts); stops on any clash, nothing changed.
-- updated_at moves on every row touched (accepted, ADR-306).
--
-- ROLLBACK (before any SO is renamed by hand): for each SO with legacy_code,
--   UPDATE sales_orders SET internal_so_no = code, code = <first legacy token>;
--   (the trigger rewrites the copies back), then fix legacy_code, then
--   DROP TRIGGER sales_orders_code_change ON public.sales_orders;
--   DROP FUNCTION public.so_code_change(); DROP FUNCTION public.so_rewrite_text_copies(uuid,text,text);
--   ALTER TABLE public.sales_orders DROP COLUMN legacy_code;

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS legacy_code text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_orders_company_legacy_code_idx
  ON public.sales_orders (company_id, legacy_code) WHERE legacy_code IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.so_rewrite_text_copies(p_company uuid, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_re text;
  v_prev text;
BEGIN
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
    RETURN;
  END IF;
  -- Both numbers are built only from letters, digits and '-' (IN-SO-00013,
  -- SO-433); anything else is refused so it can never act as a regex.
  IF p_old !~ '^[A-Za-z0-9-]+$' OR p_new !~ '^[A-Za-z0-9-]+$' THEN
    RAISE EXCEPTION 'ADR-306: unexpected SO No. % -> %', p_old, p_new;
  END IF;
  -- Whole token, '-' counted as part of it: IN-SO-00001 never matches inside
  -- IN-SO-000011, and SO-00012 never inside IN-SO-00012. \1 keeps the char
  -- before the token.
  v_re := '(^|[^A-Za-z0-9-])' || p_old || '(?=[^A-Za-z0-9-]|$)';
  UPDATE public.plans SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.production_orders SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.invoices SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.customer_dispatches SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.qc_documents SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.nc_register SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.design_projects SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.design_tracker SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.file_registry SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.assembly_units SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.assembly_part_reservations SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.so_stock_reservations SET so_code_text = p_new WHERE company_id = p_company AND so_code_text = p_old;
  UPDATE public.delivery_challans SET so_ref_text = p_new WHERE company_id = p_company AND so_ref_text = p_old;
  UPDATE public.service_pos SET so_no_text = p_new WHERE company_id = p_company AND so_no_text = p_old;
  UPDATE public.capa_records SET so_no = p_new WHERE company_id = p_company AND so_no = p_old;
  UPDATE public.document_edit_requests SET doc_code = p_new WHERE company_id = p_company AND doc_code = p_old;
  UPDATE public.cancel_requests SET doc_code = p_new WHERE company_id = p_company AND doc_code = p_old;
  UPDATE public.activity_log SET ref_id = p_new WHERE company_id = p_company AND ref_id = p_old;
  UPDATE public.tasks SET linked_ref_display = regexp_replace(linked_ref_display, v_re, '\1' || p_new, 'g')
    WHERE company_id = p_company AND linked_ref_display ~ v_re;
  UPDATE public.item_revisions SET source_ref = regexp_replace(source_ref, v_re, '\1' || p_new, 'g')
    WHERE company_id = p_company AND source_ref ~ v_re;
  v_prev := current_setting('innovic.ledger_maintenance', true);
  PERFORM set_config('innovic.ledger_maintenance', 'on', true);
  UPDATE public.store_transactions SET source_ref = regexp_replace(source_ref, v_re, '\1' || p_new, 'g')
    WHERE company_id = p_company AND source_ref ~ v_re;
  PERFORM set_config('innovic.ledger_maintenance', COALESCE(v_prev, ''), true);
  UPDATE public.stock_reservation_events SET source_ref = regexp_replace(source_ref, v_re, '\1' || p_new, 'g')
    WHERE company_id = p_company AND source_ref ~ v_re;
  UPDATE public.engineering_change_impacts SET label = regexp_replace(label, v_re, '\1' || p_new, 'g')
    WHERE company_id = p_company AND label ~ v_re;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.so_rewrite_text_copies(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.so_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    IF OLD.code IS NOT NULL AND position(' ' || OLD.code || ' ' IN ' ' || COALESCE(NEW.legacy_code, '') || ' ') = 0 THEN
      NEW.legacy_code := btrim(concat_ws(' ', NULLIF(NEW.legacy_code, ''), OLD.code));
    END IF;
    PERFORM public.so_rewrite_text_copies(NEW.company_id, OLD.code, NEW.code);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.so_code_change() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sales_orders_code_change ON public.sales_orders;
--> statement-breakpoint
CREATE TRIGGER sales_orders_code_change
  BEFORE UPDATE OF code ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.so_code_change();
--> statement-breakpoint
CREATE TEMP TABLE so_renum ON COMMIT DROP AS
SELECT s.id, s.company_id, s.code AS old_code,
       regexp_replace(s.internal_so_no, '^SO-0+([0-9])', 'SO-\1') AS new_code
FROM public.sales_orders s
WHERE s.internal_so_no IS NOT NULL
  AND s.code IS DISTINCT FROM s.internal_so_no
  AND (
    s.deleted_at IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.sales_orders o
      WHERE o.company_id = s.company_id
        AND o.id <> s.id
        AND lower(o.internal_so_no) = lower(s.internal_so_no)
    )
  );
--> statement-breakpoint
DO $$
DECLARE clash text;
BEGIN
  -- A new number must not already be another SO's code (live or deleted).
  SELECT r.new_code INTO clash
  FROM so_renum r
  JOIN public.sales_orders o
    ON o.company_id = r.company_id AND o.id <> r.id AND lower(o.code) = lower(r.new_code)
  LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-306: % is already the SO No. of another order — nothing changed', clash;
  END IF;
  -- Two renamed SOs must not end up with the same number.
  SELECT lower(new_code) INTO clash
  FROM so_renum GROUP BY company_id, lower(new_code) HAVING count(*) > 1 LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-306: % would be given to two orders — nothing changed', clash;
  END IF;
  -- Only numbers the trigger accepts (letters, digits, '-').
  SELECT r.new_code INTO clash FROM so_renum r WHERE r.new_code !~ '^[A-Za-z0-9-]+$' LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-306: % is not a plain SO number — nothing changed', clash;
  END IF;
END $$;
--> statement-breakpoint
-- The trigger appends the old code to legacy_code and rewrites the copies.
UPDATE public.sales_orders s
SET code = r.new_code, internal_so_no = NULL
FROM so_renum r
WHERE s.id = r.id;
--> statement-breakpoint
-- Catch-up: an SO an earlier run of this file renamed (legacy_code set before
-- the trigger existed) gets any copy that run did not cover.
DO $$
DECLARE r record; tok text;
BEGIN
  FOR r IN SELECT company_id, code, legacy_code FROM public.sales_orders
           WHERE legacy_code IS NOT NULL LOOP
    FOREACH tok IN ARRAY regexp_split_to_array(btrim(r.legacy_code), '\s+') LOOP
      IF tok <> '' AND tok <> r.code THEN
        PERFORM public.so_rewrite_text_copies(r.company_id, tok, r.code);
      END IF;
    END LOOP;
  END LOOP;
END $$;
