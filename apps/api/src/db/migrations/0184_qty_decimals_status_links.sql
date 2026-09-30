-- ============================================================
-- 0184_qty_decimals_status_links.sql  (fix wave 2, step 2b — S8, S9, Point 3)
--
-- 1. Decimals follow the unit (S9). Every stored quantity keeps 3 places,
--    like the PO / GRN / store ledger columns (0153, 0172). These still kept
--    2 places or none, so 0.125 KG was saved as 0.13 and 12.5 KG as 12:
--      delivery_challan_lines.qty                          numeric(12,2) → numeric(14,3)
--      delivery_challan_receipt_lines.received_qty /
--        rejected_qty                                      numeric(12,2) → numeric(14,3)
--      jc_op_po_lines.qty                                  integer       → numeric(14,3)
--      nc_register.rejected_qty / rework_done_qty /
--        rtv_sent_qty / rtv_received_qty /
--        cleared_qty / failed_qty                          numeric(12,2) → numeric(14,3)
--      bom_master_lines.qty_per_set                        numeric(12,2) → numeric(14,3)
--    Widening only — no stored value changes. Whole-number units (NOS / SET)
--    are refused a fraction by the API (packages/shared lib/qty-rule.ts).
--
-- 2. SO → BOM real link (Point 3). sales_orders.bom_master_id was text
--    holding a uuid, with no FK. It becomes uuid + FK to bom_masters(id).
--    A value that is not the id of a bom_masters row of the same company
--    cannot become a FK: it is copied to public._fix0184_backup first and
--    then set to NULL. (TEST 2026-09-30: 15 / 15 values are valid — none
--    changes. PROD is checked by this same rule when it is applied.)
--
--    Every view that reads one of the columns above (and every view built on
--    such a view — TEST: v_jc_op_status, v_nc_op_breakup, v_osp_wip) is
--    dropped and re-created from its own stored definition, grants, options
--    and comment inside ONE DO block, exactly as 0172 did — all-or-nothing,
--    no view is ever left missing. Only runs while a column still needs it.
--
-- 3. NC ↔ SO link (Point 3). nc_register was linked to its Sales Order by the
--    code text only. New nc_register.so_id (uuid FK, ON DELETE SET NULL) is
--    back-filled where so_code_text names exactly ONE live SO of the same
--    company; an ambiguous or unknown code stays unlinked (so_code_text is
--    kept as the snapshot). (TEST: 0 / 9 NCs carry an SO code.)
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   ALTER TABLE public.nc_register DROP COLUMN so_id;
--   ALTER TABLE public.sales_orders DROP CONSTRAINT sales_orders_bom_master_id_fkey;
--   ALTER TABLE public.sales_orders ALTER COLUMN bom_master_id TYPE text USING bom_master_id::text;
--   UPDATE public.sales_orders s SET bom_master_id = b.old_value FROM public._fix0184_backup b
--     WHERE b.tbl = 'sales_orders' AND b.col = 'bom_master_id' AND s.id = b.row_id;
--   (quantities: narrowing back would round stored decimals — leave them widened;
--    views depending on sales_orders.bom_master_id must be dropped / re-created
--    around the type change the same way this file does)
--   DROP TABLE public._fix0184_backup;
-- ============================================================

CREATE TABLE IF NOT EXISTS public._fix0184_backup (
  tbl text NOT NULL,
  row_id uuid NOT NULL,
  col text NOT NULL,
  old_value text,
  fixed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id, col)
);
--> statement-breakpoint
-- Same protection as every table: RLS on with no policies = anon /
-- authenticated (PostgREST) cannot read it; apply-sql / the API connect as
-- postgres (BYPASSRLS).
ALTER TABLE public._fix0184_backup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_cols constant text[][] := ARRAY[
    ['delivery_challan_lines', 'qty'],
    ['delivery_challan_receipt_lines', 'received_qty'],
    ['delivery_challan_receipt_lines', 'rejected_qty'],
    ['jc_op_po_lines', 'qty'],
    ['nc_register', 'rejected_qty'],
    ['nc_register', 'rework_done_qty'],
    ['nc_register', 'rtv_sent_qty'],
    ['nc_register', 'rtv_received_qty'],
    ['nc_register', 'cleared_qty'],
    ['nc_register', 'failed_qty'],
    ['bom_master_lines', 'qty_per_set'],
    ['sales_orders', 'bom_master_id']
  ];
  v_todo int;
  v_bom_is_text boolean;
  v_view record;
  v_acl record;
  i int;
