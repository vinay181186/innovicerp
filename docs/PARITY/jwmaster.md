# PARITY — JW Master (`renderJWMaster`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L12642–12688 (`function renderJWMaster()`). Helpers: `addJW`, `editJW`, `delJW`, `_jwLineRowHtml`, `_jwFillItem`, `_jwFillRmItem`, `_jwAddRmItem`.
> **React target:** `apps/web/src/modules/job-work-orders/routes/list.tsx` (route `/job-work-orders`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## 0. Route + entry points

- ✅ Route `/job-work-orders` exists.
- ✅ Sidebar entry "🔧 JW Master" under Sales & CRM → Entry.
- ⚠️ Section header: legacy = `JW Master — Job Work (Material from Client)` (L12675). React = `Job Work Orders`. **POLISH** (label).
- ❌ Info banner above the table (L12681–12683) — green-tinted box explaining "Job Work: Client provides raw material → We machine/process it → Deliver finished parts." **POLISH** (helpful context for new users).

---

## 1. Toolbar (L12676–12679)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Search input | "Search JW, client, item..." 220px | (verify React has a search) | ⚠️ | **POLISH** |
| 2 | **+ New JW Order** button | yes — `addJW()` | (verify) | ⚠️ | likely ✅ |

---

## 2. List table — columns (L12651–12670, L12685 header row)

Legacy renders **14 columns** (one row per JW line — not grouped like SO Master):

| # | header | data | React match? | tag |
|---|---|---|---|---|
| 1 | JW No. | `td-code cyan` | ✅ "JW No." | ✅ |
| 2 | Line | `lineNo` centered mono cyan 11px | ❌ missing | **DELTA** (React groups by JW header — confirm) |
| 3 | Date | `jwDate` formatted | ✅ "Date" | ✅ |
| 4 | Client | `clientCode — customer` OR `customer` | ⚠️ "Client" col (verify prefix) | **POLISH** |
| 5 | Client PO | `clientPoNo` purple mono + 📎 file link | ❌ missing | **BLOCKER** (PO traceability) |
| 6 | Item Code | `itemCode \|\| partNo` | ❌ missing | **DELTA** (workable since lines are grouped under JW) |
| 7 | Part Name | `partName` | ❌ missing | **DELTA** |
| 8 | Qty | `orderQty` centered mono | ❌ missing (only Total Qty) | **DELTA** (per-line vs aggregate) |
| 9 | JC Qty | `jcQty/orderQty` green/amber/grey | ✅ "JC Qty" | ✅ |
| 10 | **Material** | `materialReceivedQty` vs `orderQty` → ✓ Full / ◑ Partial / ✕ Not Received | ✅ "Material" col | ✅ |
| 11 | Due | `dueDate` formatted | ❌ missing | **BLOCKER** (planner sees overdue JWs) |
| 12 | Status | `badge(status)` | ✅ "Status" | ✅ |
| 13 | Remarks | ellipsis 100px | ❌ missing | **POLISH** |
| 14 | Actions | Edit + Del buttons | ❌ missing | **BLOCKER** (basic CRUD) |

Note: React table = 7 visible columns (JW No · Date · Client · Lines · Total Qty · JC Qty · Material · Status). Per-row Edit/Del missing.

---

## 3. Row click behaviour

- Legacy: no row-click handler — rows are not interactive. Edit/Del via action buttons.
- React today: JW No. cell is a `<Link>` to `/job-work-orders/$id` (detail page). ⚠️ EXTRA IN REACT (workable).

---

## 4. Out-of-screen modal: `addJW` / `editJW`

The Add/Edit JW modal (legacy L12692+ via `_jwLineRowHtml`) is a multi-row line editor with:
- Item code datalist with autofill from Item Master
- Per-line Part Name, Drawing No, Qty, Rate, Amount (auto-calc), Due Date
- Quick "+ Add -rm Item" button for client raw material (`_jwAddRmItem`)
- "From-stock" client material picker

**Out of scope** for this list-view parity doc — captured in a separate `jwmaster-form.md` parity doc when needed.

---

## 5. Summary — BLOCKERs for daily use

1. **Client PO column** (§2 #5) — PO traceability.
2. **Due column** (§2 #11) — overdue visibility.
3. **Action buttons** (Edit / Del) per row (§2 #14) — basic CRUD.

### DELTAs (workable today)
4. List grouping: legacy = one row per line; React = grouped by JW header. React's structure is cleaner; keep.
5. Per-line columns (Line, Item Code, Part Name, per-line Qty) — only useful when not grouped.

### POLISH
- Section label: "Job Work Orders" → "JW Master — Job Work (Material from Client)".
- Info banner explaining the JW concept.
- Customer column prefix (clientCode — customer).
- Remarks column with title-tooltip.

---

**Sign-off needed before code:**
- Confirm the 3 BLOCKERs above are scope for a `JW-1b` slice.
- Decide whether to keep React's JW-header grouping (recommended) or revert to legacy's flat-per-line list.
- Confirm whether the legacy info banner should be ported (recommended — helpful context).
