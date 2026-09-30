-- ============================================================
-- 0183_master_gst_fields.sql  (fix wave 2, area D — plan v3 Step 2)
--
-- Master fields + rules, ERPNext / India Compliance aligned (owner decisions
-- D1 GST Category, D3 HSN switch, D6 vendor payment terms; rules in WARN mode):
--
--   clients.gst_category, vendors.gst_category   text NULL — one of
--       'registered_regular', 'registered_composition', 'unregistered', 'sez', 'overseas'
--       (GST_CATEGORIES in packages/shared/src/lib/gst.ts). NULL = not chosen.
--   clients.state_code, vendors.state_code        char(2) NULL — GST State
--       Code (INDIAN_STATES in the same file). The existing free-text `state`
--       stays and holds the list's name for the code.
--   vendors.payment_terms_days                    integer NULL, 0..365 —
--       Payment Terms (days) (the customer keeps clients.payment_days).
--   companies.master_rules_mode  text NOT NULL DEFAULT 'warn' ('warn'|'enforce')
--   companies.check_hsn          boolean NOT NULL DEFAULT false
--   companies.hsn_min_digits     integer NOT NULL DEFAULT 6 (4 | 6 | 8)
--
-- Backfill: existing clients / vendors `state` text is mapped to a State Code
-- ONLY where it matches one state unambiguously (the state's name, a known
-- alias such as 'Gujrat' / 'GJ' / 'Orissa', or a bare code '24'), using the
-- same normalisation as resolveStateCode() — lower-case, '&' → 'and', letters
-- and digits only. A mapped row's `state` is rewritten to the list's name.
-- Every changed value is copied first into public._fix0183_backup (table,
-- row id, column, old value). Unmapped text is left as it is and listed in a
-- NOTICE for review.
--
-- CHECKs are added NOT VALID and validated in the same DO block only when no
-- row breaks them (new columns → nothing can). No GSTIN-format CHECK: rules
-- are in warn mode, so a bad GSTIN may still be saved until Phase F.
--
-- TEST (uitsrhyulidubnddzcex) checked read-only 2026-09-30: clients 195 rows
-- all state NULL; vendors 958 NULL + 1 'Gujarat' (→ 24). PROD must be checked
-- on its own — the NOTICEs report it at apply time.
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   UPDATE public.clients t SET state = b.old_value FROM public._fix0183_backup b
--     WHERE b.tbl = 'clients' AND b.col = 'state' AND t.id = b.row_id;
--   UPDATE public.vendors t SET state = b.old_value FROM public._fix0183_backup b
--     WHERE b.tbl = 'vendors' AND b.col = 'state' AND t.id = b.row_id;
--   ALTER TABLE public.clients DROP COLUMN gst_category, DROP COLUMN state_code;
--   ALTER TABLE public.vendors DROP COLUMN gst_category, DROP COLUMN state_code,
--     DROP COLUMN payment_terms_days;
--   ALTER TABLE public.companies DROP COLUMN master_rules_mode,
--     DROP COLUMN check_hsn, DROP COLUMN hsn_min_digits;
--   DROP TABLE public._fix0183_backup;
-- ============================================================

CREATE TABLE IF NOT EXISTS public._fix0183_backup (
  tbl text NOT NULL,
  row_id uuid NOT NULL,
  col text NOT NULL,
  old_value text,
  fixed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id, col)
);
--> statement-breakpoint
-- RLS on, no policies: PostgREST (anon / authenticated) cannot read or write it.
ALTER TABLE public._fix0183_backup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
COMMENT ON TABLE public._fix0183_backup IS
  'Before-copy of the clients / vendors state + state_code values migration 0183 backfilled. Safe to drop once checked.';
