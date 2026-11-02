-- ============================================================
-- 0237_multi_nc_return_dc.sql — one return-to-vendor DC for several NCs
-- (owner 2026-11-01: "select same SO NCs in a single DC").
--
-- Until now a return DC carried ONE NC on its header (delivery_challans.nc_id)
-- and one line. A DC may now carry several NCs of the same SO going to the same
-- vendor, one line each, so the NC moves down to the line:
--
--   1. delivery_challan_lines.nc_id    — the NC this line returns.
--   2. goods_receipt_note_lines.nc_id  — the NC a replacement GRN line settles
--                                         (copied from the DC line at receipt;
--                                         Incoming QC reads it).
--   3. Backfill both from their headers. Every pre-0237 return DC has exactly
--      one NC, so copying the header onto its lines is exact.
--
-- delivery_challans.nc_id STAYS: it now holds the FIRST NC and keeps marking the
-- challan as a return DC for every "not an RTV challan" filter (SO dispatched,
-- SO pending value, PO sent, op receipts). goods_receipt_notes.nc_id stays the
-- same way. nc_register.delivery_challan_id (NC -> its DC) is unchanged and may
-- now point several NCs at one DC. One NC on one live DC is still guarded by
-- the NC row lock + "delivery_challan_id IS NULL" conditional update in the
-- save, plus 0181's header index for the first NC.
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   ALTER TABLE public.delivery_challan_lines   DROP COLUMN IF EXISTS nc_id;
--   ALTER TABLE public.goods_receipt_note_lines DROP COLUMN IF EXISTS nc_id;
-- ============================================================

ALTER TABLE public.delivery_challan_lines
  ADD COLUMN IF NOT EXISTS nc_id uuid REFERENCES public.nc_register(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.goods_receipt_note_lines
  ADD COLUMN IF NOT EXISTS nc_id uuid REFERENCES public.nc_register(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_challan_lines_nc_idx
  ON public.delivery_challan_lines (nc_id) WHERE nc_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_receipt_note_lines_nc_idx
  ON public.goods_receipt_note_lines (nc_id) WHERE nc_id IS NOT NULL;
--> statement-breakpoint
UPDATE public.delivery_challan_lines l
   SET nc_id = d.nc_id
  FROM public.delivery_challans d
 WHERE l.delivery_challan_id = d.id
   AND d.nc_id IS NOT NULL
   AND l.nc_id IS NULL;
--> statement-breakpoint
UPDATE public.goods_receipt_note_lines l
   SET nc_id = g.nc_id
  FROM public.goods_receipt_notes g
 WHERE l.goods_receipt_note_id = g.id
   AND g.nc_id IS NOT NULL
   AND l.nc_id IS NULL;
