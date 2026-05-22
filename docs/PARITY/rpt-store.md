# PARITY — Store Reports (`renderDeptReport('store')`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L20029 (`renderDeptReport`). Store-dept tabs from `_deptReportTabs.store` L20004–20009. Tab bodies live in `_rptDCOut` / `_rptDCIn` / `_rptMatVendor` / `_rptIssueTracker`.
> **React target:** ❌ generic `/reports` exists; **Store-dept variant NOT yet exposed** — no items currently tagged with `group: 'Store'`.

---

## 0. Tab inventory (legacy L20004–20009)

| tab key | label | colour | body fn |
|---|---|---|---|
| `dcout` | **JW DC Outward** | `#8B5CF6` (purple) | `_rptDCOut()` |
| `dcin` | **JW DC Inward** | `#06B6D4` (cyan) | `_rptDCIn()` |
| `matvendor` | **Material at Vendor** | `#EF4444` (red) | `_rptMatVendor()` |
| `isstrack` | **Issue & Tool Tracker** | `#D97706` (orange) | `_rptIssueTracker()` |

Dept color: `#D97706` (orange/store). Header: `📊 Store Reports`.

---

## 1. Reports needed for React

To expose Store-dept variant via the existing /reports framework (similar to how Sales-dept variant landed with `?group=Sales`):

| # | report | data needed | tag |
|---|---|---|---|
| 1 | JW DC Outward | jw_dc_outward + lines | **BLOCKER** — gated by `jw_dc_outward` table |
| 2 | JW DC Inward | jw_dc_inward + lines | **BLOCKER** — gated by `jw_dc_inward` table |
| 3 | Material at Vendor | derived: outward sent − inward received per (item, vendor) | **BLOCKER** — gated by JW DC tables |
| 4 | Issue & Tool Tracker | store_issues + tool_issues | **BLOCKER** — gated by those tables |

**Net assessment:** all 4 reports are blocked by **JW DC** + **Item/Tool Issue** schemas (covered in `jw-dc.md`, `issue-register.md`, `tool-issue.md`). Once those land, the 4 reports are mechanical to add — each is a separate definition file (one tx.execute aggregation), tagged `group: 'Store'`, then `/reports?group=Store` works for free (same pattern as Sales).

---

## 2. Sidebar entry

After the first Store report ships (likely `material-at-vendor` after JW DC), add:

```ts
{ to: '/reports?group=Store', label: 'Store Reports', icon: '📊' }
```

…under Store → Report group.

---

## 3. Summary

### BLOCKERs
1. All 4 reports are gated by the underlying tables (JW DC, store_issues, tool_issues).
2. Once any of those land, ship the corresponding report definition.

### DELTAs
- Generic `/reports` framework already supports the `?group=X` filter (added in PL-RPT-1). Nothing to do framework-side.

### POLISH
- None.

---

**Sign-off needed:**
- This doc is essentially **a dependency-tracking note** for the Store-dept reports. No code to write here until the upstream tables exist.
- Schedule report definitions to ship in the same slices as their tables: `mat-at-vendor` with jw-dc; `issue-tracker` with issue/tool-issue.
