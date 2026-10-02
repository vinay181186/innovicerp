# ADR-203 — JWSO structure (build spec)

Owner decisions 2026-10-02: D1 customer material is **1 Nos per finished part**
(quantities stay whole numbers; caps in pieces are correct) · D2 suffix **`-RM`**
(upper case) · D3 rejected customer material is **tracked and returned** · D4
**Incoming QC is a separate step** (qc_incoming permission) · D5 foundations first.
Plus: RM is found/created **silently** when a line's item is picked (no popup),
**reused** whenever the item code matches (any customer); RM item = same name,
UOM NOS, Party Supplied Material, ₹0; customer = the JWSO's customer.

Already done (frozen — do not redesign):
- Migration `0193_jwso_structure.sql` + `apps/api/src/db/schema.ts`
- Shared contract (`packages/shared`): job-work-order.ts, party-grn.ts,
  party-material.ts, party-material-issue.ts, customer-material-return.ts (new),
  enums/item-type.ts (`-RM`, `rmCodeForItemCode`)
- `apps/api/src/lib/jw-rm.ts` — `ensureRmItemForOrderItem`, `ensurePartyMaterial`
- `apps/api/src/lib/jw-line-state.ts` — `lockJwLine`, `assertJwLineOpenForWork`,
  `recomputeJwHeaderStatus`, `jwLineUsage`
- DocSeries now has `party_materials`, `customer_material_returns`.

## Server rules (by module)

### JWSO (job-work-orders, prod-jw-list)
1. **RM per line.** On create AND update, for every live line: `ensureRmItemForOrderItem(line.itemId)`
   then `ensurePartyMaterial(rmItemId, header.clientId)`; write `rm_item_id`,
   `party_material_id`. Errors propagate (whole save fails). Delete
   `bridgeClientMaterialToPartyStore` and stop writing `client_material(_qty)`.
   Every OTHER code path that inserts JWSO lines (BOM cascade, SO→JW conversion,
   import) must do the same — grep `insert(jobWorkOrderLines)`.
2. New route `POST /job-work-orders/rm-item` (`ensureJwRmItemInputSchema` →
   `EnsureJwRmItemResponse`), gate `requireFormAccess(user,'jw_create','entry')`.
3. Lines: `itemId` required and must be a live master item that is NOT partyOwned.
   `item_code_text` = master code snapshot. Unknown line `id` → ValidationError.
   Line status is server-owned (ignore any). New line number = MAX(line_no incl.
   deleted)+1, never reused. `dueDate` per line, `null` clears. `material`,
   `drawingNo`, header `clientPoNo`, `remarks`: `null` clears.
4. Lines in use (`jwLineUsage`): cannot be removed (refuse with the doc list,
   point to Short-close); `itemId`, `uom`, `sourceBomMasterId` cannot change;
   header `clientId` cannot change if ANY line is in use. `orderQty` ≥
   max(returned_qty, invoiced_qty, Σ live non-recovery JC order_qty on the line).
   Lock updated lines `FOR UPDATE`.
5. Delete JWSO: refuse if any line is in use.
6. Create: header status always 'open'. dueDate ≥ jwDate.
7. After every update / short-close: `recomputeJwHeaderStatus`. Short-close:
   lock line (`lockJwLine`), refuse if already closed or fully returned.
8. Reads: list/get/related require `jw_create` view; prod-jw-list its own key's
   view (find it in nav). Create/update RESPONSES pass the same money mask as
   get (`priceVisible:false`). Create ignores rate/gst for price-blind users.
9. Read shape: each line gets `rmItemId/rmItemCode/partyMaterialId/
   partyMaterialCode/rmAcceptedQty/inUse`. `partyReceivedQty` (detail + list) =
   Σ accepted_qty by jw_line_id; list adds `rmRequiredQty` = Σ order_qty of lines
   with an rm. Search also matches rm item code.
10. prod-jw-list: exclude recovery JCs, cap done per line, apply search to count,
    escape LIKE, real due date (MIN line due).

