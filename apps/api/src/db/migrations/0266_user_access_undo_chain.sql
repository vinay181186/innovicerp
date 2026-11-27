-- 0266 — "Undo chain" Special Right on user_access (owner plan 27-Nov).
--
--   undo_chain — this person may undo everything holding an SO / JWSO line
--                from one list. FALSE for everybody on day one.
--
-- Only an L6 Super Admin may change it (saveUserAccess refuses anyone else).
-- Full Access implies it (canUndoChain); there is no admin-role bypass.
-- Idempotent: a second run changes nothing. No column or table is dropped.
-- 0264 is reserved for the drawing-verify CHECK tighten; 0265 belongs to
-- another branch.

ALTER TABLE public.user_access ADD COLUMN IF NOT EXISTS undo_chain boolean NOT NULL DEFAULT false;
