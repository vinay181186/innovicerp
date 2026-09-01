-- 0102 — Delivery Challans record the VEHICLE the goods left on.
--
-- `delivery_challans.transport` holds the transporter's NAME only. The gate
-- register and the printed OSP challan both need the vehicle number as its own
-- field, and every other movement document in the system already stores it that
-- way under the same column name and type:
--
--   jw_dc_outward.vehicle_no        text
--   jw_dc_inward.vehicle_no         text
--   jw_return_challans.vehicle_no   text
--   customer_dispatches.vehicle_no  text
--
-- Delivery Challans were the only movement document missing it, which forced
-- users to type the vehicle into the transport box and mixed two different
-- facts into one column. This adds the missing column and leaves `transport`
-- exactly as it is — no rename, no repurpose, no backfill (an existing
-- transport value is a transporter name, not a vehicle number, so splitting it
-- automatically would invent data).
--
-- Nullable, no default: historical DCs simply have no vehicle recorded.
--
-- Idempotent — the single step is guarded, so a re-run is a no-op.

alter table public.delivery_challans
  add column if not exists vehicle_no text;