### Party side (party-grn, party-materials, party-material-issues, party-stock-ledger, lib/party-stock-ledger)
1. **Party GRN create**: lines `{jwLineId, receivedQty, remarks}`. Lock each line
   (`lockJwLine`), `assertJwLineOpenForWork(line,'receive customer material')`,
   line must belong to the GRN's JWSO and have `party_material_id` (else
   "Ln N has no customer RM — open and save the JWSO first"). Write
   `party_material_id` from the line, `jw_line_id`, accepted=rejected=0, qc_at null.
   NOTHING enters the register at create. Cap: Σ received (all GRN lines on the
   line, minus rejected that QC returned? no—) keep it simple: Σ accepted + Σ
   pending-QC received on the line + this ≤ order_qty (rejects don't use up the
   order). Header lock: none needed beyond line lock.
2. **Party GRN QC** — new route `POST /party-grn/:id/qc` (`partyGrnQcInputSchema`),
   gate `requireFormAccess(user,'qc_incoming','entry')`. Per line: must be pending
   (qc_at null) — conditional UPDATE `WHERE qc_at IS NULL` (§20.2); accepted +
   rejected = received; reason if rejected; lock the JWSO line and re-check
   Σ accepted ≤ order_qty; set accepted/rejected/reason/qc_by/qc_at; post
   `receive` (in) for accepted with `jwLineId`; bump `party_materials.received_qty`
   by accepted.
3. **Party GRN cancel**: lock header `FOR UPDATE` and re-check `deleted_at IS NULL`
   (no double cancel). Refuse if any rejected pieces were already returned
   (rejected_returned_qty > 0) or the line's register balance can't cover the
   reversal. Reversal rows carry `jwLineId`. Remove `GREATEST(…,0)` clamps — a
   counter going negative must throw.
4. **Party materials master**: create requires `itemId` of type
   party_supplied_material + clientId; code via `lockDocSeries('party_materials')`
   (server-assigned; ignore client code). Update: clientId/itemId/uom refused
   when any ledger row exists; only changed fields written. Delete: `FOR UPDATE`,
   refuse with stock or ledger rows. Remove `returnPartyMaterial` (+ route) — the
   Customer Material Return replaces it. Delete `ensurePartyMaterialForClientItem`
   and the old `partyMaterialFitsJwLine` (material is now the line's).
   Reads gated `party_create` view (also party-grn, party-stock-ledger reads).
5. **Issue to JC**: JC must have `source_jw_line_id`, no `recovery_kind`; lock the
   JW line; `assertJwLineOpenForWork(line,'issue customer material')`; material =
   line.party_material_id (if input sends one it must match); write `jw_line_id`.
   Per-line cap = Σ accepted(line) − Σ issued(line) + Σ returned_to_store(line) −
   Σ good returned to customer(line). Per-JC cap: issued to JC − returned_to_store
   ≤ JC order_qty. Ledger row with `jwLineId`.
6. **Issue cancel**: reversal carries `jwLineId`; "used" = Σ first-op (qty +
   reject_qty); refuse if issue.returned_to_store_qty > 0. No clamps.
7. **Return to store** — new route `POST /party-material-issues/:id/return-to-store`
   (`returnPartyMaterialIssueToStoreInputSchema`), gate party_create entry. Lock
   the issue row; cap = qty − returned_to_store − max(0, used(JC) − (Σ other live
   issues to that JC net of their returns)) — i.e. never return pieces the JC
   already consumed; post `reversal`/in with jwLineId, sourceDocType
   'party_material_issue_return'; bump returned_to_store_qty; lower
   party_materials.issued_qty.
8. **Customer Material Return** — new module `customer-material-returns`
   (routes/service), schemas in shared. Code `IN-CMR-#####` with
   `lockDocSeries('customer_material_returns')`. create: party_create entry;
   JWSO must be the lines' JWSO; per line lock JW line; kind good → cap at
   the line's register balance (accepted − issued + returned_to_store − good
   returned) and post `return`/out with jwLineId, bump party_materials.returned_qty;
   kind rejected → party_grn_line must be on that jw line, QC done, cap
   rejected − rejected_returned; bump rejected_returned_qty (conditional UPDATE
   with the cap in WHERE). Cancel: edit+approve, conditional status update,
   reverse every line (reversal/in for good; lower rejected_returned_qty).
   Endpoint `GET /customer-material-returns/returnable?jobWorkOrderId=` →
   `CustomerMaterialReturnableRow[]`. List + detail. History (ADR-197) like
   party-grn does.
