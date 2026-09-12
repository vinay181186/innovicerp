-- 0123 — a Route Card carries its default Plan Type.
--
-- SO/JWSO Planning asks "Manufacture / Full Outsource / Direct Purchase" for
-- every plan. A route card says how an item is normally made, so it is the
-- natural place to record which of those three it normally is; the planner
-- can then default from the card instead of re-deciding per order.
--
-- Same enum SO Planning uses (plan_type). Existing cards default to
-- 'manufacture', which is what every card built through the ops table is.
-- ADDITIVE: one nullable-with-default column, no data touched.
ALTER TABLE public.route_cards
  ADD COLUMN IF NOT EXISTS plan_type public.plan_type NOT NULL DEFAULT 'manufacture';
