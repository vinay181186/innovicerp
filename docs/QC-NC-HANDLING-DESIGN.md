# QC–NC Handling — implementation design (2026-09-12)

Source requirement: `Innovic_ERP_QC_NC_Handling_Procedure_R2-1.pdf` (sections referenced as §n).
This document is the single truth for the build. Every agent implementing a slice reads it first.

## 0. What already exists and is REUSED unchanged

| Capability | Where |
|---|---|
| QC inspection writes accepted/rejected against JC + op | `op-entry/service.ts` `submitQcLog`; `incoming-qc/service.ts` `submitIncomingQc` |
| Rejected qty auto-creates an NC | `nc-register/cascades.ts` `autoCreateNcFromQcReject` (called from both) |
| Rejected qty never flows to the next op | `v_jc_op_status` (prev_output = qc_accepted) |
| Dispositions `scrap`, `use_as_is`, `make_fresh` | `nc-register/cascades.ts` `disposeNcCascade` |
| Legacy in-route `rework` rows (`rework_op_seq` set) | kept working via the existing `rework_outstanding` / `rework_raised` CTEs |
| OSP outward DC → receive → auto-GRN → Incoming QC | `delivery-challans/service.ts`, `goods-receipt-notes`, `incoming-qc` |
| Activity log on every write | `emitActivityLog` |
| Permissions: `nc_dispose` (QC dept), `ospdc_create`, `qc_submit`, `qc_incoming` | `lib/access.ts` |

## 1. Dispositions (§3) — enum `nc_disposition`

| Value | PDF name | Action |
|---|---|---|
| `rework` | Rework | **NEW behaviour**: auto-create a CHILD Rework Job Card. (Legacy rows with `rework_op_seq` keep the old in-route behaviour; new dispositions never set `rework_op_seq`.) |
| `repair` | Repair | **NEW value**: auto-create a CHILD Repair Job Card. Identical mechanics to rework; different label and JC code suffix. |
| `return_to_vendor` | Return to Vendor | status → `disposed` (awaiting DC). A separate action **Create DC** issues the challan. |
| `scrap` | Reject | status → `closed` immediately. Requires `nc_dispose` **approve** tier (§3 "close only after required authorization"). |
| `use_as_is` | — (extra, kept) | unchanged |
| `make_fresh` | — (extra, kept) | unchanged |

## 2. NC status lifecycle — enum `nc_status`

```
pending ──dispose(rework)──────► under_rework ──child JC QC done──► closed
        ──dispose(repair)──────► under_repair ──child JC QC done──► closed
        ──dispose(return_to_vendor)► disposed ──Create DC──► sent_to_vendor ──DC receive──► received_qc_pending ──Incoming QC──► closed
        ──dispose(scrap)───────► closed            (approve tier)
        ──dispose(use_as_is)───► closed
        ──dispose(make_fresh)──► closed
legacy: disposed / rework_done (in-route rework rows) ──Close rework──► closed
```

New values: `under_rework`, `under_repair`, `sent_to_vendor`, `received_qc_pending`.

## 3. Quantity model on `nc_register` (interlocks 2, 4, 5, 6)

| Column | Meaning |
|---|---|
| `rejected_qty` (existing) | The qty THIS NC row is responsible for. After a partial disposition it is the dispositioned portion; the remainder lives on a sibling row. |
| `split_from_nc_id` (new) | Sibling link when a disposition covered less than the full qty. |
| `rtv_sent_qty` (new) | Qty on the DC issued for this NC. Must equal the DC line qty (interlock 4). |
| `rtv_received_qty` (new) | Qty received back from the vendor (sum of DC receipts). |
| `cleared_qty` (new) | Qty QC-ACCEPTED after recovery (child JC terminal QC, or Incoming QC on the replacement). |
| `failed_qty` (new) | Qty QC-REJECTED after recovery. A follow-on NC is auto-raised for it by the existing QC cascade. |
| `closed_at`, `closed_by` (new) | Audit of closure. |
| `qc_log_id` (new) | The `op_log` inspection row that raised this NC (Flow 4). |
| `grn_line_id` (new) | The GRN line for an Incoming-QC-raised NC. |
| `child_job_card_id` (new) | The rework/repair child JC. |
| `delivery_challan_id` (new) | The RTV DC. |

