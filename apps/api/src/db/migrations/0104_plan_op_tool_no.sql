-- 0104 — a PLAN operation remembers its TOOL NUMBER.
--
-- The tool number travels the whole routing chain:
--
--   route_card_ops.tool_no   text   (the item's saved routing)
--   plan_ops.tool_no         <-- MISSING until now
--   jc_ops.tool_no           text   (the shop-floor Job Card op)
--
-- Because the plan in the middle had no column for it, the number was dropped
-- twice. Loading a route card into a plan silently lost it, so the Job Card
-- created from that plan had no tool number. Worse, plan execute writes the
-- plan's ops back onto the item's route card (ADR-051 auto-save), so executing
-- a plan BLANKED a tool number the route card already had.
--
-- Same type and same 64-character intent as the two columns either side, so the
-- plan neither narrows nor widens what the chain already carries.
--
-- Nullable, no default: every existing plan op predates the column and there is
-- nothing to backfill from — the plan's own route card may have been revised
-- since, so copying a tool number back onto historical plan ops would invent
-- data. plan_ops already has RLS with its company_read / manager_write policies;
-- a new column on an existing table inherits them.
--
-- Idempotent — the single step is guarded, so a re-run is a no-op.

alter table public.plan_ops
  add column if not exists tool_no text;
