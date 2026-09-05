-- ============================================================
-- 0109_backfill_osp_po_line_links
--
-- Repairs outsource operations whose Purchase Order was raised on the +New PO
-- screen instead of the PR screen's "Create PO" button.
--
-- The from-PR path stamps three things: purchase_order_lines.source_jc_op_id,
-- jc_ops.outsource_po_line_id and outsource_status='po_created'. The +New PO
-- path stamped only the PR, so the operation was left with no PO line to point
-- back at. That single missing link is load-bearing:
--
--   * delivery-challans/cascades.ts finds the op BY outsource_po_line_id. Not
--     finding it, it returned quietly -- so the "you cannot send more than the
--     previous op cleared" guard never ran and any qty went out.
--   * v_jc_op_status reads an outsource op's OUTPUT through the same column,
--     so nothing the vendor returned counted, and the NEXT op got input 0.
--   * incoming-qc credits the return through purchase_order_lines
--     .source_jc_op_id, so QC-accepted pieces never reached the operation.
--
-- Live case: IN-JC-26-00008 op 8 "Coating" (PR IN-JWPR-00009 -> PO IN-PO-00004).
-- 30 pcs were sent on IN-DC-00002 and 30 received + QC-accepted on
-- IN-GRN-00001, while the job card still read "PR raised, 0 sent, 0 done" and
-- op 9 (TPI) had nothing to inspect.
--
-- The code side is fixed in the same change (purchase-orders/service.ts now
-- stamps the op on the +New PO path; cascades.ts now REFUSES a job-work line
-- with no op link rather than skipping the guard). This migration repairs rows
-- written before that fix.
--
-- DATA-ONLY -- no schema change. IDEMPOTENT: every step is bounded by the
-- column it fills, so a second run matches nothing.
--
-- Safety: an operation that already carries an outsource_po_line_id is a real
-- commitment and is never re-pointed. Quantities are RECOMPUTED from the
-- challans and GRNs that actually exist -- no number is invented.
--
-- Superuser connection: disable RLS for the data writes below.
SET row_security = off;
--> statement-breakpoint

-- 1. Give the PO line back the operation its source PR was raised for.
UPDATE public.purchase_order_lines pol
SET source_jc_op_id = pr.source_jc_op_id,
    updated_at = now()
FROM public.purchase_requests pr
WHERE pr.id = pol.source_pr_id
  AND pol.source_jc_op_id IS NULL
  AND pr.source_jc_op_id IS NOT NULL
  AND pol.deleted_at IS NULL
  AND pr.deleted_at IS NULL;
--> statement-breakpoint

-- 2. Point the operation at that PO line. Only ops still sitting in a pre-PO
--    state are advanced; anything further along keeps the status it earned.
UPDATE public.jc_ops o
SET outsource_po_line_id = pol.id,
    outsource_status = CASE
      WHEN o.outsource_status IS NULL OR o.outsource_status IN ('pending', 'pr_raised')
        THEN 'po_created'::outsource_status
      ELSE o.outsource_status
    END,
    updated_at = now()
FROM public.purchase_order_lines pol
WHERE pol.source_jc_op_id = o.id
  AND o.outsource_po_line_id IS NULL
  AND o.deleted_at IS NULL
  AND pol.deleted_at IS NULL;
--> statement-breakpoint

-- 3. Rebuild what was SENT from the outward challans that already exist. Sums
--    every live, non-cancelled DC line against the op's PO line -- the same
--    arithmetic applyOutwardToJcOp would have done had it fired at the time.
--    Only ops still reading 0 are touched, so a correctly-tracked op is safe.
UPDATE public.jc_ops o
SET outsource_sent_qty = d.sent_qty,
    outsource_sent_date = COALESCE(o.outsource_sent_date, d.first_dc_date),
    outsource_dc_no = COALESCE(o.outsource_dc_no, d.last_dc_code),
    outsource_status = CASE
      WHEN o.outsource_status IN ('pending', 'pr_raised', 'po_created')
        THEN 'sent'::outsource_status
      ELSE o.outsource_status
    END,
    updated_at = now()
FROM (
  SELECT dcl.purchase_order_line_id AS po_line_id,
         SUM(dcl.qty)::int          AS sent_qty,
         MIN(dc.dc_date)            AS first_dc_date,
         (ARRAY_AGG(dc.code ORDER BY dc.dc_date DESC, dc.code DESC))[1] AS last_dc_code
  FROM public.delivery_challan_lines dcl
  JOIN public.delivery_challans dc
    ON dc.id = dcl.delivery_challan_id
   AND dc.deleted_at IS NULL
   AND dc.status <> 'cancelled'
  WHERE dcl.deleted_at IS NULL
    AND dcl.purchase_order_line_id IS NOT NULL
  GROUP BY dcl.purchase_order_line_id
) d
WHERE o.outsource_po_line_id = d.po_line_id
  AND o.outsource_sent_qty = 0
  AND d.sent_qty > 0
  AND o.deleted_at IS NULL;
--> statement-breakpoint

-- 4. Rebuild what came BACK from the goods receipts already booked against the
--    op's PO line, and close the op when the whole sent qty has returned --
--    mirroring creditOutsourceReturn in incoming-qc/service.ts.
UPDATE public.jc_ops o
SET outsource_returned_qty = g.accepted_qty,
    outsource_status = CASE
      WHEN o.outsource_sent_qty > 0 AND g.accepted_qty >= o.outsource_sent_qty
        THEN 'received'::outsource_status
      ELSE o.outsource_status
    END,
    updated_at = now()
FROM (
  SELECT grl.purchase_order_line_id AS po_line_id,
         COALESCE(SUM(grl.qc_accepted_qty), 0)::int AS accepted_qty
  FROM public.goods_receipt_note_lines grl
  JOIN public.goods_receipt_notes grn
    ON grn.id = grl.goods_receipt_note_id
   AND grn.deleted_at IS NULL
  WHERE grl.deleted_at IS NULL
    AND grl.purchase_order_line_id IS NOT NULL
  GROUP BY grl.purchase_order_line_id
) g
WHERE o.outsource_po_line_id = g.po_line_id
  AND o.outsource_returned_qty = 0
  AND g.accepted_qty > 0
  AND o.deleted_at IS NULL;