--> statement-breakpoint

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gst_category text;
--> statement-breakpoint
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS state_code char(2);
--> statement-breakpoint
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS gst_category text;
--> statement-breakpoint
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS state_code char(2);
--> statement-breakpoint
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS payment_terms_days integer;
--> statement-breakpoint
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS master_rules_mode text NOT NULL DEFAULT 'warn';
--> statement-breakpoint
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS check_hsn boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS hsn_min_digits integer NOT NULL DEFAULT 6;
--> statement-breakpoint
COMMENT ON COLUMN public.clients.gst_category IS 'GST Category (0183, plan D1): registered_regular | registered_composition | unregistered | sez | overseas. NULL = not chosen.';
--> statement-breakpoint
COMMENT ON COLUMN public.vendors.gst_category IS 'GST Category (0183, plan D1): registered_regular | registered_composition | unregistered | sez | overseas. NULL = not chosen.';
--> statement-breakpoint
COMMENT ON COLUMN public.clients.state_code IS 'GST State Code, 2 digits (0183). state holds the matching name.';
--> statement-breakpoint
COMMENT ON COLUMN public.vendors.state_code IS 'GST State Code, 2 digits (0183). state holds the matching name.';
--> statement-breakpoint
COMMENT ON COLUMN public.vendors.payment_terms_days IS 'Payment Terms (days) (0183, plan D6): days we may take to pay this vendor. NULL = not set.';
--> statement-breakpoint
COMMENT ON COLUMN public.companies.master_rules_mode IS 'Master Rules Mode (0183): warn = GSTIN / State / HSN problems are warnings; enforce = refused.';
--> statement-breakpoint
COMMENT ON COLUMN public.companies.check_hsn IS 'Check HSN (0183, plan D3): items we sell (component / assembly) need an HSN Code.';
--> statement-breakpoint
COMMENT ON COLUMN public.companies.hsn_min_digits IS 'HSN Min Digits (0183): 4 | 6 | 8.';
--> statement-breakpoint

-- ── CHECKs (NOT VALID, validated when clean) ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_gst_category_check') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_gst_category_check CHECK (gst_category IS NULL OR gst_category IN ('registered_regular', 'registered_composition', 'unregistered', 'sez', 'overseas')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_gst_category_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.clients WHERE NOT (gst_category IS NULL OR gst_category IN ('registered_regular', 'registered_composition', 'unregistered', 'sez', 'overseas'))) THEN
      RAISE NOTICE '0183: clients_gst_category_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.clients VALIDATE CONSTRAINT clients_gst_category_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_gst_category_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_gst_category_check CHECK (gst_category IS NULL OR gst_category IN ('registered_regular', 'registered_composition', 'unregistered', 'sez', 'overseas')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_gst_category_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.vendors WHERE NOT (gst_category IS NULL OR gst_category IN ('registered_regular', 'registered_composition', 'unregistered', 'sez', 'overseas'))) THEN
      RAISE NOTICE '0183: vendors_gst_category_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_gst_category_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_state_code_check') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_state_code_check CHECK (state_code IS NULL OR state_code IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '96', '97')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_state_code_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.clients WHERE NOT (state_code IS NULL OR state_code IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '96', '97'))) THEN
      RAISE NOTICE '0183: clients_state_code_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.clients VALIDATE CONSTRAINT clients_state_code_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_state_code_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_state_code_check CHECK (state_code IS NULL OR state_code IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '96', '97')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_state_code_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.vendors WHERE NOT (state_code IS NULL OR state_code IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '96', '97'))) THEN
      RAISE NOTICE '0183: vendors_state_code_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_state_code_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_payment_terms_days_range') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_payment_terms_days_range CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_payment_terms_days_range' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.vendors WHERE NOT (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365)) THEN
      RAISE NOTICE '0183: vendors_payment_terms_days_range left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_payment_terms_days_range;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_master_rules_mode_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_master_rules_mode_check CHECK (master_rules_mode IN ('warn', 'enforce')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_master_rules_mode_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.companies WHERE NOT (master_rules_mode IN ('warn', 'enforce'))) THEN
      RAISE NOTICE '0183: companies_master_rules_mode_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.companies VALIDATE CONSTRAINT companies_master_rules_mode_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_hsn_min_digits_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_hsn_min_digits_check CHECK (hsn_min_digits IN (4, 6, 8)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_hsn_min_digits_check' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.companies WHERE NOT (hsn_min_digits IN (4, 6, 8))) THEN
      RAISE NOTICE '0183: companies_hsn_min_digits_check left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.companies VALIDATE CONSTRAINT companies_hsn_min_digits_check;
    END IF;
  END IF;
