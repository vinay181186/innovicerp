# PARITY — Store Section (master matrix)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> **Skill applied:** `legacy-canonical-mapper` — 1:1, no invention.
> **Compiled:** 2026-05-23.
>
> Pulls together the 9 individual parity docs under `docs/PARITY/` that touch
> the Store department and re-states what's SHIPPED / PARTIAL / MISSING
> against the legacy HTML.

---

## Legacy sidebar → page → React mapping

Legacy Store group (HTML L425–440):

| # | legacy key | legacy label (line) | legacy render fn (line) | React route | API module | Web module | Status |
|---|---|---|---|---|---|---|---|
| 1 | `grn` | 📥 **"GRN (Goods Receipt)"** (L428) | `renderGRN` (L26444) | `/goods-receipt-notes` | `goods-receipt-notes` | `goods-receipt-notes` | ✅ SHIPPED |
| 2 | `issueregister` | 📋 **"Item Issue Register"** (L429) | `renderIssueRegister` (L23874) | `/issue-register` | `store-issues` | `store-issues` | ✅ SHIPPED |
| 3 | `toolissue` | 🔧 **"Tool Issue Register"** (L430) | `renderToolIssue` (L23965) | `/tool-issues` | `tool-issues` | `tool-issues` | ✅ SHIPPED |
| 4 | `partygrn` | 📥 **"Party Material GRN"** (L431) | `renderPartyGRN` (L24251) | — | — | — | ❌ **MISSING** |
| 5 | `jwdc` | 📋 **"JW Delivery Challan"** (L432) | `renderJWDC` (L24434) | — | — | — | ❌ **MISSING** |
| 6 | `items` | ◉ **"Item Master"** (L434) | `renderItems` (L11481) | `/items` | `items` | `items` | ✅ SHIPPED |
| 7 | `partymaterial` | 🏭 **"Party Material Master"** (L435) | `renderPartyMaterial` (L24129) | — | — | — | ❌ **MISSING** |
| 8 | `store` | 📦 **"Store / Inventory"** (L437) | `renderStore` (L24803) | `/store-inventory` | `store-inventory` | `store-inventory` | ✅ SHIPPED |
| 9 | `stockledger` | 📖 **"Stock Ledger"** (L438) | `renderStockLedger` (L25013) | `/store-transactions` | `store-transactions` | `store-transactions` | ✅ SHIPPED |
| 10 | `rpt_store` | 📊 **"Store Reports"** (L439) | `renderDeptReport('store')` (L2471 → L20029) | `/reports?group=Store` | `reports` | `reports` | ⚠️ ROUTE LIVES, sidebar entry missing |

---

## Build plan (this session)

Goal: complete the 4 missing/partial items (4 / 5 / 7 / 10) plus polish gaps
identified in the per-page parity docs.

### Slice 1 — Party Material Master (`/party-material`)

- Legacy: `renderPartyMaterial` L24129–24163 + addPartyMaterial L24173 +
  editPartyMaterial L24214 + delPartyMaterial L24233. Helpers `_nextPMCode`
  (`PM-NNNN`), `_pmFillItem` (datalist auto-fill from `items` master).
- Per `docs/PARITY/party-material.md`.
- New schema: `party_materials` (single table — `code`, `name`, `description`,
  `material`, `uom`, `client_id`, `item_id`, `stock_qty`, `issued_qty`,
  `received_qty`).
- Endpoints: list / get / create / update / delete.
- UI: list (10 cols) + add/edit modals + delete (blocked when stock>0).

### Slice 2 — Party Material GRN (`/party-grn`)

- Legacy: `renderPartyGRN` L24251–24293 + addPartyGRN L24298–24367 + line
  helpers L24369–24421. Helper `_nextPartyGRNNo` (`PGRN-NNNNN`).
- Per `docs/PARITY/party-grn.md`.
- New schema: `party_grn` (header) + `party_grn_lines` (multi-line per
  receipt). FKs: `job_work_order_id`, `client_id`, `party_material_id`.
- Cascade: each line increments `party_materials.stock_qty` AND
  `party_materials.received_qty`.
- Endpoints: list / create (multi-line atomic).
- UI: 3-tile KPI strip + 11-col list + multi-line modal with JW header
  auto-fill.

### Slice 3 — JW Delivery Challan (`/jw-dc`)

- Legacy: `renderJWDC` L24434–24447 (tab bar) + `_jwdcOutwardView`
  L24450–24486 + `_jwdcNewOutward` L24489–24546 + `_jwdcLoadPOLines`
  L24548–24590 + `_jwdcViewOut` L24592–24609 + `_jwdcPrint` L24611–24661 +
  `_jwdcInwardView` L24664–24689 + `_jwdcNewInward` L24692–24758 +
  `_jwdcLoadInLines` L24760–24799.
- Per `docs/PARITY/jw-dc.md`.
- New schema: 4 tables
  - `jw_dc_outward` + `jw_dc_outward_lines` (sends material to JW vendor)
  - `jw_dc_inward` + `jw_dc_inward_lines` (receives processed material back)
- Cascades:
  - Outward line save: `items.stock_qty -= sentQty`, emit
    `store_transactions(type='OUT', source='JW DC Outward')`.
  - Inward line save (per Good/OK qty): `items.stock_qty += okQty`, emit
    `store_transactions(type='IN', source='JW DC Inward')`. Rejected qty
    triggers auto-NC creation (defer auto-NC unless `nc_register` cascade
    already supported).
- Endpoints:
  - GET /jw-dc/outward (list with totals + status calc),
  - GET /jw-dc/outward/:id (detail for view/print),
  - POST /jw-dc/outward (multi-line atomic + stock deduction),
  - GET /jw-dc/outward/:id/lines (for inward modal pending qty calc),
  - GET /jw-dc/inward (list),
  - POST /jw-dc/inward (multi-line atomic + stock restoration).
