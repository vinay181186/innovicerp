-- 0121 — "Can download drawing files", a per-person switch.
--
-- Drawings are the company's intellectual property. Anyone who can open the
-- ERP can LOOK at one; only named people may take a copy away. This column is
-- who those people are (user's instruction, 2026-09-11).
--
-- It sits beside `full_access` (L6) and `auditor` (L7) because it is the same
-- kind of thing: a whole-account switch, not a per-page tick. A drawing shows
-- up on Items, Sales Orders, JWSOs, Job Cards and QC Documents, so a per-page
-- permission would have to be set five times and forgotten once.
--
-- FALSE for everybody on day one. It is granted, never assumed:
--   * `role = 'admin'`      bypasses it, as it bypasses every other check
--   * `full_access` (L6)    implies it — L6 means everything, everywhere
--   * `auditor`  (L7) does NOT imply it. L7 reads everything and takes nothing
--     away; handing an auditor the company's drawings is a different decision
--     and must be ticked deliberately.
--
-- Enforcement is SERVER-SIDE: the route that mints a download link refuses
-- without this flag, and every view and every download is written to
-- activity_log. Hiding the button is only the courtesy half.
--
-- Idempotent — safe to run twice.

ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS drawing_download boolean NOT NULL DEFAULT false;