**Open NC qty** = `rejected_qty − cleared_qty − failed_qty`.

**Partial disposition (interlock 2):** `dispose` takes `qty` (1 ≤ qty ≤ rejected_qty). If `qty < rejected_qty`, this row's `rejected_qty` becomes `qty` and a sibling row is inserted with the remainder, status `pending`, `split_from_nc_id` = this row, code `<code>/2` (then `/3`…). Every NC row is therefore exactly one disposition — no child table.

**Closure gate (interlock 6, Flow 9):** an NC may move to `closed` only when `cleared_qty + failed_qty = rejected_qty` (rework/repair/RTV), and for RTV additionally `rtv_received_qty = rtv_sent_qty`. Scrap/use_as_is/make_fresh close on disposition. Closure is automatic when the gate is met by a QC write; the manual Close button only succeeds under the same gate and returns the exact shortfall in its error.

## 4. Child Rework / Repair Job Card (§4)

Created in the dispose transaction by `createRecoveryJobCard`:

| `job_cards` column | Value |
|---|---|
| `code` | `<parentCode>-RW<n>` (rework) / `<parentCode>-RP<n>` (repair), n = 1,2,… per parent |
| `parent_job_card_id` (new) | the original JC |
| `parent_nc_id` (existing) | the NC |
| `origin_op_seq` (new) | the op the NC was raised against |
| `recovery_kind` (new, `'rework'|'repair'`) | which disposition made it |
| `item_id`, `drawing_file_path`, `source_so_line_id` / `source_jw_line_id`, raw material grade/size | copied from the parent |
| `order_qty` | the disposition qty |
| `remarks` | `Rework of <parentCode> Op <n> — <ncCode>` |
| `jc_ops` | **none** — the user defines recovery operations (§4.3). When ops are saved, a terminal `DIR` QC op is ALWAYS appended (`recovery_kind` set ⇒ `needsDefaultQcOp` is unconditional), so recovered qty can never merge into WIP without QC (§4.5, interlock 3). |

`order_qty` of a recovery JC cannot be edited above the NC's open qty (interlock 2 on the child).

**Recovery QC cascade** (`nc-register/recovery.ts` `onRecoveryQc`): called from `submitQcLog` after the op_log insert when `job_cards.recovery_kind IS NOT NULL` and the op is the LAST op of that JC:
1. `nc.cleared_qty += accepted`, `nc.failed_qty += rejected`.
2. Re-inject `accepted` into the PARENT route: insert an `op_log` row `log_type='qc', qty=accepted, reject_qty=0` on the origin op (`nc.jc_op_id`), remarks `Recovered via <childCode> — <ncCode>`. This is the same mechanism `use_as_is` already uses; for an outsource origin op the view's outsource branch now adds op_log qc qty (see §7 of this doc).
3. If `cleared + failed = rejected_qty` → `status='closed'`, `closed_at/by`.
4. Rejected qty: the existing `autoCreateNcFromQcReject` on the CHILD raises the follow-on NC; nothing extra.
5. `emitActivityLog` `NC_RECOVERY_QC`.

## 5. Return to Vendor (§5, §12)

**Create DC from NC** — `POST /nc-register/:id/create-dc` `{ dcDate, vendorId?, vendorCodeText, transport?, vehicleNo?, remarks? }`. Gate: `nc_dispose` edit AND `ospdc_create` entry. Preconditions: `disposition='return_to_vendor'`, `status='disposed'`, no DC yet.
- Inserts `delivery_challans` with `nc_id`, `job_card_id`, `reason = 'Return to vendor — <rework|repair>'`, `po_code_text = <ncCode>` (column is NOT NULL; the NC code is the reference), `purchase_order_id = NULL`.
- One line: item from the NC, `qty = nc.rejected_qty`, `purchase_order_line_id = origin op's outsource_po_line_id` when the origin op is an outsource op (so the replacement GRN rolls into the op through the existing view path), else NULL.
- `nc.rtv_sent_qty = qty`, `nc.delivery_challan_id`, `status = 'sent_to_vendor'`.
- §12.2: when the origin op has a PO line, `purchase_order_lines.received_qty -= qty` (audit-logged `PO_RECEIVED_ADJUST`). This is symmetric with step "clearance" below.
- Existing PO-line cumulative-sent guard is skipped for NC DCs (no PO qty to check against).

