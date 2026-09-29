# Store redesign (ADR-193) — requirements, API design, paper tests, fixes

Status: design v2 (after paper tests) · 2026-09-28 · source: "Store Department Audit - Innovic vs ERPNext.pdf"
findings 1–22 + owner decisions (Excel v2, chat 2026-09-28).

## 0. Owner decisions (inputs)

| #   | Decision                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Opening stock / periodic counts: Store counts, Store In-charge approves; Excel upload allowed.                                               |
| Q2  | Item type is chosen in Item Master **at item creation**: Raw Material / Component / Assembly / Consumable / Tool-Instrument.                 |
| Q3  | Assembly: **store issues parts against the SO; "Complete" only checks issued parts, does not deduct them again, adds the finished machine.** |
| Q4  | Instruments tracked **one by one by serial no.** (calibration); Store In-charge (approve tier) approves write-offs.                          |
| Q5  | Consumables: reorder level + reorder qty, low-stock alert, **one-click** PR (not automatic).                                                 |
| Q6  | Shop-floor requests: **later** (not in this round).                                                                                          |
| —   | Every other finding: "do as suggested".                                                                                                      |

## 1. Requirements

R1 One stock ledger, locked lines; every store movement names its own source type.
R2 Quantities may be decimal (3 places) for KGS / MTR items; NOS / SET stay whole numbers.
R3 Item type chosen on create; type-driven behaviour (tool → register, consumable → reorder, raw_material → JC material).
R4 Stock Count document (opening + periodic): many lines, Excel upload, second-person approval, posts differences.
R5 Material issue header + lines, "Issue Against": Job Card / Assembly SO / General. Picked, not typed. Capped at Balance.
R6 Return-to-store of any part qty; whole-slip reverse only while nothing was consumed.
R7 Material required per JC (Route Card RM item + qty per piece) and per assembly SO (BOM × units); Material view on JC and SO.
R8 Assembly Complete consumes issued parts (no second ledger deduction); refuses when a part is short.
R9 Instrument register (serial, calibration due, status); tool issue to an Operator; calibration-overdue refused; Lost / Damaged write-off with approval; cancel; activity log.
R10 Reorder level + qty, below-reorder alert, one-click PR (respects PR approval, ADR-189).
R11 Consumption report (item / department / operator / job / month).
R12 Gaps: JW DC permission + log; Available check on tool issue / JW DC out / adjust −; Movement Log filter; pager totals; missing logs; view permission; dead code.

## 2. Design principles applied

- **Single source of truth.** Stock only in `store_transactions` (+ trigger balance). Required qty is _derived_ (BOM × units, RM per pc × JC qty), never copied into a second table that can drift. Consumption is recorded once, where it happens.
- **One writer per concern.** All ledger rows go through one module `lib/stock-ledger.ts` (`postStockMove`) — lock item, read position, validate (whole-number UOM, no negative), insert. Every service calls it; no service inserts `store_transactions` directly.
- **Immutability / compensating entries.** Nothing posted is edited; undo = opposite entry (ADR-185 trigger stays).
- **Guard at the server, in one transaction, under a row lock** (item row for stock, SO row for assembly, issue row for returns).
- **Explicit confirmation for exceptions** (409 + `needsConfirmation` → re-post with `confirm` + reason) instead of silent overrides.
- **Open/closed for item types:** behaviour keyed on a small capability map (`ITEM_TYPE_RULES`) rather than `if` chains across screens.
- **Build it right while data is empty:** PROD has 0 issues, 0 tool issues, 0 stock — schema reshapes are cheap now.
- **Phased, each phase deployable and revertible** (one commit per phase, TEST first).
- Names from `docs/NAMING.md`; new names registered in the same commit.

## 3. Data model (v2 — after fixes in §6)

```
items
  item_type  enum += raw_material | consumable | tool        (keep component | assembly)
  reorder_qty numeric(14,3) default 0                        (min_stock_qty = reorder level, renamed on screen "Reorder Level")
  track_serial boolean default false                         (tool items: one instrument row per piece)

store_transactions.qty / stock_before / stock_after  integer → numeric(14,3)
item_stock_balances.on_hand_qty                      integer → numeric(14,3)
trigger apply_store_txn_to_balance                   v_delta numeric
views v_item_stock / v_item_stock_availability       numeric (no ::integer)
store_txn_source_type += store_issue | store_return | tool_issue | tool_return | stock_count
drizzle: custom type qty() = numeric(14,3) ↔ JS number (fromDriver Number) — callers keep `number`.

route_cards / plans / job_cards
  raw_material_item_id uuid → items (nullable)   rm_qty_per_piece numeric(14,4) (nullable)
  (JC copies from plan / route card like grade/size today)

stock_counts (header)          code SC-#####, count_date, purpose opening|periodic, status draft|submitted|posted|cancelled,
                               submitted_by/at, approved_by/at (≠ creator), remarks
stock_count_lines              item_id, system_qty_at_count, counted_qty, difference (derived on post), reason, store_transaction_id

store_issues (header — reshaped; 0 PROD rows)
  code ISS-#####, issue_date, issue_against job_card|assembly_so|general,
  job_card_id, production_order_id (from JC), sales_order_id (assembly SO),
  issued_to_operator_id → operators, issued_to_text (fallback), department, purpose, remarks,
  reversed_at/by/reason (0152, kept)
store_issue_lines              issue_id, line_no, item_id, qty, returned_qty (derived), store_transaction_id
store_issue_returns            issue_line_id, return_date, qty, reason, store_transaction_id

assembly_unit_consumptions     assembly_unit_id, sales_order_id, item_id, qty, variance_reason   (NO ledger row)

instruments                    item_id (type tool, track_serial), serial_no (unique per item), status in_store|issued|in_calibration|lost|scrapped,
                               calibration_interval_days, last_calibrated_on, calibration_due_on, certificate_path
tool_issues                    + issued_to_operator_id, instrument_id (serial tools, qty 1), cancelled_at/by/reason
tool_issue_returns             + lost_qty, writeoff_status none|pending|approved, writeoff_cost, approved_by/at
```

