# PARITY — Operator Master (`renderOperators`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L13699–13772 (list `renderOperators`, `operatorForm` L13726, `addOperator`/`editOperator`/`delOperator`).
> **React target:** `apps/web/src/modules/operators/routes/list.tsx` + `components/operator-form.tsx` (route `/operators`).

---

## Verdict: at parity ✅ (1 POLISH fixed)

### 1. List columns (legacy 6 → React 6)

| # | Legacy | React | Match? |
|---|---|---|---|
| 1 | Operator ID (cyan code) | ✅ cyan code → /operators/$id | ✅ |
| 2 | Name (bold) | ✅ | ✅ |
| 3 | Department (text2) | ✅ | ✅ |
| 4 | Skills / Machines | ✅ | ✅ |
| 5 | Status `badge(Active)` | ✅ badge — **was lowercase, now "Active"/"Inactive"** | ✅ (fixed) |
| 6 | Actions: Edit (canEdit) · Del (isAdmin) | View · Edit (admin/manager) | ⚠️ DELTA |

- Actions: React has **View** (→ detail page) + **Edit**; legacy has **Edit** + **Del**. React's detail/edit-page model replaces the legacy inline modal (an enhancement). **Delete** missing — DELTA (soft-delete not yet wired for operators; low-churn master).

### 2. Toolbar
- Title "Operator Master" ✅. Search "Search name, department…" ✅. "+ Add Operator" ✅.
- React adds a **status filter** dropdown — EXTRA, non-conflicting tooling, kept.

### 3. Empty state
- Legacy "No operators — click + Add Operator to begin" — React matches verbatim ✅.

### 4. Form (`operatorForm` L13726)
| Field | Legacy | React | Match? |
|---|---|---|---|
| Operator ID★ (readonly on edit) | ✅ | ✅ | ✅ |
| Name★ | ✅ | ✅ | ✅ |
| Department | ✅ | ✅ | ✅ |
| Status (Active/Inactive) | ✅ | ✅ | ✅ |
| Skills / Machines (full) | ✅ | ✅ | ✅ |
| Linked User (optional) | — | EXTRA (our `userId`) | additive |

### Remaining (DELTA)
- Operator **Delete** (soft-delete) action — needs backend delete endpoint + confirm dialog.
