# PARITY — Purchase (full sidebar section)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`, Purchase sidebar block.
> **Goal:** map every legacy `render*` under Purchase, identify React gaps, and build 1:1 (per session goal 2026-05-31).

---

## Inventory

| # | Legacy item | Legacy fn (line) | React route | Status after this build |
|---|---|---|---|---|
| 1 | Purchase Requests | `renderPurchaseRequests` (search L6217) | `/purchase-requests` | ✅ existing + `pr_type` enum added 2026-05-31 |
| 2 | Purchase Orders | `renderPurchaseOrders` L25209 | `/purchase-orders` | ✅ existing + Draft/Approve/Reject flow shipped 2026-05-31 |
| 3 | **Outsource Jobs** | `renderOutsourceJobs` L27044 | `/outsource-jobs` | **✅ NEW 2026-05-31** |
| 4 | OSP DC | `renderOspDC` L27243 | `/delivery-challans` | 🟡 Partial — outward + receive already shipped; tabbed view-modal style not ported (DELTA accepted) |
| 5 | **Service PO** | `renderServicePO` L27504 | `/service-pos` + `/service-pos/new` + `/service-pos/$id` | **✅ NEW 2026-05-31** |
| 6 | Vendors | `renderVendors` L27734 | `/vendors` | ✅ existing |
| 7 | **Supply Chain Dashboard** | `renderSCDashboard` L16790 | `/sc-dashboard` | **✅ NEW 2026-05-31** |
| 8 | Purchase Reports | `renderDeptReport('purchase')` L20029 | `/reports?group=Purchase` | ✅ via generic Reports module |

Sidebar Purchase block now contains 8 entries grouped Entry / Master / Report, matching legacy.

---

## Migrations landed

- `0048_phase8_po_approval_pr_type.sql` — adds `purchase_orders.{rejected_by, rejected_at, rejection_reason}` + new `pr_type` enum + `purchase_requests.pr_type` column (backfilled to `'jw_osp'` for PRs that came from a JC op).
- `0049_phase8_service_pos.sql` — new `service_pos` + `service_po_lines` tables + 3 enums (`service_po_status`, `service_po_cost_center`, `service_po_tax_type`).

Both applied to dev DB.

---

## Per-item details

### 2. Purchase Orders — Draft/Approve/Reject flow (audit task from ADR-036)