## 4. API (v2)

All mutate endpoints: server permission check, one transaction, activity log, typed errors
(400 validation, 403 permission, 404, 409 conflict / needsConfirmation).

```
# Items
POST  /items                        { …, itemType (required), reorderQty?, trackSerial? }
PATCH /items/:id                    itemType change refused once the item has ledger rows / instruments (409)

# Stock count (form key stockcount_create; approve = Store In-charge)
POST  /stock-counts                 { countDate, purpose, lines?: [{itemId, countedQty, reason?}] }      → draft
POST  /stock-counts/:id/lines/import  (xlsx: Item Code, Counted Qty, Reason)                             → rows + per-row errors
PATCH /stock-counts/:id             { lines… }  (draft only)
POST  /stock-counts/:id/submit      → submitted; snapshots system_qty_at_count per line
POST  /stock-counts/:id/approve     (approver ≠ creator) → posted; one ledger row per line with difference ≠ 0
POST  /stock-counts/:id/cancel      { reason } (draft/submitted only)
GET   /stock-counts, /stock-counts/:id

# Material requirement (read)
GET   /material/job-cards/:id        → { planned: bool, lines:[{itemId, required, issued, returned, balance, available}] }
GET   /material/sales-orders/:id     → { units, lines:[{itemId, qtyPerSet, required, issued, returned, consumed, balanceToIssue, issuedUnused, available}] }

# Issue (form key issue_create)
POST  /store-issues                  { issueDate, issueAgainst, jobCardId? | salesOrderId?, operatorId? | issuedToText?,
                                       department?, purpose, lines:[{itemId, qty}], confirm?: {reason} }
POST  /store-issues/:id/returns      { lines:[{issueLineId, qty}], reason }
POST  /store-issues/:id/reverse      { reason }   (all lines, only if nothing consumed / returned)
GET   /store-issues, /store-issues/:id

# Assembly (existing endpoints, new behaviour)
POST  /assemblies/:soId/units        (mark assembled)  { qty, confirmVariance?: {reason} }
PATCH /assemblies/units/:id/stop     same body
POST  /assemblies/:soId/undo-last    reverses consumption rows (+ legacy ledger rows for old units)

# Tools / instruments (form key toolissue_create; write-off approve tier)
POST  /instruments, PATCH /instruments/:id, POST /instruments/:id/calibrate { calibratedOn, certificatePath }
POST  /tool-issues                   { issueDate, itemId, qty | instrumentIds[], operatorId, expectedReturnDate, purpose }
POST  /tool-issues/:id/return        { good, damaged, lost, consumed, reason (required if damaged/lost) }
POST  /tool-issues/:id/cancel        { reason } (nothing returned yet)
POST  /tool-issue-returns/:id/approve-writeoff { cost }
GET   /tool-issues/holders           → per operator: items / instruments held, overdue

# Reorder
POST  /store-inventory/reorder-pr    { itemIds[] } → one PR per item (qty = reorderQty), skips items with an open PR
Alert AL-019 "Below reorder level"   (available + On PO < reorder level, reorder level > 0)
Report material-consumption          (store_issue_lines net of returns + assembly consumptions)
```

## 5. Paper tests (API "running", v1 design) — scenario → request → result → problem

Data: IN-SO-00500 Equipment, 3 machines, BOM 4 bolt + 1 motor + 2 m cable. Stock bolt 20, motor 2, cable 10.