END $$;
--> statement-breakpoint

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Lookup: normalised text → (State Code, list name). Same keys as
-- resolveStateCode(): every state's name, the aliases in STATE_ALIASES, and
-- the bare codes ('24', '7'). Dropped at the end of this file.
CREATE TABLE IF NOT EXISTS public._fix0183_state_map (
  k text PRIMARY KEY,
  code char(2) NOT NULL,
  name text NOT NULL
);
--> statement-breakpoint
ALTER TABLE public._fix0183_state_map ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO public._fix0183_state_map (k, code, name) VALUES
  ('jammuandkashmir', '01', 'Jammu and Kashmir'),
  ('himachalpradesh', '02', 'Himachal Pradesh'),
  ('punjab', '03', 'Punjab'),
  ('chandigarh', '04', 'Chandigarh'),
  ('uttarakhand', '05', 'Uttarakhand'),
  ('haryana', '06', 'Haryana'),
  ('delhi', '07', 'Delhi'),
  ('rajasthan', '08', 'Rajasthan'),
  ('uttarpradesh', '09', 'Uttar Pradesh'),
  ('bihar', '10', 'Bihar'),
  ('sikkim', '11', 'Sikkim'),
  ('arunachalpradesh', '12', 'Arunachal Pradesh'),
  ('nagaland', '13', 'Nagaland'),
  ('manipur', '14', 'Manipur'),
  ('mizoram', '15', 'Mizoram'),
  ('tripura', '16', 'Tripura'),
  ('meghalaya', '17', 'Meghalaya'),
  ('assam', '18', 'Assam'),
  ('westbengal', '19', 'West Bengal'),
  ('jharkhand', '20', 'Jharkhand'),
  ('odisha', '21', 'Odisha'),
  ('chhattisgarh', '22', 'Chhattisgarh'),
  ('madhyapradesh', '23', 'Madhya Pradesh'),
  ('gujarat', '24', 'Gujarat'),
  ('dadraandnagarhavelianddamananddiu', '26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('maharashtra', '27', 'Maharashtra'),
  ('karnataka', '29', 'Karnataka'),
  ('goa', '30', 'Goa'),
  ('lakshadweep', '31', 'Lakshadweep'),
  ('kerala', '32', 'Kerala'),
  ('tamilnadu', '33', 'Tamil Nadu'),
  ('puducherry', '34', 'Puducherry'),
  ('andamanandnicobarislands', '35', 'Andaman and Nicobar Islands'),
  ('telangana', '36', 'Telangana'),
  ('andhrapradesh', '37', 'Andhra Pradesh'),
  ('ladakh', '38', 'Ladakh'),
  ('othercountries', '96', 'Other Countries'),
  ('otherterritory', '97', 'Other Territory'),
  ('jandk', '01', 'Jammu and Kashmir'),
  ('jk', '01', 'Jammu and Kashmir'),
  ('hp', '02', 'Himachal Pradesh'),
  ('pb', '03', 'Punjab'),
  ('ch', '04', 'Chandigarh'),
  ('uttaranchal', '05', 'Uttarakhand'),
  ('uk', '05', 'Uttarakhand'),
  ('hr', '06', 'Haryana'),
  ('newdelhi', '07', 'Delhi'),
  ('nctofdelhi', '07', 'Delhi'),
  ('nctdelhi', '07', 'Delhi'),
  ('dl', '07', 'Delhi'),
  ('rj', '08', 'Rajasthan'),
  ('up', '09', 'Uttar Pradesh'),
  ('br', '10', 'Bihar'),
  ('sk', '11', 'Sikkim'),
  ('ar', '12', 'Arunachal Pradesh'),
  ('nl', '13', 'Nagaland'),
  ('mn', '14', 'Manipur'),
  ('mz', '15', 'Mizoram'),
  ('tr', '16', 'Tripura'),
  ('ml', '17', 'Meghalaya'),
  ('as', '18', 'Assam'),
  ('wb', '19', 'West Bengal'),
  ('jh', '20', 'Jharkhand'),
  ('orissa', '21', 'Odisha'),
  ('od', '21', 'Odisha'),
  ('chattisgarh', '22', 'Chhattisgarh'),
  ('chhatisgarh', '22', 'Chhattisgarh'),
  ('cg', '22', 'Chhattisgarh'),
  ('mp', '23', 'Madhya Pradesh'),
  ('gujrat', '24', 'Gujarat'),
  ('gj', '24', 'Gujarat'),
  ('damananddiu', '26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('dadraandnagarhaveli', '26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('dnhdd', '26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('maharastra', '27', 'Maharashtra'),
  ('mh', '27', 'Maharashtra'),
  ('ka', '29', 'Karnataka'),
  ('ga', '30', 'Goa'),
  ('ld', '31', 'Lakshadweep'),
  ('kl', '32', 'Kerala'),
  ('tn', '33', 'Tamil Nadu'),
  ('pondicherry', '34', 'Puducherry'),
  ('py', '34', 'Puducherry'),
  ('andamanandnicobar', '35', 'Andaman and Nicobar Islands'),
  ('an', '35', 'Andaman and Nicobar Islands'),
  ('telengana', '36', 'Telangana'),
  ('ts', '36', 'Telangana'),
  ('tg', '36', 'Telangana'),
  ('ap', '37', 'Andhra Pradesh'),
  ('la', '38', 'Ladakh'),
  ('01', '01', 'Jammu and Kashmir'),
  ('02', '02', 'Himachal Pradesh'),
  ('03', '03', 'Punjab'),
  ('04', '04', 'Chandigarh'),
  ('05', '05', 'Uttarakhand'),
  ('06', '06', 'Haryana'),
  ('07', '07', 'Delhi'),
  ('08', '08', 'Rajasthan'),
  ('09', '09', 'Uttar Pradesh'),
  ('10', '10', 'Bihar'),
  ('11', '11', 'Sikkim'),
  ('12', '12', 'Arunachal Pradesh'),
  ('13', '13', 'Nagaland'),
  ('14', '14', 'Manipur'),
  ('15', '15', 'Mizoram'),
  ('16', '16', 'Tripura'),
  ('17', '17', 'Meghalaya'),
  ('18', '18', 'Assam'),
  ('19', '19', 'West Bengal'),
  ('20', '20', 'Jharkhand'),
  ('21', '21', 'Odisha'),
  ('22', '22', 'Chhattisgarh'),
  ('23', '23', 'Madhya Pradesh'),
  ('24', '24', 'Gujarat'),
  ('26', '26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('27', '27', 'Maharashtra'),
  ('29', '29', 'Karnataka'),
  ('30', '30', 'Goa'),
  ('31', '31', 'Lakshadweep'),
  ('32', '32', 'Kerala'),
  ('33', '33', 'Tamil Nadu'),
  ('34', '34', 'Puducherry'),
  ('35', '35', 'Andaman and Nicobar Islands'),
  ('36', '36', 'Telangana'),
  ('37', '37', 'Andhra Pradesh'),
  ('38', '38', 'Ladakh'),
  ('96', '96', 'Other Countries'),
  ('97', '97', 'Other Territory'),
  ('1', '01', 'Jammu and Kashmir'),
  ('2', '02', 'Himachal Pradesh'),
  ('3', '03', 'Punjab'),
  ('4', '04', 'Chandigarh'),
  ('5', '05', 'Uttarakhand'),
  ('6', '06', 'Haryana'),
  ('7', '07', 'Delhi'),
  ('8', '08', 'Rajasthan'),
  ('9', '09', 'Uttar Pradesh')
ON CONFLICT (k) DO NOTHING;
--> statement-breakpoint

-- ── clients: State text → State Code ─────────────────────────────────────────
-- Before-copy of state + state_code for every row this changes.
INSERT INTO public._fix0183_backup (tbl, row_id, col, old_value)
SELECT 'clients', t.id, c.col, CASE c.col WHEN 'state' THEN t.state ELSE t.state_code END
FROM public.clients t
JOIN public._fix0183_state_map m
  ON m.k = regexp_replace(replace(lower(t.state), '&', 'and'), '[^a-z0-9]', '', 'g')
CROSS JOIN (VALUES ('state'), ('state_code')) c(col)
WHERE t.state_code IS NULL AND t.state IS NOT NULL AND btrim(t.state) <> ''
ON CONFLICT (tbl, row_id, col) DO NOTHING;
--> statement-breakpoint
UPDATE public.clients t
SET state_code = m.code, state = m.name
FROM public._fix0183_state_map m
WHERE m.k = regexp_replace(replace(lower(t.state), '&', 'and'), '[^a-z0-9]', '', 'g')
  AND t.state_code IS NULL AND t.state IS NOT NULL AND btrim(t.state) <> '';
--> statement-breakpoint
-- Report what is still unmapped (free text that matches no state) — left as
-- it is for review; the form shows it as "was: …" until a State is chosen.
DO $$
DECLARE n integer; sample text;
BEGIN
  SELECT count(*), string_agg(DISTINCT state, ' | ')
    INTO n, sample
  FROM public.clients
  WHERE deleted_at IS NULL AND state_code IS NULL AND state IS NOT NULL AND btrim(state) <> '';
  IF n > 0 THEN
    RAISE NOTICE '0183: % clients row(s) keep an unmapped State text for review: %', n, left(sample, 800);
  ELSE
    RAISE NOTICE '0183: clients — every State text mapped to a State Code (or blank).';
  END IF;
END $$;
--> statement-breakpoint

-- ── vendors: State text → State Code ─────────────────────────────────────────
-- Before-copy of state + state_code for every row this changes.
INSERT INTO public._fix0183_backup (tbl, row_id, col, old_value)
SELECT 'vendors', t.id, c.col, CASE c.col WHEN 'state' THEN t.state ELSE t.state_code END
FROM public.vendors t
JOIN public._fix0183_state_map m
  ON m.k = regexp_replace(replace(lower(t.state), '&', 'and'), '[^a-z0-9]', '', 'g')
CROSS JOIN (VALUES ('state'), ('state_code')) c(col)
WHERE t.state_code IS NULL AND t.state IS NOT NULL AND btrim(t.state) <> ''
ON CONFLICT (tbl, row_id, col) DO NOTHING;
--> statement-breakpoint
UPDATE public.vendors t
SET state_code = m.code, state = m.name
FROM public._fix0183_state_map m
WHERE m.k = regexp_replace(replace(lower(t.state), '&', 'and'), '[^a-z0-9]', '', 'g')
  AND t.state_code IS NULL AND t.state IS NOT NULL AND btrim(t.state) <> '';
--> statement-breakpoint
-- Report what is still unmapped (free text that matches no state) — left as
-- it is for review; the form shows it as "was: …" until a State is chosen.
DO $$
DECLARE n integer; sample text;
BEGIN
  SELECT count(*), string_agg(DISTINCT state, ' | ')
    INTO n, sample
  FROM public.vendors
  WHERE deleted_at IS NULL AND state_code IS NULL AND state IS NOT NULL AND btrim(state) <> '';
  IF n > 0 THEN
    RAISE NOTICE '0183: % vendors row(s) keep an unmapped State text for review: %', n, left(sample, 800);
  ELSE
    RAISE NOTICE '0183: vendors — every State text mapped to a State Code (or blank).';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS public._fix0183_state_map;
