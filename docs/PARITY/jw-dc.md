# PARITY — JW Delivery Challan (`renderJWDC`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L24434–24447 (entry) + L24450–24486 (outward view) + L24488–24546 (`_jwdcNewOutward`) + `_jwdcInwardView` and `_jwdcNewInward` below. DC numbering: `JWDC-OUT-NNNN` / `JWDC-IN-NNNN`. Outward = returnable gate pass.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/jw-dc` route. No `jw_dc_outward` / `jw_dc_inward` tables.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

Two-tab page tracking material movement to/from JW vendors:

- **📤 Outward (to Vendor)** — Returnable Gate Pass when sending material out for job work
- **📥 Inward (Return from Vendor)** — receiving processed/returned material back

Connects to: regular `items` (deducts stock on outward, restores on inward), `purchaseOrders` filtered by `poType='Job Work'` (the JWPO).

---

## 1. Tab bar (L24440–24443)

| tab | label | colour | active set |
|---|---|---|---|
| `outward` | 📤 Outward (to Vendor) | purple | `window._jwdcTab='outward'` |
| `inward` | 📥 Inward (Return from Vendor) | green | `window._jwdcTab='inward'` |

---

## 2. Outward view (L24450–24486)

Header: `📤 Outward Register (Returnable Gate Pass)` + "+ New Outward DC" primary button.

Table — 10 cols:

| col | header | colour |
|---|---|---|
| 1 | DC No. | purple mono bold, click→print |
| 2 | Date | 11px |
| 3 | JWPO | cyan mono |
| 4 | Vendor | bold |
| 5 | Items | line count |
| 6 | **Sent** | purple mono bold |
| 7 | **Returned** | green mono |
| 8 | **Pending** | red if >0, green if 0 |
| 9 | Status | "Fully Returned" green / "Partial" cyan / "Out" red |
| 10 | Actions | 🖨 print + 👁 view |

Footer hint: `💡 Click DC No. to print. Material returns are tracked in 📥 Inward tab. ⚠ RETURNABLE — material comes back after processing.`

---

## 3. New Outward DC modal (L24489–24546)

**Header:**
- DC No. (auto `JWDC-OUT-NNNN`)
- Date
- **JWPO ★** (select of distinct `poNo` where `poType==='Job Work'`, status≠Cancelled)
- Vendor info (auto-filled from JWPO)

**Lines** (loaded from selected JWPO lines via `_jwdcLoadPOLines`):
Each line shows: itemCode · itemName · process · poQty · checkbox + send-qty input.

**Footer fields:**
- Vehicle No.
- Remarks

Validation: ≥1 line checked with `sendQty > 0`.

**Side effects on save:**
- Pushes `jw_dc_outward` row with lines `[{poLineId, itemCode, itemName, process, poQty, sentQty}]`
- For each line: deducts `item.stockQty` (max 0), pushes `store_transactions` (`type='OUT'`, `source='JW DC Outward'`)
- `logActivity('CREATE','JW DC Outward', ...)`
- Auto-opens print preview after save

---

## 4. Inward view (`_jwdcInwardView`)

Mirror of outward — DC received from vendor with material returning. Pushes `jw_dc_inward` row, restores stock via `IN` store_transactions, decreases outstanding-at-vendor count on related outward DC.

(Body not fully captured here — read L24560+ when implementing.)

---

## 5. Required new schema

```
jw_dc_outward (
  id uuid PK, company_id, code (JWDC-OUT-NNNN),
  dc_date,
  purchase_order_id uuid FK→purchase_orders (JWPO),
  jwpo_code_text,
  vendor_id uuid FK→vendors, vendor_code_text, vendor_name_text,
  vehicle_no, remarks,
  audit envelope
)
jw_dc_outward_lines (
  id uuid PK, company_id, jw_dc_outward_id FK,
  line_no, po_line_id FK→purchase_order_lines,
  item_id FK→items, item_code_text, item_name_text,
  process_text,
  po_qty integer, sent_qty integer,
  audit envelope
)
jw_dc_inward (
  id uuid PK, company_id, code (JWDC-IN-NNNN),
  inward_date,
  jw_dc_outward_id uuid FK,
  remarks, audit envelope
)
jw_dc_inward_lines (
  id uuid PK, company_id, jw_dc_inward_id FK,
  jw_dc_outward_line_id FK,
  received_qty integer,
  remarks, audit envelope
)
```

---

## 6. Summary — building from scratch

### BLOCKERs
1. Schema (4 tables + indexes + RLS).
2. Outward + Inward CRUD endpoints.
3. Two-tab page chrome.
4. Outward list table + New Outward modal (with stock deduction cascade).
5. Inward list table + New Inward modal (with stock restoration cascade).
6. Print template per legacy `_jwdcPrint`.
7. Sidebar entry "📋 JW Delivery Challan" under Store → Entry.

### DELTAs
8. Outstanding-at-vendor rollup (consumed by Item Tracker, At-Vendor column).

### POLISH
- Vehicle No on DC form.
- Print auto-open after save.

---

**Sign-off needed:**
- Confirm scope (~1500 LOC, the largest single Store module).
- Decide single-tab vs two-route structure: legacy is one route with tab switcher; React could be `/jw-dc/outward` + `/jw-dc/inward` (cleaner URLs).
- Confirm prefix conventions `JWDC-OUT-NNNN` / `JWDC-IN-NNNN`.