| #   | Scenario                                                       | Request (abridged)                                             | v1 result                                              | Problem found                                          |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------- |
| T1  | Opening count, 3 items                                         | POST /stock-counts lines bolt 20, motor 2, cable 10; approve   | posts +20, +2, +10                                     | none                                                   |
| T2  | Count entered 09:00, issue of 5 bolts at 11:00, approved 15:00 | v1 posted `counted − on-hand now` = 20 − 15 = +5               | shelf 15, ERP 20                                       | **P1** later movements double-counted                  |
| T3  | Q3 step 1                                                      | POST /store-issues assembly_so lines bolt 12, motor 2, cable 6 | ok                                                     | v1 single-item issue ⇒ 3 slips for one handover        | **P2** issue must have lines |
| T4  | Complete 2                                                     | POST units {qty 2}                                             | ok, no ledger parts                                    | none                                                   |
| T5  | Complete 3rd, motor 0 left                                     | POST units {qty 1}                                             | 409 "Motor: 1 more to issue"                           | none                                                   |
| T6  | Return 0.5 m cable **before** 3rd complete, then complete 3rd  | returns 0.5; units {qty1}                                      | 409: cable needs 2, has 1.5                            | **P3** BOM-exact consumption blocks real under-use     |
| T7  | Return 0.5 m **after** all 3 complete (6 m consumed by BOM)    | returns 0.5                                                    | 409 nothing unused (6 − 6 = 0)                         | same **P3**                                            |
| T8  | Issue cable 2.5 m                                              | lines cable 2.5                                                | DB integer ⇒ 2 or error                                | **P4** decimals needed first                           |
| T9  | Issue 2.5 NOS bolts                                            | lines bolt 2.5                                                 | accepted                                               | **P5** NOS must be whole                               |
| T10 | Issue 14 bolts (balance 12)                                    | lines bolt 14                                                  | 409 over balance                                       | ok; but genuine extra need has no path — **P6**        |
| T11 | Undo last unit made **before** this change (ledger-debited)    | undo-last                                                      | v1 removes consumption rows only; old ledger OUT stays | **P7** legacy units need ledger reversal               |
| T12 | Undo a unit whose machine was dispatched                       | undo-last                                                      | allowed                                                | **P8** must refuse (machine gone)                      |
| T13 | Reverse slip after one line was consumed by Complete           | reverse                                                        | puts all back ⇒ consumed parts double                  | **P9** reverse only if nothing consumed/returned       |
| T14 | Two users Complete the same SO at once                         | parallel POST                                                  | both pass the check                                    | **P10** lock SO row                                    |
| T15 | JC with no RM item (all legacy JCs)                            | issue against JC, bolt 5                                       | v1 409 "not in requirement"                            | **P11** unplanned JC must still accept issues (no cap) |
| T16 | Issue against a non-Equipment SO / Equipment SO without BOM    | assembly_so                                                    | v1 accepted, nothing to consume                        | **P12** refuse: needs Equipment SO with BOM            |
| T17 | BOM edited after issue (bolt 4→5)                              | GET material                                                   | required 15, balance 3                                 | ok (derived)                                           |
| T18 | BOM line removed after issue                                   | GET material                                                   | issued item vanished from view                         | **P13** show "not in BOM — return" rows                |
| T19 | Count less than booked (booked 5 machines, count 3)            | approve                                                        | available −2 silently                                  | **P14** warn + list bookings; require confirm          |
| T20 | Change item type consumable→tool after issues                  | PATCH item                                                     | allowed                                                | **P15** lock type once used                            |
| T21 | Serial gauge, calibration due yesterday                        | POST /tool-issues instrumentIds                                | allowed in v1                                          | **P16** refuse overdue calibration                     |
| T22 | Return with 1 lost, no reason                                  | return lost 1                                                  | accepted                                               | **P17** reason required; write-off pending approval    |
| T23 | One-click PR while an open PR exists for item                  | reorder-pr                                                     | second PR created                                      | **P18** skip + report                                  |
| T24 | Low-stock alert while a PO is already coming                   | alert                                                          | fires                                                  | **P19** compare available + On PO (ADR-189 rule)       |
| T25 | Tool issue of stock booked for an SO                           | tool issue 5, available 3                                      | v1 on-hand check passes                                | **P20** Available check (finding 8)                    |
| T26 | Approve own stock count                                        | approve by creator                                             | allowed                                                | **P21** approver ≠ creator                             |

## 6. Fixes (v1 → v2)

| Problem | Fix in v2                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1      | On submit, snapshot `system_qty_at_count`; on post, difference = `counted − system_qty_at_count` (movements after the count stay real).                                                                                                                                                                                                                                                                                        |
| P2      | `store_issues` header + `store_issue_lines` (one slip, many items).                                                                                                                                                                                                                                                                                                                                                            |
| P3      | ERPNext "backflush on material transferred": each Complete consumes BOM × units, **except the Complete that finishes the SO**, which consumes whatever is still issued-unused (may be less). Non-final shortfall → 409; final variance ≠ 0 → 409 `needsConfirmation` with the per-item variance; re-post with `confirmVariance.reason` records `variance_reason`. Returns allowed any time up to issued − returned − consumed. |
| P4      | Numeric ledger phase ships **before** the issue phase (Phase 1).                                                                                                                                                                                                                                                                                                                                                               |
| P5      | `postStockMove` refuses fractional qty when item UOM is NOS / SET (one place).                                                                                                                                                                                                                                                                                                                                                 |
| P6      | Over-balance issue → 409 `needsConfirmation`; allowed with `confirm.reason` by a user holding `issue_create` **approve**.                                                                                                                                                                                                                                                                                                      |
| P7      | Undo: if the unit has legacy `deductions` (ledger-debited) reverse those rows as today; else delete its consumption rows.                                                                                                                                                                                                                                                                                                      |
| P8      | Undo refused when the unit is dispatched.                                                                                                                                                                                                                                                                                                                                                                                      |
| P9      | Reverse only when no line has returns and the SO has no consumption from this slip; otherwise use Return.                                                                                                                                                                                                                                                                                                                      |
| P10     | `SELECT … FOR UPDATE` on the sales order row in Complete / Undo.                                                                                                                                                                                                                                                                                                                                                               |
| P11     | JC without RM item: `planned:false`, any item, no cap, view says "No material planned on the Route Card".                                                                                                                                                                                                                                                                                                                      |
| P12     | issueAgainst=assembly_so requires `sales_orders.type='equipment'` and a valid BOM; else 400.                                                                                                                                                                                                                                                                                                                                   |
| P13     | Material view appends issued items that are not in the BOM as "Not in BOM — return".                                                                                                                                                                                                                                                                                                                                           |
| P14     | Count approve: if new physical < booked, 409 `needsConfirmation` listing SO bookings; confirm + reason posts.                                                                                                                                                                                                                                                                                                                  |
| P15     | `itemType` / `trackSerial` locked once ledger rows or instruments exist.                                                                                                                                                                                                                                                                                                                                                       |
| P16     | Tool issue refuses instruments with `calibration_due_on < issue date` or status ≠ in_store.                                                                                                                                                                                                                                                                                                                                    |
| P17     | Damaged / lost need reason; lost/damaged create `writeoff_status=pending`; approver sets cost.                                                                                                                                                                                                                                                                                                                                 |
| P18     | reorder-pr skips items with an open (not closed/cancelled) PR; response lists skipped.                                                                                                                                                                                                                                                                                                                                         |
| P19     | AL-019 uses available + On PO (lib/po-pending) < reorder level.                                                                                                                                                                                                                                                                                                                                                                |
| P20     | Tool issue / JW DC out / adjust − use `postStockMove` which checks Available.                                                                                                                                                                                                                                                                                                                                                  |
| P21     | Stock count approve: approver ≠ creator (assertNotSelfApproval).                                                                                                                                                                                                                                                                                                                                                               |

