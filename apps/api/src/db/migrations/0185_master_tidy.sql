-- ============================================================
-- 0185_master_tidy.sql  (fix wave 3, area E — plan v3 Phase E data fill)
--
-- Safe, generic clean-ups that need NO human decision:
--
-- 1. Purchase Requests: the placeholder vendor text 'TBD' (any case / spaces)
--    is cleared on every PR that already links a real vendor (vendor_id set).
--    The link is the fact; the text was a leftover. A PR with 'TBD' and NO
--    vendor link is left alone (a person must choose the vendor) — the CHECK
--    num_nonnulls(vendor_id, vendor_code_text) >= 1 stays satisfied.
--
-- 2. Masters: leading / trailing blanks (spaces, tabs, line breaks) are
--    trimmed from
--       clients.name, clients.code, clients.gst_number
--       vendors.name, vendors.code, vendors.gst_number
--       items.name,   items.code
--    A GSTIN that is only blanks becomes NULL. A name that is only blanks is
--    NOT touched (name is required — a person must type it). A code is
--    trimmed only when no other live record of the same company would then
--    carry the same code (the per-company unique code index) — a clash is
--    left as it is and listed in a NOTICE.
--
-- Every changed value is copied first into public._fix0185_backup (table,
-- row id, column, old value). Re-running changes nothing: the WHERE clauses
-- only match values that still need the fix, and the backup keeps the FIRST
-- copy (ON CONFLICT DO NOTHING).
--
-- TEST (uitsrhyulidubnddzcex) checked read-only 2026-09-30: 2 PRs with 'TBD' +
-- vendor link (IN-PR-00001, IN-PR-00002) → cleared; 1 PR with 'TBD' and no
-- link (IN-PR-00003) → left; 0 master values with outer blanks.
-- PROD read via the API 2026-09-30: 0 PRs with 'TBD', 0 master names / codes
-- with outer blanks. PROD is checked by the same rules when it is applied.
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   UPDATE public.purchase_requests t SET vendor_code_text = b.old_value
--     FROM public._fix0185_backup b
--     WHERE b.tbl = 'purchase_requests' AND b.col = 'vendor_code_text' AND t.id = b.row_id;
--   -- the same UPDATE per (tbl, col) for clients / vendors / items
--   -- name, code, gst_number;
--   DROP TABLE public._fix0185_backup;
-- ============================================================

CREATE TABLE IF NOT EXISTS public._fix0185_backup (
  tbl text NOT NULL,
  row_id uuid NOT NULL,
  col text NOT NULL,
  old_value text,
  fixed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id, col)
);
--> statement-breakpoint
-- RLS on, no policies: PostgREST (anon / authenticated) cannot read or write it.
ALTER TABLE public._fix0185_backup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
COMMENT ON TABLE public._fix0185_backup IS
  'Before-copy of the values migration 0185 tidied (PR ''TBD'' vendor text, outer blanks on master name / code / GSTIN). Safe to drop once checked.';
--> statement-breakpoint

-- ── 1. PR placeholder vendor text 'TBD' on a PR that links a vendor ─────────
INSERT INTO public._fix0185_backup (tbl, row_id, col, old_value)
SELECT 'purchase_requests', id, 'vendor_code_text', vendor_code_text
FROM public.purchase_requests
WHERE vendor_id IS NOT NULL
  AND upper(btrim(vendor_code_text)) = 'TBD'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE public.purchase_requests
SET vendor_code_text = NULL
WHERE vendor_id IS NOT NULL
  AND upper(btrim(vendor_code_text)) = 'TBD';
--> statement-breakpoint

-- ── 2. Outer blanks on master names / GSTINs / codes ────────────────────────
-- regexp_replace(x, '^[[:space:]]+|[[:space:]]+$', '', 'g') drops the blanks
-- at either end; '(^[[:space:]]|[[:space:]]$)' finds a value that has some.
DO $$
DECLARE
  spec record;
  n integer;
  tidy text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('clients', 'name'), ('clients', 'gst_number'),
      ('vendors', 'name'), ('vendors', 'gst_number'),
      ('items', 'name')
    ) AS s(tbl, col)
  LOOP
    tidy := format('regexp_replace(%I, ''^[[:space:]]+|[[:space:]]+$'', '''', ''g'')', spec.col);
    -- gst_number: all blanks → NULL; name: all blanks → left for a person.
    EXECUTE format(
      'INSERT INTO public._fix0185_backup (tbl, row_id, col, old_value)
         SELECT %L, id, %L, %I FROM public.%I
         WHERE %I ~ ''(^[[:space:]]|[[:space:]]$)''
           AND (%L = ''gst_number'' OR %s <> '''')
       ON CONFLICT DO NOTHING',
      spec.tbl, spec.col, spec.col, spec.tbl, spec.col, spec.col, tidy);
    EXECUTE format(
      'UPDATE public.%I SET %I = NULLIF(%s, '''')
       WHERE %I ~ ''(^[[:space:]]|[[:space:]]$)''
         AND (%L = ''gst_number'' OR %s <> '''')',
      spec.tbl, spec.col, tidy, spec.col, spec.col, tidy);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '0185: %.% — % value(s) trimmed', spec.tbl, spec.col, n;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  n integer;
  clash integer;
  clash_list text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'vendors', 'items'] LOOP
    -- A code is trimmed only when it is not blank after trimming and no OTHER
    -- live row of the same company has (or would get) the same trimmed code.
    EXECUTE format(
      'CREATE TEMP TABLE _fix0185_codes AS
         SELECT r.id, r.code AS old_code,
                regexp_replace(r.code, ''^[[:space:]]+|[[:space:]]+$'', '''', ''g'') AS new_code,
                EXISTS (
                  SELECT 1 FROM public.%I o
                  WHERE o.company_id = r.company_id AND o.id <> r.id
                    AND o.deleted_at IS NULL
                    AND regexp_replace(o.code, ''^[[:space:]]+|[[:space:]]+$'', '''', ''g'')
                      = regexp_replace(r.code, ''^[[:space:]]+|[[:space:]]+$'', '''', ''g'')
                ) AS clashes
         FROM public.%I r
         WHERE r.code ~ ''(^[[:space:]]|[[:space:]]$)''
           AND regexp_replace(r.code, ''^[[:space:]]+|[[:space:]]+$'', '''', ''g'') <> ''''',
      t, t);
    EXECUTE format(
      'INSERT INTO public._fix0185_backup (tbl, row_id, col, old_value)
         SELECT %L, id, ''code'', old_code FROM _fix0185_codes WHERE NOT clashes
       ON CONFLICT DO NOTHING', t);
    EXECUTE format(
      'UPDATE public.%I r SET code = c.new_code
         FROM _fix0185_codes c
        WHERE c.id = r.id AND NOT c.clashes', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'SELECT count(*), string_agg(quote_literal(old_code), '', '')
               FROM _fix0185_codes WHERE clashes'
      INTO clash, clash_list;
    IF n > 0 THEN
      RAISE NOTICE '0185: %.code — % value(s) trimmed', t, n;
    END IF;
    IF clash > 0 THEN
      RAISE NOTICE '0185: %.code — % code(s) with outer blanks LEFT, trimming would clash with another record''s code: %',
        t, clash, clash_list;
    END IF;
    EXECUTE 'DROP TABLE _fix0185_codes';
  END LOOP;
END $$;
