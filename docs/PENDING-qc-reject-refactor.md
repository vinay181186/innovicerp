# PENDING — "Reject only at Incoming QC" refactor

> Working note for the multi-phase change that moves the OK/reject decision for
> received goods OUT of any receive step and entirely INTO Incoming QC, where a
> reject raises a defect record (NC). Terminology: the good qty is **"Accept"**,
> never "OK". See ADR-082 in DECISIONS.md.

## The rule
At receive, the user enters **received qty only**. Everything received lands on
a GRN as **pending QC**. **Incoming QC** decides **Accept / Reject**, and a
**Reject raises a defect record (NC)** — for both job-work returns and raw
material.

## DONE (committed)
- **Chunk 1 — Incoming QC raises a defect on reject (job-work).**
  `apps/api/src/modules/incoming-qc/service.ts` — `submitIncomingQc` now calls
  `autoCreateNcFromQcReject` when `rejectedQty > 0` and the GRN line traces back
  to a jc_op with a job card. Mirrors production QC (`op-entry` submitQcLog).
- **Chunk 2 — remove reject from OSP Delivery Challan receive.**
  Receive screen is received-only; the old gate-defect code is deleted (which
  also erased the ADR-081 dual-lane split-job missed-NC bug). Files:
  `delivery-challans/routes/receive.tsx`, `packages/shared/.../delivery-challan.ts`,
  `delivery-challans/service.ts`, `delivery-challans/receipt-cascades.ts`, tests.

## PENDING

### Phase 1 (no schema change)
- [ ] **Chunk 3 — Manual/PO GRN create → pending only.** `createGoodsReceiptNote`
  (`goods-receipt-notes/service.ts:589-613`) currently writes payload
  `qcStatus/qcAcceptedQty/qcRejectedQty` and stamps `qcInspectedBy` when
  `completed` — allowing accept/reject AT CREATE (bypasses Incoming QC). Force
  every created line to `pending` / 0. Remove the QC Status / QC Accepted /
  QC Rejected inputs from the create form
  (`goods-receipt-notes/components/goods-receipt-note-form.tsx:492-521`).
  Schema `goods-receipt-note.ts:140-159` — decide whether to drop the QC fields
  from the CREATE line input (check the UPDATE path doesn't share it).
- [ ] **Chunk 4 — Legacy JW Delivery Challan INWARD** (`jw-dc`, module B).
  Inward captures `okQty` + `rejectedQty` (`jw-dc/service.ts:1053-1097`,
  form `jw-dc/routes/list.tsx:973-1064`, CHECK `jw_dc_inward_lines_split_total`
  `0032_phase8_jw_dc.sql:233`, refine `jw-dc.ts:164`). DECISION NEEDED: change it
  to received-only, OR retire the legacy `/jw-dc` module (it duplicates the OSP
  `/delivery-challans` path — see the earlier "two DC modules" finding).
- [ ] **Chunk 5 — Tests + docs** for chunks 3–4.

### Phase 2 (schema change — raw-material / vendor defect records)
- [ ] **Chunk 6 — Schema:** make `nc_register.job_card_id` NULLABLE (currently
  NOT NULL, `schema.ts:1758`); add nullable `grn_line_id` (+ optionally
  `purchase_order_line_id`, `vendor_id`); add CHECK `job_card_id IS NOT NULL OR
  grn_line_id IS NOT NULL`. Drizzle migration + update `docs/SCHEMA.md`.
- [ ] **Chunk 7 — Raw-material NC on Incoming-QC reject:** a new
  `autoCreateNcFromRawMaterialReject` cascade deriving item/vendor/GRN from the
  GRN line (no JC), called from `submitIncomingQc` when the line has no source
  jc_op. Relax `createNcRegisterInputSchema.jobCardId` to optional.
- [ ] **Chunk 8 — Disposition whitelist:** a raw-material NC (no job card) may
  only use **scrap** / **return_to_vendor**; hide rework / make_fresh /
  use_as_is (`dispose-nc-panel.tsx`, cascade guards `nc-register/cascades.ts`).
- [ ] **Chunk 9 — Tests + docs** + finalize ADR-082 consequences.

### Also flag (out of the current scope — verify separately)
- [ ] **GRN-detail-page QC edit path** (`updateGoodsReceiptNote`) may be a
  SECOND QC write surface besides Incoming QC. If it records rejects, confirm it
  also raises an NC (same gap). Consolidate on Incoming QC if possible.
- [ ] **`client_material_qty` mandatory on JWSO create** + the Party-GRN
  quantity hard-block (the ORIGINAL request that started this thread — ADR-082
  scope note). Not started; separate from the reject-refactor above.

## Verification still owed
- Integration tests (`delivery-challans`, `incoming-qc`) were UPDATED to match
  the new behavior and typecheck + lint clean, but were **NOT executed** — this
  environment has no test-DB connection (`.env.local` DATABASE_URL is a
  placeholder). Run `pnpm --filter api test` against a real test DB.
- Playwright e2e for the new receive → Incoming-QC → NC flow: to be supplied.
