# PARITY — Item Master (`renderItems`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L11481–11521. Helpers: `itemForm` L11523, `addItem`, `editItem`, `delItem`, `viewItemDetail`, `attachItemDrawing` L11566, `printDrawingFile`, `itemImportTemplate`/`itemImportExcel`.
> **React target:** `apps/web/src/modules/items/routes/list.tsx` (route `/items`). Already at high parity.

---

## 0. Route + entry points

- ✅ Route `/items` exists.
- ✅ Sidebar entry "◉ Item Master" under Store → Master (matches legacy L434).
- ✅ Section header label "Item Master" matches legacy L11503.

---

## 1. Toolbar (L11502–11509)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Search input | "Search code, name, material…" 220px | ✅ React has search | ✅ | — |
| 2 | ⬇ Template button | `itemImportTemplate()` | ❌ missing | **DELTA** (Excel gap) |
| 3 | 📄 Import Excel button | `itemImportExcel()` | ❌ missing | **DELTA** (Excel gap) |
| 4 | + Add Item button | `addItem()` modal | ✅ React → `/items/new` | ✅ | — |

---

## 2. List table — columns (L11483–11499, L11513)

Legacy: **9 columns** `Code · Name · Description · Drawing No · Rev · Material · UOM · Drw (drawing print btn) · Actions`.

| # | header | data | React match? | tag |
|---|---|---|---|---|
| 1 | Item Code | purple code | ✅ | — |
| 2 | Name | bold | ✅ | — |
| 3 | Description | text2 11px | ✅ | — |
| 4 | Drawing No. | mono 11px | ✅ | — |
| 5 | Rev | centered | ✅ | — |
| 6 | Material | default | ✅ | — |
| 7 | UOM | tag | ✅ | — |
| 8 | Drw (drawing print) | print btn when `drawingData` exists | ✅ "Drw" column | ✅ structurally |
| 9 | Actions | View / Edit / Del | ✅ React has Actions column | ✅ |

Row click: legacy `viewItemDetail(id)`. React: per-row link. ✅

---

## 3. itemForm modal (L11523–11558)

7 fields:
- Item Code ★ (readonly when editing)
- Item Name ★
- Description (full-width)
- Drawing No.
- Revision (default "A")
- Material
- UOM (NOS / KGS / SET / MTR)
- Drawing File attach (image/PDF, max 5MB) — uses `_fsUploadAndRegister` via fileRegistry

React: `apps/web/src/modules/items/components/item-form.tsx` — verify all 7 fields are present with same labels.

---

## 4. Footer hint (L11518)

`★ Item Master is for defining items only. Stock / Inventory is managed in Store → Store / Inventory.`

- ❌ Footer hint missing in React. **POLISH**.

---

## 5. Summary

### BLOCKERs
*(none — page is largely at parity)*

### DELTAs
1. Excel template + import — project-wide Excel gap.

### POLISH
2. Footer hint about Item Master vs Stock/Inventory split.

---

**Sign-off needed:**
- Verify items detail/edit/new routes have the 7-field form with same labels.
- Verify Drw column shows a print button when an item has a drawing attached.
- Confirm drawing-file attach uses the project's Supabase Storage helper.