BEGIN
  -- What still needs changing: a qty column not yet numeric(14,3), or the
  -- BOM link still text.
  SELECT count(*) INTO v_todo
  FROM information_schema.columns c
  JOIN unnest(v_cols[:][1:1], v_cols[:][2:2]) AS t(tbl, col)
    ON c.table_name = t.tbl AND c.column_name = t.col
  WHERE c.table_schema = 'public'
    AND ((t.col <> 'bom_master_id'
          AND NOT (c.data_type = 'numeric' AND c.numeric_precision = 14 AND c.numeric_scale = 3))
      OR (t.col = 'bom_master_id' AND c.data_type = 'text'));

  IF v_todo = 0 THEN
    RAISE NOTICE '0184: quantities already numeric(14,3) and bom_master_id already uuid — nothing to do.';
    RETURN;
  END IF;

  SELECT data_type = 'text' INTO v_bom_is_text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'bom_master_id';

  -- Before-copy, then clear, every bom_master_id that cannot be a FK.
  IF v_bom_is_text THEN
    INSERT INTO public._fix0184_backup (tbl, row_id, col, old_value)
    SELECT 'sales_orders', s.id, 'bom_master_id', s.bom_master_id
    FROM public.sales_orders s
    WHERE s.bom_master_id IS NOT NULL
      AND NOT (
        s.bom_master_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND EXISTS (
          SELECT 1 FROM public.bom_masters b
          WHERE b.id::text = lower(s.bom_master_id) AND b.company_id = s.company_id
        )
      )
    ON CONFLICT (tbl, row_id, col) DO NOTHING;

    UPDATE public.sales_orders s
    SET bom_master_id = NULL
    WHERE s.bom_master_id IS NOT NULL
      AND NOT (
        s.bom_master_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND EXISTS (
          SELECT 1 FROM public.bom_masters b
          WHERE b.id::text = lower(s.bom_master_id) AND b.company_id = s.company_id
        )
      );
  END IF;

  -- Every view reading one of the columns, then every view on top of those.
  CREATE TEMP TABLE _w2b_views ON COMMIT DROP AS
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

  IF EXISTS (SELECT 1 FROM _w2b_views WHERE kind = 'm') THEN
    RAISE EXCEPTION '0184: a materialized view depends on these columns — handle it by hand.';
  END IF;

  FOR v_view IN SELECT * FROM _w2b_views ORDER BY depth DESC LOOP
    EXECUTE format('DROP VIEW %I.%I', v_view.sch, v_view.nam);
  END LOOP;

  FOR i IN 1 .. array_length(v_cols, 1) LOOP
    IF v_cols[i][2] = 'bom_master_id' THEN
      IF v_bom_is_text THEN
        ALTER TABLE public.sales_orders
          ALTER COLUMN bom_master_id TYPE uuid USING lower(bom_master_id)::uuid;
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_cols[i][1]
        AND column_name = v_cols[i][2]
        AND NOT (data_type = 'numeric' AND numeric_precision = 14 AND numeric_scale = 3)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(14,3)',
                     v_cols[i][1], v_cols[i][2]);
    END IF;
  END LOOP;

  FOR v_view IN SELECT * FROM _w2b_views ORDER BY depth ASC LOOP
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_bom_master_id_fkey'
      AND conrelid = 'public.sales_orders'::regclass
  ) THEN
    ALTER TABLE public.sales_orders
      ADD CONSTRAINT sales_orders_bom_master_id_fkey
      FOREIGN KEY (bom_master_id) REFERENCES public.bom_masters(id);
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_orders_bom_master_idx
  ON public.sales_orders (bom_master_id)
  WHERE bom_master_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN public.sales_orders.bom_master_id IS
  'The BOM this equipment SO builds (FK bom_masters.id, uuid since 0184). Only an Active BOM may be linked — checked by the API when the link is set or changed.';
--> statement-breakpoint
ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS so_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nc_register_so_idx
  ON public.nc_register (so_id)
  WHERE so_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN public.nc_register.so_id IS
  'The Sales Order this NC belongs to (0184). so_code_text is the snapshot: read so_id first, so_code_text as the fallback.';
--> statement-breakpoint
-- Back-fill: only where the code names exactly one live SO of the same company.
UPDATE public.nc_register n
SET so_id = m.so_id
FROM (
  SELECT n2.id AS nc_id, min(s.id::text)::uuid AS so_id
  FROM public.nc_register n2
  JOIN public.sales_orders s
    ON s.company_id = n2.company_id
   AND s.code = btrim(n2.so_code_text)
   AND s.deleted_at IS NULL
  WHERE n2.so_id IS NULL
    AND coalesce(btrim(n2.so_code_text), '') <> ''
  GROUP BY n2.id
  HAVING count(DISTINCT s.id) = 1
) m
WHERE n.id = m.nc_id
  AND n.so_id IS NULL;