9. Ledger screen labels: add 'party_material_issue_return',
   'customer_material_return'.

### Outward + production (jw-returns, jw-invoices, job-cards, op-entry, reports, sales-orders, purchase-requests, lib/stock-ledger)
1. JC create from a JW line: `lockJwLine` + `assertJwLineOpenForWork(line,'raise a Job Card')`
   before the balance sum. JC source list: only open, not short-closed lines of
   non-cancelled JWSOs (header open).
2. JC delete refused while live party_material_issues exist on it; JC qty edit
   floor = max(done, Σ issued − returned_to_store).
3. op-entry legacy gate + reports/jwso-balance + JWSO badge: Σ accepted_qty by
   `jw_line_id` (never received_qty, never jw_line_no_text).
4. JC customer-material panel: per-JC Needed (= JC qty, 1 piece per part) /
   Issued (to this JC) / Returned to store / Used (first op qty+reject) / On JC;
   plus the line's register figures labelled as line totals.
5. JW Return: create `requireFormAccess('jw_create','entry')` (keep role check
   only if it is the module convention — form access is the rule), cancel needs
   edit+approve; validate id param; JC on the challan must be on that line;
   after create/cancel call `recomputeJwHeaderStatus` (delete the local flip).
6. JW Invoice: create and cancel use one key (`invoice_create`? check nav for
   the JW invoice page's formKey and use that for both); `rate` input ignored
   unless the user can see the JW price.
7. sales-cascade: replace the local header-close with `recomputeJwHeaderStatus`.
8. partyOwned items refused: SO lines, PR lines, `postStockMove` (company stock).

## Screens
- JWSO create/edit per `JWSO-Create-Workflow-Mockup.html` (repo parent folder):
  header without material; lines table gets a "Customer RM" column showing
  `ABCD123-RM ✓` (and a small "new" chip when the ensure call created it);
  picking an item calls `POST /job-work-orders/rm-item` silently. Per-line Due
  Date column (header Due Date = "apply to all" helper). Show stored `lineNo`.
  Lines with `inUse` lock Item/UOM/BOM and disable Remove (tooltip names why).
  Send `null` for cleared fields. Money hidden when `priceVisible === false`.
- JWSO detail: Customer RM column per line + accepted qty.
- Party GRN modal: pick JWSO → its open lines with their RM; enter Received
  only. List shows QC status (pending lines). Row ⋯ "Incoming QC" (qc_incoming
  entry) opens a QC modal (accepted / rejected / reason per pending line).
- Party material master: create needs an `-RM` item; edit locks customer/item/UOM
  when it has movements; remove the old "Return" action.
- Issue modal: pick JWSO → JC → material shown read-only from the line; row ⋯
  "Return to store" on an issue.
- New page "Customer Material Return" (store dept, party_create) — list + create
  modal (pick JWSO → returnable rows, good + rejected) + cancel + print on the
  Innovic Sheet (`sheet-print.ts`).
- JC customer-material panel per-JC figures.

## Naming (docs/NAMING.md — update in the same commit)
Customer RM (Item -RM) · `rmItemId` · `job_work_order_lines.rm_item_id`;
Customer Material Return · `IN-CMR-#####`; Returned to Store (issue);
Rejected Returned; Incoming QC (party GRN) pending.