- `createPurchaseOrder` now reads `approval_config.po_approval` and sets the initial status to `'draft'` if approval is on, else `'open'`. Legacy `_poInitialStatus()` parity.
- New endpoints: `POST /purchase-orders/:id/approve` (optional remarks) and `POST /purchase-orders/:id/reject` (required reason).
- Eligibility: caller must be admin OR in `approval_config.po_approvers`. Manager-tier amount-limit gate from legacy `_isPoApprover` is **deferred** — would need PO subtotal × tax math at approve time.
- Reject flips status `'draft' → 'cancelled'` and stamps `rejected_by/at/reason`. Approve flips `'draft' → 'open'` + `approved_by/at/remarks`.
- Activity log: `APPROVE` / `REJECT` rows scoped to the PO code (feeds the Approval Configuration's recent-activity panel).
- Web: PO detail page shows green Approve + red Reject buttons when `status==='draft'` AND the caller is an approver. Each opens its own modal with sensible payload.

### 3. Outsource Jobs (NEW)

- New page `/outsource-jobs` mirroring legacy `renderOutsourceJobs` L27044.
- Filter chip + SO filter + paginated table of every PR with `pr_type='jw_osp'`.
- Multi-select checkboxes on `open` / `approved` rows → "Create JW PO from N selected" button opens a modal that:
  - Lets admin/manager choose one vendor for the whole batch
  - Renders one line per selected PR with editable rate (default = PR.estCost)
  - Calls `POST /purchase-orders/from-pr-batch` (new endpoint) that creates one PO header + one line per PR + stamps every PR `status='po_created'` + emits one `CREATE Purchase Order` activity row plus one `PR_CONVERT Purchase Request` row per PR.
- DELTA: legacy auto-generates OSP PR when an OSP-named JC op is started (`_autoGenerateOspPR` L13302). That trigger is NOT ported — for now, OSP PRs are created via the standard PR creation flow or the SO/JW Planning workflow. The Outsource Jobs page surfaces every PR with `pr_type='jw_osp'` regardless of origin.

### 5. Service PO (NEW)

- New module: `service-pos` + `service-pos/new` + `service-pos/$id`.
- New tables: `service_pos` (header) + `service_po_lines` (multi-line).
- 9 verbatim expense heads from legacy `_spoExpenseHeads` L27502.
- Create flow: admin/manager fills header (date / vendor / expense head) + chooses cost center (`'so'` or `'general'`) + adds N lines + picks tax (`'sgst_cgst'` or `'igst'`) + gst% → totals auto-calculate. Two save modes: "Save Draft" (status `'draft'`) or "Save & Submit for Approval" (status `'pending'`).
- Detail page: admin sees an Approve button on `'pending'` rows. Approve flips `'pending' → 'approved'` and stamps `approved_by/at`.
- Statuses match legacy: draft / pending / approved / completed / cancelled.
- Soft delete for admin via DELETE endpoint.
- DELTA: legacy print template (`_spoPrint` L27704) NOT ported. Would slot into the existing print-templates infrastructure (Phase F) as a separate slice.

### 7. Supply Chain Dashboard (NEW)

- New page `/sc-dashboard` reading a single `GET /sc-dashboard` aggregation endpoint.
- Sections: 9 summary cards (open/partial/closed/cancelled PO counts + order/received/pending value + GRN total/today) · by-vendor table (50 rows max) · by-SO table · complete PO summary (header+lines with tax computed for grand total) · pending PO lines (200 rows max) · recent GRN (8 rows).
- All aggregations done in SQL — no full PO list pulled to the browser.
- Read-only; no filter chips wired yet (DELTA — legacy has vendor/item/SO chip filters on the pending-lines table; can add when feedback arrives).

---

## Open DELTAs (intentional, recorded for the audit pass)

1. **PO approver amount limit** — `approval_config.po_manager_limit` + `users.approval_limit` columns exist, but the approve endpoint doesn't enforce them yet. Adding the gate requires summing PO lines × applicable tax at approve time.
2. **Auto-generate OSP PR on JC op start** — legacy `_autoGenerateOspPR` L13302 + `_isOspOperation` L13295. Triggered from op-entry; would need the op-entry create endpoint to consult `osp_processes` and conditionally insert a JW_OSP PR (+ optional draft PO).
3. **Service PO print template** — legacy `_spoPrint` L27704 builds its own HTML window. Defer to print-templates Phase F when an invoice/SPO template is added.
4. **SC Dashboard client-side filters** — legacy lets you filter the pending-lines section by vendor/item/SO. Backend already returns the full list; web wiring is a small follow-up.
5. **OSP DC tabbed view-modal** — legacy renders OSP DC with `Create | Outward Register` tabs in one screen; ours is a standalone delivery-challans module. Functional equivalence — UI shape DELTA.

---

## Build summary

Sidebar Purchase section now contains 8 entries grouped Entry / Master / Report, all 7 legacy `render*` targets mapped (Outsource Jobs / Service PO / SC Dashboard newly built; PR / PO / Vendors / Delivery Challans existing; Reports via generic module).

Two new migrations applied. Five new API endpoints (`POST /purchase-orders/:id/approve` + `/reject` + `/from-pr-batch`, `GET /sc-dashboard`, full CRUD on `/service-pos`). Three new shared schemas (`service-po`, `sc-dashboard`, plus PR type additions). Three new web modules (`outsource-jobs`, `service-pos`, `sc-dashboard`) plus Approve/Reject UI on the PO detail page.

All three packages typecheck + lint clean.
