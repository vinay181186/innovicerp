# PARITY — Party Material GRN (`renderPartyGRN`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L24251–24294. Helpers: `addPartyGRN` L24298, `_pgrnAddLine` L24369, `_pgrnRefreshLines` L24374, `_pgrnLineItemSel` L24406, `_pgrnFillJW` L24413, `_nextPartyGRNNo` L24244. Numbering: `PGRN-NNNNN`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/party-grn` route. Gated by `party_materials` table (see `party-material.md`) + new `party_grn` tables.

---

## 0. What this page is

Records **client-supplied raw material received** against a JW order. Inverse of the regular GRN (which is supplier→us). Multi-line per receipt (one DC from a client may bring multiple materials).

Schema (`db.partyGrn[*]`):
- `grnNo` (`PGRN-NNNNN`), `grnDate`, `dcNo`, `remarks`
- `jwNo` (FK→jobWorkOrders.code), `jwLineNo`, `clientCode`, `clientPoNo`
- Per line: `materialCode` (FK→partyMaterials.code), `materialName`, `receivedQty`
- `receivedBy`

---

## 1. KPI strip (L24282–24286) — 3 tiles

| # | tile | colour | value |
|---|---|---|---|
| 1 | TOTAL GRNs | cyan | `grns.length` |
| 2 | TOTAL RECEIVED | green | `Σ receivedQty` |
| 3 | TODAY | amber | grns with `grnDate === today` |

---

## 2. Page chrome (L24275–24281)

- Header `📥 Party Material GRN`
- Search input (search JW, client, material)
- + New Party GRN primary button

Footer hint: `💡 Party Material GRN records raw material received from clients for Job Work. Received qty is added to Party Material stock. Linked to JW No. / Line No. / Client PO.`

---

## 3. List table (L24288) — 11 columns

| col | header | colour |
|---|---|---|
| 1 | GRN No. | cyan code |
| 2 | Date | text2 11px |
| 3 | Client | bold |
| 4 | JW No. | purple mono bold |
| 5 | JW Line | purple mono |
| 6 | Client PO | text2 mono |
| 7 | Material Code | purple code |
| 8 | Material Name | default |
| 9 | **Received Qty** | green mono bold 14px |
| 10 | Remarks | text3 ellipsis |
| 11 | Received By | text3 |

---

## 4. addPartyGRN modal (L24298–24367) — header + multi-line

**Header** (auto-fills client + PO from JW selection):
- GRN No. (readonly auto)
- Date (default today)
- **JW No. ★** (datalist of open jobWorkOrders, triggers `_pgrnFillJW`)
- Client (readonly, filled from JW)
- Client PO No. (readonly, filled from JW)
- DC / Challan No.
- Remarks

**Lines** (`_pgrnLines[]`, auto-add first line on modal open):
| col | field | required |
|---|---|---|
| # | (auto) | — |
| JW Line | datalist of JW lines for selected JW | optional |
| **Material ★** | datalist of `db.partyMaterials` codes | ★ |
| Material Name | (auto-filled from pm.name) | — |
| **Qty ★** | number, green border | ★ ≥ 1 |
| UOM | (auto-filled from pm.uom) | — |
| Remarks | line-specific | — |
| 🗑 | remove line button | — |

+ Add Line button at top.

Validation: every line must have materialCode (must exist in Party Master) + qty ≥ 1.

**Side effects on save:**
- For each line: `pm.stockQty += qty`, `pm.receivedQty += qty`
- Push a `party_grn` row per line
- `logActivity('CREATE','Party GRN',grnNo+' — N items, Y pcs from '+jwNo)`
- toast confirming items + total

---

## 5. Required new schema

```
party_grn (
  id uuid PK, company_id, code (PGRN-NNNNN),
  grn_date,
  job_work_order_id uuid FK→job_work_orders,
  jw_code_text text,
  jw_line_no_text text,
  client_id uuid FK→clients, client_code_text, client_po_no,
  dc_no, remarks,
  received_by text,
  audit envelope
)
party_grn_lines (
  id uuid PK, company_id, party_grn_id FK,
  line_no integer,
  party_material_id uuid FK→party_materials,
  party_material_code_text, party_material_name,
  received_qty integer,
  jw_line_no_text,
  remarks,
  audit envelope
)
```

Cascade on save: increment `party_materials.stock_qty` and `received_qty` for each line.

---

## 6. Summary — building from scratch

### BLOCKERs (pair with party-material.md slice)
1. Two new tables (party_grn + party_grn_lines) + migration + RLS.
2. POST /party-grn endpoint (validates JW + Party Materials, multi-line, atomic stock update).
3. GET /party-grn list endpoint.
4. List page with 3-KPI strip + 11-col table + search.
5. Multi-line GRN modal with header auto-fill + per-line picker.
6. Sidebar entry "📥 Party Material GRN" under Store → Entry.

### DELTAs
7. Receive-against-JW-line dependency (when JW DC outward → JW DC inward flow lands).

### POLISH
- Auto-fill client/PO on JW select.

---

**Sign-off needed:**
- Confirm scope. Estimate ~700 LOC. Pair with party-material.md slice + jw-dc.md slice (all 3 share the JW workflow).
- Confirm `PGRN-NNNNN` 5-digit prefix.
