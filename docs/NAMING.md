# NAMING.md — one name, one meaning

> Audit date: 2026-09-23. Triggered by the `CPO` → `POL` fix, which found one concept
> under four labels and one label covering two concepts.
>
> **The rule:** every fact below has exactly ONE screen label and ONE field name.
> A name in the "never" column is a defect, not a synonym. Re-reading this file must
> give the same answer every time — that is the point of it.

---

## A. Canonical dictionary — facts

| Fact                            | Screen label                               | Field name                        | Source of truth                                                    | Never call it                                                                         |
| ------------------------------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Item's code                     | `Item Code`                                | `itemCode`                        | `items.code`                                                       | `partNoText`, `childItemCode`, bare `code` outside Item Master                        |
| Item's code, snapshot           | — (fallback only)                          | `itemCodeText`                    | the line's own column                                              | reading the snapshot when the live join exists                                        |
| Item's name                     | `Item Name`                                | `itemName`                        | `items.name`                                                       | `partName`, `itemNameText`, `partText`, `description`                                 |
| **Customer's drawing revision** | never shown alone — only inside `CODE/REV` | `itemRevision`                    | `sales_order_lines.revision`, else `job_work_order_lines.revision` | bare `Rev`, `soLineRevision`, `jwLineRevision`, `currentRevision`, `lineRevisionText` |
| Item master's own revision      | `Item Master Rev` (or not shown)           | `revision` on the item            | `items.revision`                                                   | anything labelled just `Rev` on a shop-floor document                                 |
| Route card's version            | `Route Card Rev`                           | `currentRevision`                 | `route_cards.current_revision`                                     | bare `Rev`                                                                            |
| BOM's version                   | `BOM Rev`                                  | `revision` (integer)              | `bom_masters.revision`                                             | bare `Rev`                                                                            |
| Design's version                | `Design Rev`                               | `revision` (integer)              | `design_tracker.revision`                                          | bare `Rev`                                                                            |
| **Customer's PO line number**   | `POL`                                      | `clientPoLineNo`                  | `sales_order_lines.client_po_line_no`                              | `CPO`, `CPO Ln`, `Client PO Ln`, `PO Line#`, and never our `lineNo`                   |
| Customer's PO number            | `Client PO No.`                            | `clientPoNo`                      | `sales_orders.client_po_no`                                        | `CPO`                                                                                 |
| Our line number on the order    | `Ln` / `#`                                 | `lineNo`                          | `sales_order_lines.line_no`                                        | `POL`                                                                                 |
| Qty ordered on a line           | `Ordered`                                  | `orderQty`                        | `<doc>_lines.order_qty`                                            | `qty` on an order line; `planQty` for the same fact                                   |
| Qty on a purchase-side line     | `Qty`                                      | `qty`                             | `purchase_order_lines.qty` etc.                                    | `orderQty`                                                                            |
| Qty passed inspection           | `Accepted`                                 | `qcAcceptedQty`                   | `goods_receipt_note_lines.qc_accepted_qty`                         | `acceptedQty`, `okQty`                                                                |
| Qty free to use now             | `Available`                                | `availableQty`                    | computed — state the grain in the field's comment                  | `available`                                                                           |
| Date a thing is wanted by       | `Due Date`                                 | `dueDate`                         | `<doc>.due_date`                                                   | `targetDate`, `requiredDate`                                                          |
| Person who did it (id)          | —                                          | `createdBy` / `updatedBy`         | `<table>.created_by`                                               | `userId`, `enteredBy`                                                                 |
| Person's name (snapshot)        | `By`                                       | `<role>Name`, e.g. `operatorName` | `<table>.<role>_name`                                              | `…Text` for a person                                                                  |
| The buyer                       | `Customer`                                 | `clientId` / `clientName`         | `clients`                                                          | `Client` as a screen label                                                            |
| The seller to us                | `Vendor`                                   | `vendorId` / `vendorName`         | `vendors`                                                          | `Supplier`, `Party`                                                                   |

