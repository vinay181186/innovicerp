# PARITY — Party Material Master (`renderPartyMaterial`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L24129–24163. Helpers: `addPartyMaterial` L24173, `editPartyMaterial` L24214, `delPartyMaterial` L24233, `_nextPMCode` L24166, `_pmFillItem` L24202. Numbering: `PM-NNNN`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/party-material` route; no `party_materials` table.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

Catalogue of **raw materials supplied by clients** for Job Work orders. Distinct from regular `items` master — these belong to the client, not the company. Stock is tracked separately (issued / received / on-hand) and feeds Party Material GRN + JW DC workflows.

Schema (`db.partyMaterials[*]`):
- `code` (`PM-NNNN`), `name`, `description`, `material` (grade), `uom`
- `clientCode` (FK→clients.code) — the client who supplies this
- `itemCode` (optional — link to canonical Item Master entry for cross-ref)
- `stockQty` (current on-hand)
- `issuedQty` (cumulative — issued to JCs)
- `receivedQty` (cumulative — received via Party GRN)

---

## 1. Page chrome (L24150–24156)

- Section header: `🏭 Party Supplied Material Master`
- Search input + "+ Add Material" button

Footer hint: `💡 Party Material Master tracks raw materials supplied by clients for Job Work orders. Stock is updated via Party Material GRN. Separate from company inventory.`

---

## 2. List table (L24158) — 10 columns

| col | header | colour |
|---|---|---|
| 1 | Code | purple code |
| 2 | Name | bold |
| 3 | Description | text2 11px |
| 4 | Material | default |
| 5 | UOM | tag |
| 6 | Client | bold |
| 7 | **In Stock** | green (or text3 if 0) |
| 8 | **Issued** | amber |
| 9 | **Total Received** | cyan |
| 10 | Actions | Edit + Del |

---

## 3. addPartyMaterial / edit modals (L24173–24231)

Add form (8 fields):
- Material Code ★ (auto `PM-NNNN`, editable)
- Item Master cross-ref picker (optional — auto-fills name/desc/material/uom from existing Item)
- Material Name ★
- Description
- Material / Grade (e.g. EN8, SS 304, MS)
- UOM (NOS / KG / MTR / SET / LOT)
- Client ★ (datalist of clients)

Edit form: same fields minus the Code (readonly).

Delete: blocked when `stockQty > 0`; moves to trash otherwise.

---

## 4. Required new schema

```
party_materials (
  id uuid PK, company_id, code (PM-NNNN),
  name, description, material, uom enum,
  client_id uuid FK→clients, client_code_text,
  item_id uuid FK→items (optional — cross-ref to regular Item Master),
  stock_qty integer NOT NULL DEFAULT 0,
  issued_qty integer NOT NULL DEFAULT 0,
  received_qty integer NOT NULL DEFAULT 0,
  audit envelope
)
```

Indices: unique (company_id, code), index on client_id.

`stockQty`/`issuedQty`/`receivedQty` are computed elsewhere (mutated by Party GRN + JW DC + Job Work consumption) — store as columns + a recompute SQL function (similar to v_item_stock).

---

## 5. Summary — building from scratch

### BLOCKERs (paired with §0 docs/PARITY/party-grn.md and jw-dc.md)
1. Schema + RLS + migration.
2. CRUD endpoints.
3. List page.
4. Add/Edit modals.
5. Sidebar entry "🏭 Party Material Master" under Store → Master.

### DELTAs
6. Item Master cross-ref picker — nice-to-have; defer if simple.

---

**Sign-off needed:**
- Confirm scope. Estimate ~500 LOC. Pair with party-grn (these tables connect).
- Confirm `PM-NNNN` 4-digit prefix.
- Confirm cross-ref to items table (legacy itemCode is loose; React should use uuid FK with text fallback).