- UI: two-tab single route (`window._jwdcTab` mirrors as URL `?tab=outward|inward`).
  Outward list (10 cols) + inward list (8 cols) + 2 modals (new outward,
  new inward) + print preview window (later — can ship without).

### Slice 4 — Sidebar parity

- Add 4 missing entries per `docs/PARITY/store-sidebar.md`:
  - `/party-grn` 📥 "Party Material GRN" — Entry group
  - `/jw-dc` 📋 "JW Delivery Challan" — Entry group
  - `/party-material` 🏭 "Party Material Master" — Master group
  - `/reports?group=Store` 📊 "Store Reports" — Report group
- Polish: GRN sidebar label `GRN` → `GRN (Goods Receipt)` (legacy L428 verbatim).
- Polish: section-header emoji on existing pages where missing.

---

## Existing-page parity polish (defer-and-check)

After the 3 missing modules ship, sweep the existing pages against their
per-page parity docs and pick up small wins:

| # | page | parity doc | open gaps | priority |
|---|---|---|---|---|
| 1 | GRN list | `grn.md` | invoice/dc Ref col, JWPO label distinction, "Goods Receipt Note (GRN)" header emoji | POLISH |
| 2 | Store / Inventory | `store-inventory.md` | "+ Manual Receipt" button (legacy L24873) is missing from React | **BLOCKER** for inventory parity |
| 3 | Stock Ledger | `stock-ledger.md` | check |
| 4 | Issue Register | `issue-register.md` | check |
| 5 | Tool Issue Register | `tool-issue.md` | check |

(Three of these checked at the end if time allows; otherwise added to
backlog and shipped per the user's "we will test once store module built
entirely" instruction.)

---

## Acceptance for "Store module 1:1 with HTML"

Every legacy sidebar link in the Store group navigates to a route that
renders within ±5% of the legacy DOM (chrome, columns, modals, KPI tiles,
button labels, validation rules). Stock cascades that legacy maintains in
JS (`items.stockQty +=/-=`) are reproduced atomically in Postgres via
`store_transactions` with matching `source` strings so the Stock Ledger
shows identical events.

Tests deferred — user explicitly said "we will test once store module
build entirely."

---

## Session 2026-05-23 — what shipped

### New pages

1. **Party Material Master** (`/party-material`)
   - Migration `0030_phase8_party_materials.sql` — `party_materials` table
   - API `apps/api/src/modules/party-materials/` (service + routes)
   - Web `apps/web/src/modules/party-materials/` (list + add modal + edit modal + soft-delete)
   - Numbering `PM-NNNN`. Auto-fill name/desc/material from Item Master picker.
2. **Party Material GRN** (`/party-grn`)
   - Migration `0031_phase8_party_grn.sql` — `party_grn` + `party_grn_lines`
   - API `apps/api/src/modules/party-grn/` (multi-line atomic create + stock cascade)
   - Web `apps/web/src/modules/party-grn/` (3-tile KPI + list + multi-line modal)
   - Numbering `PGRN-NNNNN`. Per-line save increments `party_materials.stock_qty` + `received_qty`.
3. **JW Delivery Challan** (`/jw-dc?tab=outward|inward`)
   - Migration `0032_phase8_jw_dc.sql` — 4 tables (outward/outward_lines/inward/inward_lines)
   - API `apps/api/src/modules/jw-dc/` (outward list/detail/create + PO-line loader + inward list/create)
   - Web `apps/web/src/modules/jw-dc/` (tab switcher + outward+inward lists + 2 modals + view-outward modal)
   - Numbering `JWDC-OUT-NNNN` (outward) + `JWIN-NNNN` (inward, legacy L24696)
   - Cascades: outward → `store_transactions(jw_out, txn_type='out')` + item stock −=; inward (per ok qty) → `store_transactions(jw_in, txn_type='in')` + item stock +=. Rejected qty stored but auto-NC creation deferred.

### Sidebar parity (`apps/web/src/components/shared/sidebar.tsx`)

All 4 missing Store sidebar entries now present:
- `/party-grn` 📥 "Party Material GRN" (Entry group)
- `/jw-dc` 📋 "JW Delivery Challan" (Entry group)
- `/party-material` 🏭 "Party Material Master" (Master group)
- `/reports?group=Store` 📊 "Store Reports" (Report group)

Order matches legacy L427–439 exactly.

### Existing-page polish

- **Store / Inventory** (`/store-inventory`) — added "+ Manual Receipt" button + `ManualReceiveModal` with item picker + Source dropdown (Production/Purchase/Return/Other) + Ref No. Currently composes Source/Ref/Remarks into the `store_transactions.remarks` field (DELTA — adding dedicated source/ref columns to `store_transactions` is a follow-up bump).

### Remaining DELTAs (deferred to backlog per "build first, audit later")

- **Stock Ledger**: Running Balance panel when single-item filter set (BLOCKER per `stock-ledger.md`), Excel export, ↻ Clear filter button.
- **GRN list**: Invoice/DC Ref column, JWPO label distinction, header emoji per `grn.md`.
- **JW DC outward print template** (`_jwdcPrint` L24611) — modal view shipped but print-friendly window deferred.
- **JW DC inward auto-NC creation** for rejected qty (L24746–24750) — data stored, NC linkage hook deferred.
- **`store_transactions.source_type`** doesn't yet have a `party_grn` value — Party GRN does not currently emit a store_transactions row (party material stock is its own field). If we later want a unified party-material ledger, this is a follow-up.

All API/web typecheck + lint + build green at slice close.
No tests run this session — user explicitly said "we will test once store module built entirely."
No git commits — user instruction.