Re-run of T1–T26 against v2: all give the intended result (T2 → +0 posted for bolt; T6 → final Complete confirms −0.5 m variance; T7 → return 0.5 allowed before final or recorded as variance; T13 → 409 "use Return").

## 7. Phases (one commit each, TEST first)

1. **Foundations** — numeric qty custom type + migration (ledger, balances, trigger, views), `lib/stock-ledger.ts` single writer, new source types, item types + reorder_qty + track_serial on create, gaps R12 (JW DC permission/log, Available checks, Movement Log filter, pager totals, logs, view permission, dead code).
2. **Stock Count** (R4).
3. **Issue redesign + material requirement + assembly consume** (R5–R8) incl. Route Card RM item, JC/SO Material tab, Item Issue screen.
4. **Instruments & tools** (R9).
5. **Reorder + consumption report** (R10, R11).

Q6 (shop-floor requests) deferred.

## 8. Addendum — Q3 and booked (reserved) stock (see "Assembly Issue and Booked Stock - Q3 Suggestion.pdf")

Live TEST: 554117187000 In Stock 16, booked 16 (IN-SO-00786 5, IN-SO-00001 11), free 0 — a sold component that can also be a BOM part.

- B1 Every issue takes **its own booking first, then free stock**; never another SO's booking.
- B2 `so_stock_reservations.purpose` sales | assembly. Assembly bookings: per assembly SO (`sales_order_id`), item = BOM part, cap = BOM required − issued − booked. Available stays In Stock − all bookings.
- B3 Dispatch consumes only _sales_ bookings of its own line (unchanged). Issue against an assembly SO consumes that SO's _assembly_ bookings first.
- B4 Releasing another SO's booking: separate action, planner approve tier, reason, activity log.
- B5 Leftover assembly bookings released when the SO's last unit completes / SO short-closed or cancelled.
- B6 Booking optional; "Book parts" button on the SO Material tab (not automatic on SO save).
  Paper tests: T27 issue of fully-booked part → 409 naming holders ✓; T28 book 6 then issue 6 → Available unchanged by the issue ✓;
  T29 two assemblies race for 6 → second booking refused (item lock) ✓; T30 SO completes with 2 booked unissued → released ✓.

## 9. Phase 1b — item types + small gaps (design → paper test → fixes)

### API

```
POST  /items          itemType REQUIRED (no default): raw_material | component | assembly | consumable | tool   (Q2)
PATCH /items/:id      itemType change to/from 'tool' refused once the item has ledger rows (409); others allowed, logged
POST  /items/bulk     Item Type column required per row; unknown value → row error
GET   /store-inventory, /store-transactions, /store-transactions/item-balance/:id, /store-issues, /tool-issues
                      view permission: any of item_create | issue_create | toolissue_create | plan_create | pr_create | grn_create
POST  /jw-dc/outward, /jw-dc/inward   ospdc_create entry + activity log
POST  /store-inventory/set-min        activity log
party-materials create / update / delete   activity log
GET   /tool-issues    pager total under the same filters
report stock-movement-log   Source filter = every source type (from shared enum)
```

Capability map (shared `ITEM_TYPE_RULES`, open/closed — screens read the map, not `if type === …`):
raw_material {label 'Raw Material', jobMaterial, reorderable} · component {label 'Component'} ·
assembly {label 'Assembly', bomParent} · consumable {label 'Consumable', reorderable, generalIssue} ·
tool {label 'Tool / Instrument', returnable}.

### Paper tests

| #   | Scenario                                                | v1 result                                 | Problem → fix                                                                          |
| --- | ------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| U1  | Create item, no type sent                               | v1: defaulted 'component'                 | **P22** Q2 wants a choice → schema has no default; web select starts empty ("Choose…") |
| U2  | Bulk import sheet without Item Type                     | v1 default component                      | same P22 → row error "Item Type required"                                              |
| U3  | Change consumable → raw_material after issues           | v1 locked all type changes                | **P23** too strict; only to/from 'tool' locked (tools get instrument rows in phase 4)  |
| U4  | 96 PROD items are all 'component'                       | —                                         | no migration of data; owner reclassifies by editing (allowed: not tool)                |
| U5  | Planner (plan_create view only) opens Store / Inventory | v1 required item_create view → locked out | **P24** any-of list includes plan_create / pr_create / grn_create                      |
| U6  | JW DC create by a user without ospdc_create             | 403                                       | ok (0 JW DC rows on either DB — nobody locked out)                                     |
| U7  | Stock Balance report filter "consumable"                | v1 hard-coded ['component','assembly']    | **P25** import ITEM_TYPES from shared                                                  |
| U8  | Items list type counters                                | v1 two hard-coded counts                  | **P26** one count per type from the map                                                |
| U9  | Stock Valuation "category" = item_type                  | shows raw code                            | label from the map                                                                     |

**Owner decision 2026-09-28 (Q3a–Q3c):** as suggested — BOM parts can be booked to an assembly SO (Q3a); releasing another SO's booking needs plan_create approve + reason (Q3b); parts are booked by hand from the Material tab, not on SO save (Q3c). Built in phase 3.

## 10. Phase 2 — Stock Count (opening stock + periodic counts)

