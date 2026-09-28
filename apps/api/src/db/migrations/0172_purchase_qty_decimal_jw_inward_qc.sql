-- ============================================================
-- 0172_purchase_qty_decimal_jw_inward_qc.sql  (high-findings fix, package p2-purchase)
--
-- 1. Decimal quantities on the purchase chain (po-create#1). An order for
--    12.5 KGS of bar stock can now be typed on the PR, the PO, the GRN and the
--    JW DC — the store ledger already took 3 places (0153). Whole-number units
--    (NOS / SET) are still refused a fraction by the API, not here.
--      purchase_requests.qty                                 integer → numeric(14,3)
--      purchase_order_lines.qty / received_qty               integer → numeric(14,3)
--      goods_receipt_note_lines.received_qty /
--        qc_accepted_qty / qc_rejected_qty                   integer → numeric(14,3)
--      jw_dc_outward_lines.po_qty / sent_qty                 integer → numeric(14,3)
--      jw_dc_inward_lines.sent_qty / received_qty /
--        ok_qty / rejected_qty                               integer → numeric(14,3)
--    (delivery_challan_lines.qty is already numeric(12,2) and is not touched.)
--    Every view that reads one of these columns (and every view built on such a
--    view) is dropped and re-created from its own stored definition, grants and
--    options, inside the same DO block — so the change is all-or-nothing and no
--    view is ever left missing. Only runs while a column is still integer.
--
-- 2. purchase_order_lines_received_qty_check: the 10 % over-receipt allowance
--    was `qty + (qty * 0.1)::int` (rounds); now `qty * 1.1` (exact for decimals).
--
-- 3. JW DC Inward goes to Incoming QC (jw-dc-inward-create#1, ADR-189 — Incoming
--    QC is the only inspector). A JW DC receipt now raises a QC-pending GRN,
--    exactly like DC Receive; the store no longer types Accepted / Rejected.
--      jw_dc_inward.goods_receipt_note_id   NEW — the GRN raised for the receipt
--      jw_dc_inward_lines_split_total       ok + rejected = received  →  <= received
--                                           (new rows carry 0 / 0; QC decides on the GRN)
--
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback (only while every quantity is whole):
--   ALTER TABLE public.jw_dc_inward_lines DROP CONSTRAINT jw_dc_inward_lines_split_total;
--   ALTER TABLE public.jw_dc_inward_lines ADD CONSTRAINT jw_dc_inward_lines_split_total
--     CHECK (ok_qty + rejected_qty = received_qty);   -- fails once QC-routed rows exist
--   ALTER TABLE public.jw_dc_inward DROP COLUMN goods_receipt_note_id;
--   the columns in 1. back to integer (drop + re-create the dependent views the
--   same way this file does).
-- ============================================================

DO $$
DECLARE
  v_cols constant text[][] := ARRAY[
    ['purchase_requests', 'qty'],
    ['purchase_order_lines', 'qty'],
    ['purchase_order_lines', 'received_qty'],
    ['goods_receipt_note_lines', 'received_qty'],
    ['goods_receipt_note_lines', 'qc_accepted_qty'],
    ['goods_receipt_note_lines', 'qc_rejected_qty'],
    ['jw_dc_outward_lines', 'po_qty'],
    ['jw_dc_outward_lines', 'sent_qty'],
    ['jw_dc_inward_lines', 'sent_qty'],
    ['jw_dc_inward_lines', 'received_qty'],
    ['jw_dc_inward_lines', 'ok_qty'],
    ['jw_dc_inward_lines', 'rejected_qty']
  ];
  v_todo int;
  v_view record;
  v_acl record;
  i int;
BEGIN
  SELECT count(*) INTO v_todo
  FROM information_schema.columns c
  JOIN unnest(v_cols[:][1:1], v_cols[:][2:2]) AS t(tbl, col)
    ON c.table_name = t.tbl AND c.column_name = t.col
  WHERE c.table_schema = 'public' AND c.data_type = 'integer';

  IF v_todo = 0 THEN
    RAISE NOTICE '0172: quantities already numeric — nothing to widen.';
    RETURN;
  END IF;

  -- Every view reading one of the columns, then every view on top of those.
  CREATE TEMP TABLE _p2_views ON COMMIT DROP AS
  WITH RECURSIVE
  target AS (
    SELECT a.attrelid AS relid, a.attnum
    FROM unnest(v_cols[:][1:1], v_cols[:][2:2]) AS t(tbl, col)
    JOIN pg_attribute a
      ON a.attrelid = ('public.' || t.tbl)::regclass AND a.attname = t.col
  ),
  dep(oid, depth) AS (
    SELECT DISTINCT r.ev_class, 1
    FROM target tg
    JOIN pg_depend d
      ON d.refclassid = 'pg_class'::regclass
     AND d.refobjid = tg.relid AND d.refobjsubid = tg.attnum
     AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite r ON r.oid = d.objid
    WHERE r.ev_class <> tg.relid
    UNION ALL
    SELECT r.ev_class, dep.depth + 1
    FROM dep
    JOIN pg_depend d
      ON d.refclassid = 'pg_class'::regclass AND d.refobjid = dep.oid
     AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite r ON r.oid = d.objid
    WHERE r.ev_class <> dep.oid
  )
  SELECT c.oid, c.relkind AS kind, n.nspname AS sch, c.relname AS nam, max(dep.depth) AS depth,
         pg_get_viewdef(c.oid) AS def, c.reloptions AS opts, c.relacl AS acl,
         obj_description(c.oid, 'pg_class') AS cmt
  FROM dep
  JOIN pg_class c ON c.oid = dep.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm')
  GROUP BY c.oid, c.relkind, n.nspname, c.relname, c.reloptions, c.relacl;

  IF EXISTS (SELECT 1 FROM _p2_views WHERE kind = 'm') THEN
    RAISE EXCEPTION '0172: a materialized view depends on these columns — handle it by hand.';
  END IF;

  FOR v_view IN SELECT * FROM _p2_views ORDER BY depth DESC LOOP
    EXECUTE format('DROP VIEW %I.%I', v_view.sch, v_view.nam);
  END LOOP;

  FOR i IN 1 .. array_length(v_cols, 1) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_cols[i][1]
        AND column_name = v_cols[i][2] AND data_type = 'integer'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(14,3)',
                     v_cols[i][1], v_cols[i][2]);
    END IF;
  END LOOP;

  FOR v_view IN SELECT * FROM _p2_views ORDER BY depth ASC LOOP
    EXECUTE format('CREATE VIEW %I.%I %s AS %s',
      v_view.sch, v_view.nam,
      CASE WHEN v_view.opts IS NULL THEN ''
           ELSE 'WITH (' || array_to_string(v_view.opts, ', ') || ')' END,
      rtrim(v_view.def, E'; \n\t'));
    -- Grants exactly as before: first take away whatever the schema's default
    -- privileges handed the new view, then replay the old list.
    FOR v_acl IN
      SELECT DISTINCT x.grantee
      FROM pg_class c, aclexplode(c.relacl) x
      WHERE c.oid = format('%I.%I', v_view.sch, v_view.nam)::regclass
        AND x.grantee <> c.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON %I.%I FROM %s', v_view.sch, v_view.nam,
        CASE WHEN v_acl.grantee = 0 THEN 'PUBLIC'
             ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = v_acl.grantee)) END);
    END LOOP;
    FOR v_acl IN
      SELECT x.privilege_type, x.grantee
      FROM aclexplode(v_view.acl) x
    LOOP
      EXECUTE format('GRANT %s ON %I.%I TO %s', v_acl.privilege_type, v_view.sch, v_view.nam,
        CASE WHEN v_acl.grantee = 0 THEN 'PUBLIC'
             ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = v_acl.grantee)) END);
    END LOOP;
    IF v_view.cmt IS NOT NULL THEN
      EXECUTE format('COMMENT ON VIEW %I.%I IS %L', v_view.sch, v_view.nam, v_view.cmt);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

ALTER TABLE public.purchase_order_lines
  DROP CONSTRAINT IF EXISTS purchase_order_lines_received_qty_check;
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_received_qty_check
  CHECK (received_qty >= 0 AND received_qty <= qty * 1.1);
--> statement-breakpoint

ALTER TABLE public.jw_dc_inward
  ADD COLUMN IF NOT EXISTS goods_receipt_note_id uuid
  REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN public.jw_dc_inward.goods_receipt_note_id IS
  'The QC-pending GRN raised for this JW DC receipt (0172, ADR-189: Incoming QC is the only inspector). NULL on receipts made before 0172, which were accepted by the store.';
--> statement-breakpoint

ALTER TABLE public.jw_dc_inward_lines
  DROP CONSTRAINT IF EXISTS jw_dc_inward_lines_split_total;
--> statement-breakpoint
ALTER TABLE public.jw_dc_inward_lines
  ADD CONSTRAINT jw_dc_inward_lines_split_total
  CHECK (ok_qty + rejected_qty <= received_qty);