**Snapshot rule.** `xxxText` means "the value as it was, when the live row may be gone".
It is only ever a fallback: read `xxx ?? xxxText`, never the snapshot alone. A `xxxText`
with no live `xxx` to fall back from is a defect (see C-9).

---

## B. Canonical dictionary — documents

Majority code scheme: **`IN-<ABBR>-#####`** — `IN-` prefix, uppercase abbreviation,
one hyphen, five zero-padded digits.

| Document                         | Label                           | Code                                                | Conforms                                              |
| -------------------------------- | ------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Sales Order                      | `SO`                            | `IN-SO-#####`                                       | yes                                                   |
| Job Work Sales Order             | `JWSO`                          | `IN-JW-#####`                                       | prefix disagrees with the label                       |
| Job Card                         | `JC`                            | `IN-JC-YY-#####`                                    | extra year segment; only series that resets yearly    |
| Plan                             | `PLN`                           | `PLN-####`                                          | no `IN-`, 4 digits                                    |
| **Production Order**             | `Production Order` — never `PO` | `IN-PRO-#####`                                      | yes                                                   |
| **Purchase Order (to a vendor)** | `PO`                            | `IN-MPO/JWPO/OPO/SPO-#####`                         | 4 live prefixes for one document                      |
| Purchase Request                 | `PR`                            | `IN-PR-#####` (`IN-JWPR-` when raised by an OSP op) | yes                                                   |
| GRN                              | `GRN`                           | `IN-GRN-#####`                                      | yes                                                   |
| Delivery Challan                 | `DC`                            | `IN-DC-#####`                                       | shares its series with the NC return challan          |
| JW Delivery Challan              | `JW DC`                         | `JWDC-OUT-####` / `JWIN-####`                       | no `IN-`, and the two directions use different shapes |
| Non-Conformance                  | `NC`                            | typed by hand; auto ones `NC-AUTO-…`                | no series                                             |
| CAPA                             | `CAPA`                          | `CAPA-####`                                         | no `IN-`, 4 digits                                    |
| Invoice                          | `INV`                           | `INV-####`                                          | no `IN-`, 4 digits                                    |
| JW Invoice                       | `JW Invoice`                    | `IN-JWINV-#####`                                    | yes                                                   |
| Customer Dispatch                | `DSP`                           | `DSP-####`                                          | no `IN-`, 4 digits                                    |
| Route Card                       | `RC`                            | `IN-RC-#####`                                       | yes                                                   |
| BOM                              | `BOM`                           | `BOM-####`                                          | no `IN-`, 4 digits                                    |
| Store Issue / Tool Issue         | `ISS` / `TIS`                   | `ISS-#####` / `TIS-#####`                           | no `IN-`                                              |
| Party GRN                        | `PGRN`                          | `PGRN-#####`                                        | no `IN-`, while its sibling GRN has it                |
| Design Tracker                   | `DSN`                           | `DSN-####`                                          | no `IN-`, 4 digits                                    |
| Task                             | `TSK` / `TODO`                  | `TSK-####` / `TODO-####`                            | two prefixes for one document                         |

---

## C. What is still ambiguous — ranked, with the verdict

Every row is a decision waiting to be taken. None is fixed yet.

