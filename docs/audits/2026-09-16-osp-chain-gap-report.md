# OSP job-card chain — gap report (2026-09-16)

Scope: one job card with an outsource (OSP) operation, run through PR → JWPO → OSP challan →
receive → auto-GRN → Incoming QC → op/JC/SO status, with MULTIPLE NCs and REPEATED
return-to-vendor (RTV) cycles on the same pieces. Evidence: two read-only code traces
(2026-09-16) plus the live 4-cycle run on the test stack (IN-JWPO-00007/R1, report
`apps/web/.playwright/reports/erp-chain-verification-2026-09-16.pdf`).

Already fixed: PO line received qty double-subtraction and stale PO header (ADR-165, 814bb636).

Timeline used: op qty 10 → DC out 10 → GRN 10 → QC 7/3 → NC-A(3) → RTV A → GRN-A → QC 1/2 →
NC-B(2) → RTV B → GRN-B → QC 0/2 → NC-C(2) → RTV C → GRN-C → QC 2/0. Op 2 = in-house QC op.

Structural facts everything below follows from (paths under `apps/api/src/`):
- The RTV challan line carries `purchase_order_line_id` = the op's `outsource_po_line_id`
  (`modules/nc-register/service.ts:1513-1516,1561`); header has `purchase_order_id = null`, `nc_id` set.
- So DC-receive treats an RTV challan like an ordinary one: auto-GRN line gets the PO line
  (`modules/delivery-challans/service.ts:1450`), GRN header gets `nc_id`, `applyReceiveToJcOp` fires
  (`:1517-1526`).
- Only `recalcPoLineReceivedQty` filters `grn.nc_id IS NULL` (`modules/goods-receipt-notes/cascades.ts:94`);
  the views `v_jc_op_status` (migration 0125:51-66) and `v_osp_wip` (0110:44-55) do not.
- Follow-on NCs (NC-B, NC-C) are raised by `autoCreateNcFromQcReject` with `grn_line_id` =
  the replacement GRN line and `jc_op_id` = the OSP op; no `split_from_nc_id` / parent link
  (`modules/nc-register/cascades.ts:724-757`).
- `mirrorIncomingQcOntoNextQcOp` is skipped when `line.ncId` (`modules/incoming-qc/service.ts:543`);
  `onNcReplacementQc` PO-linked branch does NOT reinject an op_log row (`modules/nc-register/recovery.ts:711-760`).
- `submitIncomingQc` never calls `tryCascadeJcComplete` (callers: `modules/op-entry/service.ts:1086,1503,1509`,
  `modules/delivery-challans/service.ts:1595` only).

## Gaps

### G1 (critical) — replacement pieces never reach the next QC op; JC stuck at qc_pending
`incoming-qc/service.ts:543` skips the mirror for `ncId` lines; `recovery.ts:711-760` does not
reinject for a PO-linked origin. At S13: op2 `input_avail` 10, `qc_accepted` 7 → `qc_pending` 3
(0125:178-188) → op2 `qc_pending`, JC `qc_pending` (0019:286), tiles "7 done / 3 pending".
Contradicts ADR-161 §6 ("one inspection"). A second manual inspection on op2 that rejects raises
an in-house NC that cannot be returned to vendor (`nc-register/cascades.ts:240-244`).
Fix: mirror accepted replacement qty onto the next QC op like first-cycle pieces (remove the
`ncId` skip when the origin op is outsource and op_seq+1 is a QC op); keep `onRecoveryJobCardQc`.

### G2 (critical) — no JC-completion cascade from Incoming QC
Last-op OSP: the op reaches `complete` at S13 (0125:209-216) but `tryCascadeJcComplete` only ran
at DC receive while the JC was incomplete → `job_cards.closed_at` and the SO/JW line never close.
Fix: call `tryCascadeJcComplete(tx, jobCardId, user)` at the end of `submitIncomingQc` when the
line traces to a JC op.

### G3 (critical) — stock never credited for mirrored pieces when the QC op is last
`creditGrnQcStock` skips mid-route lines (`goods-receipt-notes/cascades.ts:289`); the mirror row
is a raw `op_log` insert (`incoming-qc/service.ts:183-201`) so `tryApplyQcStockCascade`
(`op-entry/service.ts:1485-1498`, only from `submitQcLog`) never runs → the 7 first-cycle pieces
get no stock row; replacement pieces only via the manual second inspection of G1.
Fix: after the mirror insert, if the mirrored op is the JC's last op, run the QC stock cascade
for that op_log row.

