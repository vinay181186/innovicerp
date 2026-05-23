# PARITY — QC Dashboard (`renderQCEngineerDash`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L3963–4124 (`renderQCEngineerDash`, page `qcengineer`, title "QC Dashboard").
> **React target:** `apps/web/src/modules/qc-dashboard/routes/index.tsx` (route `/qc-dashboard`). Backend `useQcDashboard` already aggregates (T-040g).

---

## Verdict: functionally at parity, **wrong chrome** — refactor (no backend change)

The React page faithfully ports the legacy aggregation (KPI tiles, pending calls, engineer performance, rejection reasons) but is built in **shadcn chrome** (`<main className="container…">`, `<Card>`, `<Button>`, `<Input>`, `<Select>`, `<Table>`, Tailwind colour classes). Refactor to legacy chrome.

### 1. Header
| Legacy | React | Tag |
|---|---|---|
| `.section-hdr` "📊 QC Dashboard" + month `<input type=month>` + engineer `<select>` | h1 "QC dashboard" + shadcn Input/Select + a "Home" back button | **BLOCKER** chrome |

### 2. Summary tiles (legacy 7, L4087–4093)
PENDING CALLS (amber, "🔴 N overdue" sub-hint) · INSPECTED TODAY (cyan) · ACCEPTED TODAY (green) · REJECTED TODAY (red) · TODAY RATE · MONTH CALLS · MONTH RATE.
- React has **8 tiles** (splits Overdue into its own tile). **Match legacy 7** — fold overdue back into the Pending tile hint. **POLISH**.

### 3. Panels
| Legacy panel | React | Tag |
|---|---|---|
| Pending Calls table (JC·Operation·Item·Called·Wait·Qty·SO), oldest first, "▶ Go to QC Register" btn | `<Card>` + `<Table>` (no SO col, no Go-to-Register btn) | **BLOCKER** chrome; DELTA (SO col + register btn) |
| Engineer Performance table (Engineer·Calls·Accept·Reject·Rate·AvgResp + TOTAL row) | `<Card>` + `<Table>` (no TOTAL row) | **BLOCKER** chrome; DELTA (TOTAL row) |
| Top Rejection Reasons table (Reason·Count·Distribution bar) | `<Card>` + `<Table>` | **BLOCKER** chrome |

### Build (this slice)
Refactor `index.tsx` to legacy chrome: `.section-hdr`, `.innovic-input`/`.innovic-select`, legacy `.panel` mini-tiles (7, matching legacy), `.panel`/`.panel-hdr` + `.innovic-table` for the 3 tables, inline legacy colour tokens. Add the engineer-perf TOTAL row + pending SO column to match legacy. Backend/query untouched.