| #   | Fault                                                                                                                                                                                                          | Evidence                                                                                                                                                          | Verdict                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **`Rev` labels four different facts on screen** — customer drawing rev, route card version, BOM version, design version                                                                                        | `sales-orders/components/so-drawing-history.tsx:177`, `route-cards/routes/list.tsx:193`, `bom-master/routes/detail.tsx:290`, `design-tracker/routes/list.tsx:152` | Ban the bare word. Use `Rev` ONLY inside `CODE/REV`; everywhere else say which revision it is |
| 2   | **`revision` names six facts in the contracts** — SO line, JWSO line, item master, BOM counter, BOM log row, `/R` code suffix                                                                                  | `sales-order.ts:64`, `job-work-order.ts:55`, `item.ts:19`, `bom-master.ts:31`, `bom-master.ts:74`, `doc-number.ts:100`                                            | Keep `revision` only on the row that OWNS it. Anywhere it is joined in, it is `itemRevision`  |
| 3   | **`date` names six facts**, each aliased off a differently-named column                                                                                                                                        | `customer-dispatch.ts:123`, `daily-report.ts:53`, `job-card.ts:450`, `so-timeline.ts:29`, `so-qc-status.ts:95`, `global-search.ts:135`                            | A field called `date` is banned. Name the event: `dispatchDate`, `jcDate`, `qcPassDate`       |
| 4   | **`Client` and `Customer` both label the same entity** — 8 screens vs 9                                                                                                                                        | `sales-orders/components/sales-order-form.tsx:728` vs `so-overview/routes/list.tsx:284`                                                                           | Pick `Customer` on screen; `client*` stays the field name                                     |
| 5   | **One column, two contract names** — `qc_accepted_qty` ships as `acceptedQty` on one screen and `qcAcceptedQty` on another                                                                                     | `apps/api/src/modules/incoming-qc/service.ts:403` and `:526`                                                                                                      | `qcAcceptedQty` wins; it says which acceptance                                                |
| 6   | **`availableQty` names four different balances** — OSP-ready, stock free, SO-line free, client material left                                                                                                   | `op-entry.ts:431`, `store-inventory.ts:21`, `so-planning.ts:149`, `job-card.ts:491`                                                                               | Legal only with the grain stated; prefer `ospAvailableQty`, `freeStockQty`, etc.              |
| 7   | **`orderQty` names four quantities** — SO line, plan's view of it, JC batch, production order (which is really `plan_qty`)                                                                                     | `sales-order.ts:71`, `plan.ts:76`, `job-card.ts:293`, `production-order.ts:64`                                                                                    | Rename the JC one `batchQty` and the production-order one `planQty`                           |
| 8   | **Item name has three DB columns** — `item_name`, `part_name`, `item_name_text`                                                                                                                                | `schema.ts:1468`, `:1816`, `:2461`                                                                                                                                | No migration. Every contract exposes it as `itemName`                                         |
| 9   | **`…Text` snapshots with nothing to fall back from** — `rawMaterialGradeText`, `rawMaterialSizeText` (14 uses each), `partText`                                                                                | `route-card.ts:54`, `design-project.ts:139`                                                                                                                       | Drop the suffix — they are plain values, not snapshots                                        |
| 10  | **JWSO is labelled JWSO but numbered `IN-JW-`**                                                                                                                                                                | `job-work-orders/service.ts:143`                                                                                                                                  | Leave live codes alone; new series only                                                       |
| 11  | **The NC return-to-vendor challan draws from the DC series** — two documents, one number line                                                                                                                  | `nc-register/service.ts:1530`                                                                                                                                     | Acceptable only if it is truly the same document type. Decide and write it down               |
| 12  | **Two whole contracts are dead** — `qc-dashboard.ts` (no route serves it; the QC Command screen says it stopped using `/qc-dashboard`) and `service-po.ts` (table `service_pos` exists, no service touches it) | `packages/shared/src/schemas/`, `apps/web/src/modules/qc-command/routes/index.tsx:5`                                                                              | Delete, or mark planned with a date                                                           |
| 13  | **`POL` also names a vendor-PO-line link in code**                                                                                                                                                             | `jc-op-po-line.ts:3`                                                                                                                                              | Rename that one `outsourcePoLineId`. On screen `POL` is the customer's line, always           |

Not faults, recorded so they are not re-raised: `PO` reads ambiguously in code comments
but the Production Orders screen says "Production Order No" in full; `WO` is not an entity
at all and survives only in the co-label "SO / WO"; `FI` appears nowhere — the system spells
out "Final Inspection".

---

## D. How to add a name

1. Look for the fact in section A or B. If it is there, use that name. There is no second
   name for it.
2. If it is not there, add a row to A or B in the same commit as the code.
3. A label may be shortened only if the short form is unique across the whole app.
   `POL` qualified; `Rev` does not.