**Receive** — the existing `POST /delivery-challans/:id/receive`. When the DC has `nc_id`: `nc.rtv_received_qty += received`, `status = 'received_qc_pending'`; the auto-GRN gets `nc_id` (new column) so Incoming QC can find the NC. Interlock 4: cumulative received ≤ `rtv_sent_qty` (existing over-receive cap already enforces per line).

**Incoming QC on a replacement** — existing `submitIncomingQc`; when the GRN has `nc_id`: `nc.cleared_qty += accepted`, `nc.failed_qty += rejected`; §12.6 `purchase_order_lines.received_qty += accepted` (when PO-linked); close when the gate is met. In-house-origin NC (no PO line): re-inject accepted via an op_log qc row on the origin op (same as §4 step 2). Rejected → follow-on NC via the existing cascade.

## 6. OSP QC de-duplication (§7)

In `submitIncomingQc`, after writing the GRN line result for an OUTSOURCE op: if the very next op on the same JC (`op_seq + 1`) has `op_type = 'qc'`, insert one `op_log` row on that QC op: `log_type='qc', qty=accepted, reject_qty=rejected, remarks='Incoming QC (auto — same inspection)'`. Written directly, NOT via `submitQcLog`, so no second NC is raised. The QC op then shows `qc_pending = 0`. One inspection event, one transaction.

## 7. Views

- **`v_jc_op_status`** — re-emitted with ONE additive change: the outsource-op output expressions add `COALESCE(r.qc_accepted_qty, 0)` (recovered pieces re-entering at an outsource op via §4 step 2). Today no `qc` op_log rows exist on outsource ops, so existing numbers are unchanged. Column list and order unchanged.
- **`v_nc_op_breakup`** (new) — per `jc_op_id`, the §6 qty rows:
  `nc_raised_qty` (status pending), `under_rework_qty`, `under_repair_qty` (rejected − cleared − failed; also counts legacy in-route rework rows), `sent_to_vendor_qty` (rtv_sent − rtv_received), `received_qc_pending_qty` (rtv_received − cleared − failed while received_qc_pending), `scrap_qty`, `nc_closed_qty`, `nc_open_qty`.
  Joined into `listJcOpsEnriched` and exposed on `JcOpEnriched`.

## 8. Screens (reuse; additions only)

| Screen | Change |
|---|---|
| NC detail `dispose-nc-panel.tsx` | Qty field (default = rejected, max = rejected); `repair` option; hide `reworkOpSeq` for new rework (child JC); scrap shows approve requirement. |
| NC detail `routes/detail.tsx` | Status pill for new statuses; qty strip (rejected / cleared / failed / open; sent / received for RTV); links to child JC and DC; **Create DC** form (vendor, date, transport, vehicle) when RTV + disposed; **Close** button uses the gate and shows the shortfall reason when refused. |
| JC op card `jc-op-card.tsx` | §6 breakup rows from `v_nc_op_breakup`: NC raised · Under rework · Under repair · Sent to vendor · Received – QC pending · Scrap · Closed. |
| JC detail | Recovery children listed under the parent; a recovery JC shows a banner "Rework of IN-JC-… Op n — NC …" linking both. |
| DC detail/list | "NC" reference and reason when `nc_id` set. |

## 9. Audit actions (interlock 8)

`NC_DISPOSE` (existing, now includes qty and split), `NC_SPLIT`, `NC_CREATE_DC`, `NC_RTV_RECEIVED`, `NC_RECOVERY_QC`, `NC_CLOSE` (manual), `PO_RECEIVED_ADJUST`, plus the existing `CREATE JobCard` for the child.

## 10. Out of scope (kept as-is)

`use_as_is`, `make_fresh`, the legacy in-route rework rows, CAPA linkage, debit notes.