### Data

`stock_counts` (IN-SC-#####): count_date, purpose opening | periodic, status draft → submitted → posted | cancelled,
remarks, submitted_by/at, approved_by/at, cancelled_by/at/reason. `stock_count_lines`: item_id, counted_qty
numeric(14,3), system_qty_at_count (set on submit), reason, store_transaction_id (set on post). Unique (count, item).

### API (new form key `stockcount_create`, dept store; entry = count, approve = post)

```
POST  /stock-counts                  { countDate, purpose, remarks?, lines:[{itemId, countedQty, reason?}] } → draft
PUT   /stock-counts/:id/lines        { lines:[…] }                       (draft only; replaces the lines)
POST  /stock-counts/:id/submit       → submitted; snapshots system_qty_at_count per line (under item locks)
POST  /stock-counts/:id/approve      { confirmReason? }  approver ≠ creator → posted: one ledger row per
                                     line with difference ≠ 0 (source stock_count, guard none)
POST  /stock-counts/:id/cancel       { reason }   draft / submitted only
GET   /stock-counts, /stock-counts/:id  (lines show system now, system at count, counted, difference)
```

Excel: the web reads the sheet (Item Code, Counted Qty, Reason) and posts lines; unknown codes are listed, not sent.

### Paper tests

| #   | Scenario                                                            | Result (v2)                                                            |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| C1  | Opening count 3 items, submit, approve by another user              | 3 ledger rows +20 / +2 / +10 ✓                                         |
| C2  | Counted 09:00 (submit snapshots 20), 5 issued 11:00, approved 15:00 | posts counted − snapshot = 0; ledger ends 15 = shelf ✓ (P1)            |
| C3  | Same item twice in one count                                        | 400 "item listed twice" ✓                                              |
| C4  | NOS item counted 2.5                                                | 400 whole number (single writer rule, also checked on save) ✓          |
| C5  | Counted −1                                                          | 400 ✓                                                                  |
| C6  | Difference 0 on a line                                              | no ledger row ✓                                                        |
| C7  | Creator approves own count                                          | 403 (P21) ✓                                                            |
| C8  | Two approvers click at once                                         | header row locked FOR UPDATE; second gets 409 "already posted" ✓       |
| C9  | New physical below stock booked for SOs                             | 409 needsConfirmation listing SO bookings; re-post with reason ✓ (P14) |
| C10 | Cancel a posted count                                               | 409 "correct it with a new count" ✓                                    |
| C11 | Excel with an unknown code                                          | row listed as error, rest go into the draft ✓                          |
| C12 | Item deleted between submit and approve                             | 409 names the item ✓                                                   |

## 11. Phase 3 — issue against the job, material view, booked parts, Complete only consumes

### Data (0156)

- `route_cards`, `plans`, `job_cards` += `raw_material_item_id` (→ items), `rm_qty_per_piece` numeric(14,4);
  the JC copies them like grade / size today (Route Card → Plan → JC).
- `store_issues` becomes the **header**: `issue_against` job*card | assembly_so | general, `job_card_id`,
  `production_order_id`, `sales_order_id`, `issued_to_operator_id` → operators, `issued_to_text` (fallback),
  `department`, purpose, remarks, reversed*\*. Old single-item columns kept nullable (rollback), no longer written;
  existing rows (3 on TEST, 0 on PROD) copied into lines.
- `store_issue_lines`: issue_id, line_no, item_id, qty numeric(14,3), store_transaction_id.
- `store_issue_returns`: issue_line_id, qty, reason, store_transaction_id.
- `assembly_unit_consumptions`: assembly_unit_id, sales_order_id, item_id, qty, variance_reason (no ledger row).
- `so_stock_reservations` += `purpose` sales | assembly, `sales_order_id`; `so_line_id` nullable; CHECK
  (sales ⇒ so_line_id) and (assembly ⇒ sales_order_id). Available view unchanged (all bookings).

### Read model (derived, `lib/material-requirement.ts` — never stored)

- JC: planned when the JC has an RM item → Required = rm_qty_per_piece × JC qty; Issued / Returned from issue
  lines against the JC; Balance = Required − Issued + Returned.
- Assembly SO: per BOM line Required = qty_per_set × units; Booked (assembly bookings), Issued, Returned,
  Used (consumptions), Balance to issue, Issued-unused = Issued − Returned − Used; Free in store; Booked for
  other SOs (with SO numbers); On PO.

### API

```
GET  /material/job-cards/:id        GET /material/sales-orders/:id
POST /store-issues   { issueDate, issueAgainst, jobCardId? | salesOrderId?, operatorId? | issuedToText?,
                       department?, purpose, lines:[{itemId, qty}], confirmReason? }
POST /store-issues/:id/returns  { lines:[{issueLineId, qty}], reason }
POST /store-issues/:id/reverse  { reason }        (only if nothing returned / consumed)
POST /material/sales-orders/:id/book   { lines:[{itemId, qty}] }       (plan_create entry)
POST /material/sales-orders/:id/release { itemId, qty, reason }         (plan_create approve)
POST /assemblies/:soId/units, PATCH /assemblies/units/:id/stop   { qty, confirmVarianceReason? }
```

Single writer gains guard `available_plus_own` (free stock + this SO's own assembly booking); after the
issue the own booking is consumed first.

### Paper tests

| #   | Scenario                                                 | Result                                                               |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| M1  | JC 50 pcs, RM 0.25 m/pc (12.5 m); issue 10               | Balance 2.5 ✓                                                        |
| M2  | Issue 3 more (balance 2.5)                               | 409 needsConfirmation; approve-tier user with reason → posted ✓ (P6) |
| M3  | Assembly SO issue of an item not in its BOM              | 400 "not a BOM part — issue as General" ✓                            |
| M4  | Return more than issued-unused                           | 409 ✓                                                                |
| M5  | Book parts beyond free stock                             | 409 names holders ✓ (T29)                                            |
| M6  | Complete 2 with a part not issued                        | 409 lists each short part ✓ (T5)                                     |
| M7  | Final Complete, cable issued 6 − returned 0.5 vs BOM 6   | 409 variance −0.5 → with reason consumes 5.5 ✓ (P3)                  |
| M8  | Undo a unit whose machine is dispatched                  | 409 ✓ (P8)                                                           |
| M9  | Undo a unit assembled before this phase (ledger-debited) | old ledger rows reversed ✓ (P7)                                      |
| M10 | General issue without Department                         | 400 ✓                                                                |
| M11 | Reverse a slip whose parts were consumed                 | 409 "use Return" ✓ (P9)                                              |
| M12 | Issue of a part fully booked for other SOs               | 409 names IN-SO-00786 / IN-SO-00001 ✓ (T27)                          |
| M13 | Book 6, issue 6                                          | own booking consumed; Available unchanged by the issue ✓ (T28)       |
| M14 | Last unit completes with 2 booked-not-issued             | leftover assembly booking released ✓ (T30, B5)                       |
| M15 | Two Completes on one SO at once                          | SO row locked; second re-checks ✓ (P10)                              |

**Review fixes (phase 2):** snapshot taken when a line is KEYED (kept while its counted qty is unchanged), not at Submit; nobody who created, keyed or submitted a count may approve it; the below-booked confirmation only when the count lowers stock; Count Date not in the future.

## 12. Phase 3b — as built (issue slip, issue against the job, material view)

Built: M1–M4, M10, M11 (+ return/reverse, register, backfill). M5–M9 and M12–M15 need reservations and
Complete-consumes, which are phase 3c. Names changed to the register (docs/NAMING.md): the paper tests'
"Balance" is **To Issue**, "issued-unused" is **Still Out**, "booked" is **Reserved**, the assembly's
"consumed" is **Fitted**.

Scenario test on TEST (real services, `verify-3b.ts`): 25 / 25 pass —
M1 To Issue 2.5 · M2 409 needsConfirmation, 403 without the right, posted with reason by an approver ·
other items on a JC uncapped · M3 not-a-BOM-part 400 · two-line SO slip, To Issue 2 / 0 · SO over To Issue
409 · M4 over-return 409, return 1 → Returned 1, To Issue 3, stock +1 · M10 no Department refused, general
issue −5 · M11 reverse after a return → "use Return" · reverse general → stock +5 · return on a reversed slip
409 · over Available refused by the stock writer · duplicate item refused · register search / detail ·
backfill one line per old slip · balances = Σ ledger · every line has its ledger row · reversed slips flagged
in the material slip list · closed SO refused · SO with its BOM removed still lists parts out.

Review fixes (3b): F1 ISS- number under a per-company advisory lock · F2 reversed slips flagged on the
Material slip list · F3 deep-linked Job Card / SO shows its code in the picker · F4 the more-than-To-Issue box
clears on any line edit; "Issue Anyway" needs Approve · F6 closed / cancelled Assembly SO refused · F7 Return
/ Reverse dated in IST · F8 pre-0157 slips show their typed reference · F9 an SO whose BOM is gone still lists
parts out · F10 a 403 on Material shows a plain message.
Open (not fixed): a Job Card's status is not checked on issue; M12 (naming the SOs that hold a part) waits
for 3c reservations.

## 13. Phase 3c — reserve parts for an assembly SO; Complete only checks and fits

Live check 2026-09-28: `assembly_units` = 0 rows on TEST and on PROD, so no unit was ever stock-debited by
the old cascade. M9 (undo a ledger-debited unit) is N/A; the old OUT path is simply retired.

### Data (0158)

- `assembly_part_reservations` (NEW, not `so_stock_reservations` — see P27): sales_order_id → sales_orders,
  so_code_text, item_id → items, `qty numeric(14,3) > 0`, `consumed_qty`, `released_qty` numeric(14,3)
  default 0, CHECK consumed + released ≤ qty, status active | partially_consumed | consumed | released,
  release_reason; audit columns; RLS.
- `v_item_stock_availability.reserved_qty` = sales reservations remaining + assembly reservations remaining.
- `assembly_unit_consumptions` (NEW): assembly_unit_id → assembly_units, sales_order_id, item_id,
  `qty numeric(14,3) > 0`, variance_reason; audit; RLS. No ledger row — the parts left the store at issue.
- `store_issue_lines` += `reserved_used_qty numeric(14,3) default 0` (own reservation used by this line).

### Rules

- Reserve (`POST /material/sales-orders/:id/reserve {lines:[{itemId, qty}]}`, Planning entry): BOM parts
  only; qty ≤ To Issue − already Reserved (never reserve beyond need); qty ≤ Available else 409 naming who
  holds it. Items locked in id order.
- Release own (`POST /material/sales-orders/:id/release {itemId, qty, reason}`, Planning entry): newest first.
- Issue against an assembly SO: the line may use Available + this SO's own reservation (one writer:
  `postStockMove` gains `allowance`); own reservation consumed first (`reserved_used_qty`). Over that →
  409 naming the SOs holding the rest (M12).
- Complete (Stop and Mark Assembled): lock the SO row first (M15). Per BOM part need = Qty per Set × qty.
  Not the last units: Still Out < need → 409 `{ short[] }` "issue from the store first" (M6).
  Last units: Fitted = all Still Out; any part where Still Out ≠ need → 409 `{ needsConfirmation,
  variance[] }` unless `confirmVarianceReason` (M7); a part with Still Out 0 is always short (P28).
  Writes consumption rows + the finished-machine IN (unchanged); NO component OUT. Last units also release
  the SO's leftover reservations (M14).
- Undo last unit: dispatched → 409 (M8); soft-deletes its consumptions (parts are Still Out again, on the
  floor — Return them if not reused) and reverses the finished-machine IN. Released reservations stay released.
- Return / Reverse of an assembly-SO slip: capped by the SO's Still Out for the item (P34) — fitted parts
  cannot go back to the store; Reverse also gives back the line's `reserved_used_qty` to the reservation.
- Tracker "can assemble": min over parts ⌊Still Out ÷ Qty per Set⌋ (P30), not stock.

### Paper-test fixes

| #   | Problem found on paper                                                                 | Fix                                                         |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P27 | `so_stock_reservations` is integer and keyed to an SO line; dispatch / PRO close read it | separate `assembly_part_reservations`; the view sums both   |
| P28 | Last-unit variance would let a unit "complete" with a part never issued                | Still Out 0 on a part is always short, reason or not        |
| P29 | Undo put parts back in the store though they are on the bench                          | Undo makes them Still Out again; the store Returns them     |
| P30 | Tracker "can assemble" still counted store stock                                       | counts Still Out                                            |
| P34 | Return / Reverse could send back parts already fitted                                  | capped by the SO's Still Out for that item                  |

### Phase 3c — as built

Scenario test on TEST (`verify-3c.ts`): 27 / 27 — reserve 4 of 6 (Available 8→4) · reserve beyond need 409 ·
M5 second SO over free 409 names the holder · part not in BOM 400 · M6 Complete before issue → short 409 ·
M12 issue over free + own 409 names the other SO · M13 issue uses own reservation, Available unchanged ·
general issue of another SO's reserved stock refused · Complete 2 → Fitted, store stock unchanged, machine +2 ·
P34 return / reverse of fitted parts 409 · release, over-release 409 · M7 last unit variance → reason →
fits 1.5 m, M14 leftover reservation released · Undo → Still Out again, machine −1 · M8 dispatched undo 409 ·
tracker · store drill-down lists assembly rows · balances = Σ ledger, 0 component OUT rows · view Reserved =
sales + assembly · SO with issues / reserved parts blocked from cancel · no reservations after full assembly.

Review fixes (3c): SO lock `FOR NO KEY UPDATE` (deadlock with FK checks) · cancel / delete blocked while the
SO holds item issues or reserved parts · no reserve after full assembly · Reverse never revives a released
reservation · "can assemble" rounding for decimal Qty per Set · unclamped Available so holders are named ·
stock-writer message says "reserved for orders (sales and assembly)" · Store drill-down includes assembly
reservations (shared read contract widened: soLineId / lineNo nullable, decimals, source Assembly).
M9: N/A (no ledger-debited units ever existed). M15: SO row lock in Complete / Undo / Return / Reverse.


## 14. Phase 4 — instrument / tool register (R9, Q4)

Live check 2026-09-28: `tool_issues` 0 rows on TEST and PROD; tool items: TEST 1, PROD 0. Reshape freely.

### Requirements (plain)

- A **Tool / Instrument** item is either a *bulk tool* (drill bits, inserts — counted by qty) or a
  *serial instrument* (gauges, micrometers — `track_serial`, one register row per piece, calibrated).
- Register each instrument by Serial No.: status In Store / Issued / At Calibration / Lost / Scrapped,
  calibration interval, last calibrated, next due, calibration history (date, result, certificate no., agency).
- Issue a tool to an **Operator** (picked), optional Job Card, expected return date. Serial tools are
  issued by picking instruments, never by typing a qty. An instrument past its due date cannot be issued.
- Return: Good / Damaged / Lost / Consumed (bulk) or per instrument Good / Damaged / Lost. Damaged and Lost
  need a reason and go to a **write-off** that the Store In-charge (approve tier, not the person who
  recorded it) approves or rejects. Cancel an issue only while nothing was returned.
- Who holds what (per operator, overdue flagged); alerts: calibration due in 7 days / overdue, tools not
  returned by the expected date.

### Data (0159)

- `items` += `track_serial boolean default false` (only on type tool; locked once ledger rows / instruments exist).
- `instruments`: item_id, serial_no (unique per item, case-insensitive), status CHECK in_store | issued |
  at_calibration | lost | scrapped, calibration_interval_days, last_calibrated_on, calibration_due_on,
  location, remarks; audit; RLS.
- `instrument_calibrations`: instrument_id, calibrated_on, result pass | fail, certificate_no, agency,
  next_due_on, remarks; audit; RLS.
- `tool_issues` (0 rows → reshaped): qty numeric(14,3); += issued_to_operator_id, job_card_id,
  cancelled_at / by / reason; old `return_*` totals dropped (derived from returns).
- `tool_issue_instruments`: tool_issue_id, instrument_id, returned_on, return_condition good | damaged | lost.
- `tool_issue_returns`: qty columns numeric; += lost_qty, reason.
- `tool_writeoffs`: item_id, instrument_id?, tool_issue_return_id?, kind damaged | lost | scrap, qty, reason,
  status pending | approved | rejected, decided_by / at / remarks; audit; RLS.
- `store_txn_source_type` += `tool_writeoff` (only a Scrap of an in-store instrument moves stock).

### API (form key toolissue_create; write-off decision = approve tier)

```
GET  /instruments?itemId&status&due=overdue|week         POST /instruments { itemId, serialNo, intervalDays?, lastCalibratedOn?, location? }
PATCH /instruments/:id { intervalDays?, location?, remarks? }
POST /instruments/:id/calibration-out  { date, agency }   POST /instruments/:id/calibrate { calibratedOn, result, certificateNo?, agency?, nextDueOn? }
POST /instruments/:id/scrap { reason }                     → pending write-off
POST /tool-issues { issueDate, itemId, qty? | instrumentIds[]?, operatorId | issuedToText, jobCardId?, expectedReturnDate, purpose }
POST /tool-issues/:id/return { returnDate, good, damaged, lost, consumed, reason? } | { returnDate, instruments:[{instrumentId, condition}], reason? }
POST /tool-issues/:id/cancel { reason }
GET  /tool-writeoffs?status      POST /tool-writeoffs/:id/decide { decision approve|reject, remarks }
GET  /tool-issues/holders
```

Stock rules: issue = OUT (Available guard); Good return = IN; Consumed / Damaged / Lost = no IN.
Rejected Damaged → IN as Good; rejected Lost → still out with the operator. Approved write-off moves no
stock (it already left at issue) — except Scrap of an in-store instrument = OUT `tool_writeoff`.
Register never moves stock: it names a piece already received (GRN / Stock Count).
**Serial cover (one writer):** for a `track_serial` item, `postStockMove` refuses any move that leaves On Hand
below the count of instruments In Store + At Calibration.

### Paper tests (API "running")

| #   | Scenario                                                          | v1 result                         | Problem → fix                                                          |
| --- | ----------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| I1  | Register MIC-001 on a gauge item with On Hand 0                   | registered                        | **P35** refuse: "receive it first (GRN / Stock Count)" — registered ≤ On Hand |
| I2  | GRN 2 → register 2 → 3rd; duplicate serial "mic-001"              | 3rd refused; dup allowed (case)   | **P36** unique on lower(serial_no)                                     |
| I3  | Issue gauge due yesterday                                         | 409 ✓ (P16)                        | —                                                                      |
| I4  | Issue gauge At Calibration                                        | 409 ✓                              | —                                                                      |
| I5  | Serial item issued by qty 1                                       | allowed                           | **P37** serial item needs instrumentIds; bulk item refuses them        |
| I6  | Stock adjust −1 on a gauge item, On Hand 2, 2 in store            | allowed → register lies           | **P38** serial cover check inside `postStockMove`                      |
| I7  | Stock Count counts 1 gauge, 2 registered in store                 | posts 1                           | P38 refuses: "mark the missing instrument Lost first"                  |
| I8  | Item Issue (store) of a tool item                                 | allowed                           | **P39** refused — tools go out by Tool Issue (ITEM_TYPE_RULES.returnable) |
| I9  | Return bulk 10: good 6, damaged 1, lost 1, consumed 2             | IN 6; 2 write-offs pending ✓       | —                                                                      |
| I10 | Recorder approves own write-off                                   | allowed                           | **P40** approver ≠ recorder (as Stock Count)                           |
| I11 | Reject Damaged / reject Lost                                      | —                                 | Damaged → IN as Good; Lost → out again with the operator ✓             |
| I12 | Cancel after a return                                             | 409 ✓                              | —                                                                      |
| I13 | Calibration result Fail                                           | status stays In Store, still due  | **P41** Fail → due = calibrated date (blocked from issue) until Pass or Scrap |
| I14 | Two users issue the same instrument at once                       | both pass the read                | **P42** lock instrument rows (id order) before the status check        |
| I15 | Return an instrument not on this issue / returned twice           | —                                 | 400 / 409 ✓                                                            |
| I16 | Inactive operator                                                 | —                                 | 400 ✓                                                                  |
| I17 | Turn off track_serial after instruments exist                     | allowed                           | P15 extended: 409                                                      |
| I18 | Issue an in-store gauge that has a Scrap write-off pending        | allowed                           | **P43** a pending write-off blocks issue and calibration-out           |

Phases: **4a** instruments + calibration + serial cover + track_serial + AL-020 (calibration due/overdue);
**4b** tool issue rewrite (operator, instruments, returns, write-offs, cancel, holders) + AL-021 (not returned).

### Phase 4 — as built

Scenario test on TEST (`verify-4.ts`): 26 / 26 — Track by Serial No. only on Tool · register with On Hand 0
refused · register 2 of 2, 3rd refused · duplicate serial (other case) refused · overdue calibration refused ·
serial item by qty refused · adjust −1 below cover refused · tool on Item Issue refused · issue → Issued, On Hand
−1 · issue an issued instrument refused · return Good → In Store · double return refused · Fail calibration
blocks issue · Pass → due +1 year, issue + cancel · pending scrap blocks calibration-out · recorder cannot decide ·
approved scrap → Scrapped + OUT tool_writeoff · bulk 10 → good 6 / damaged 1 / lost 1 / consumed 2 (IN 6, 2
pending) · over-return refused · cancel after return refused · reject damaged +1, reject lost → Still Out 1 ·
holders · Track by Serial No. locked · ledger = balances · serial cover holds. Regression: 3b 25/25, 3c 27/27.
Beyond the paper design: a Fail blocks issue on the day it failed (due = calibrated date alone let it through).
Review fixes (4): instrument checks read after the row lock in a separate statement (a scrap committed while
another user waited was invisible) · **Mark Missing** (In Store piece not found → Lost write-off; on approval
Lost + OUT 1) so a stock count on a serial item is never stuck · Instrument Serial No. correctable while never
issued · future Issue / Return Dates refused; calibration check uses the later of Issue Date and today ·
Issue Tool keeps the picked item across searches. Re-run: 31 / 31.