### G4 (high) — at-vendor and in-QC double count while a replacement awaits QC
0125:114-128 `rtv = SUM(rejected_qty)` for open RTV NCs (status `disposed` included);
0125:251-256 `at_vendor = GREATEST(0, sent − osp_received) + rtv`, `in_qc = received − acc − rej`
with `osp_received` including replacement GRNs (17 vs sent 10 at S13). S6: at_vendor 3 AND
in_qc 3 for 3 pieces; S9 2/2; S12 2/2. Same in `v_osp_wip` (0110:96-100) → OSP register,
Store "At Vendor" (`modules/store-inventory/service.ts:118`). Partial inspection leaves rtv at the
full rejected qty. At S4 (disposed, no challan) at_vendor already reads 3.
Fix (one migration re-emitting both views): the ordinary term uses `grn.nc_id IS NULL`; the
rtv at-vendor term = Σ(rtv_sent − rtv_received) over non-closed RTV NCs; `available` subtracts
open qty (rejected − cleared − failed), not rejected qty; `in_qc` unchanged.

### G5 (high) — outsource_status frozen at `received`; replacement receipts flip it early
`delivery-challans/receipt-cascades.ts:113-131` sums ALL receipt lines on the op's PO lines (RTV
included) vs `outsource_sent_qty` (ordinary only): PO 10, DC received 8, RTV 2 back → 8+2 ≥ 10 →
`received` with 2 ordinary pieces still out. `received` is never demoted when an RTV challan
goes out (`delivery-challans/cascades.ts:258-259` only promotes PRE_SENT). Each replacement
receipt re-emits `OP_OUTSOURCE_RECEIVED` (`delivery-challans/service.ts:1563-1577`) and re-runs
the JC cascade. Card label reads "Received" while AT VENDOR shows 3/2/2.
Fix: exclude `dc.nc_id IS NOT NULL` challans from the cumulative; in `createNcDc` set
`outsource_status = 'sent'` when it was `received`; in `onNcChallanReceived` set `received`
again when rtv_received ≥ rtv_sent and no other open RTV NC on the op.

### G6 (medium) — RTV challans inflate the PO-line "already sent" guard
`delivery-challans/service.ts:893-922` sums every DC line on the PO line, RTV lines included.
PO 10, DC 6, RTV 2 → sentOnDcs 8, poBalance 2 while the op-level sendable is 4
(`cascades.ts:192`) → preview (:684-685) and create guard (:1053-1063) under-allow by the RTV qty.
Fix: `AND dc.nc_id IS NULL` in `sumSentQtyByPoLine`.

### G7 (medium) — v_nc_op_breakup counts a failed piece once per NC generation; no `disposed` bucket
0122:352 `nc_closed_qty` adds the closed NC's full `rejected_qty` although the failed pieces are
alive as the next NC: S7 raised 2 + closed 3 = 5 for 3 pieces; S13 "NC closed 7" for 3 rejects.
Status `disposed` has no bucket (0122:342-352) → the strip renders nothing
(`apps/web/src/modules/job-cards/components/jc-op-card.tsx:64-67`) while at_vendor already counts them.
Fix: closed = `cleared_qty` (plus scrap); add `awaiting_return_challan_qty` for
disposition return_to_vendor AND status disposed.

### G8 (low) — follow-on NC has no link to the NC whose pieces it carries
Fix: `parent_nc_id` on nc_register, set by `autoCreateNcFromQcReject` when the GRN header has
`nc_id`; show "Continues NC …" on the NC page and in related docs.

### G9 (low) — housekeeping
- PO reject (`purchase-orders/service.ts:2342`) leaves the op `po_created` with
  `outsource_po_line_id` on a cancelled PO line; Gen DC still gated on it. Fix: release like
  `releaseSourceJcOps` (`purchase-requests/service.ts:1382-1400`).
- `outsource_po_line_id` is set once (`job-cards/jc-op-po-links.ts:81-89`); every GRN rollup reads
  only that line while DC/receive guards use `jc_op_po_lines`. Fix: rollups via `jc_op_po_lines`.
- SO Status / SO Overview (`lib/calc-engine.ts:113-135,200-214`) count op_log only → an OSP op
  never reads complete there. Fix: include GRN-accepted qty for outsource ops.
- `createJobCard` (JW-only, `job-cards/service.ts:1483-1513`) leaves an outsource op with
  `outsource_status = NULL` and no PR until the next edit.

## Verified correct (no change needed)
- `outsource_sent_qty` (RTV challans do not add to it), `outsource_returned_qty` (ends 10 = 7+1+0+2).
- `ready_to_send_qty` at every step.
- PO line received qty and header at every step (ADR-165).
- Stock credit once per accepted piece when the OSP op is the LAST op (S3 +7, S7 +1, S13 +2).
- NC ledger per NC (cleared/failed/rtv_sent/rtv_received, auto-close, `ncCloseBlockedReason`).
- No double count between OPEN NC rows in v_nc_op_breakup (NC-A closes before NC-B exists).

## Suggested order
Batch 1 (correctness): G1, G2, G3, G5, G6 (code) + G4 (one migration re-emitting v_jc_op_status
and v_osp_wip). Batch 2: G7, G8 (migrations). Batch 3: G9.
Re-prove each batch with `apps/web/e2e/flow-erp-chain-report.spec.ts` (R1 section) plus a
mid-route variant (OSP op followed by a QC op) for G1/G3.
