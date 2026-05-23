# PARITY — Design Section (master matrix)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> **Skill applied:** `legacy-canonical-mapper` — 1:1, no invention.
> **Compiled:** 2026-05-23.

---

## Legacy sidebar → page → React mapping

Legacy Design group (HTML L441–449, ungrouped — all 7 items at root):

| # | legacy key | label (line) | legacy render fn | React route | Status |
|---|---|---|---|---|---|
| 1 | `designprojects` | 📋 Design Projects (L443) | `renderDesignProjects` L7570 + `_dpRenderDetail` L7623 | — | ❌ **MISSING** |
| 2 | `designissues` | ⚠ Design Issues (L444) | `renderDesignIssuesPage` L7890 | — | ❌ **MISSING** |
| 3 | `designworklog` | ⏱ Daily Work Log (L445) | `renderDesignWorkLog` L7935 (5 tabs) | — | ❌ **MISSING** |
| 4 | `bommaster` | 📦 BOM Master (L446) | `renderBOMMaster` L8438 | `/bom-masters` | ✅ SHIPPED |
| 5 | `designtracker` | 🎨 Design Tracker (L447) | `renderDesignTracker` L7259 | — | ❌ **MISSING** |
| 6 | `routecards` | 🗒 Route Cards (L448) | `renderRouteCards` L10078 | `/route-cards` | ✅ SHIPPED |
| 7 | `rpt_design` | 📊 Design Reports (L449) | `renderDeptReport('design')` L2476 | `/reports?group=Design` | ⚠️ Route lives — sidebar entry missing |

Current React: 2/7 shipped. **5 entries to build**.

---

## Data model (legacy `db.*` collections + transitions)

Two distinct subsystems share the Design dept:

### A) Design Tracker (older, single-table)
- `db.designTracker[*]` — per-SO design assignment with revision tracking
- `db.designTimeLog[*]` — time entries per design
- Status: `Pending | In Progress | Review | Approved | Revision`
- Numbering: `DSN-NNNN`
- Gate: BOM creation on Equipment SOs blocked until design is Approved (legacy `_dsnIsApproved`)

### B) Design Engineering (newer, multi-table, v82.0+)
- `db.designProjects[*]` — DP-NNNN. Status: `Design Active | In Review | Released | On Hold`. Has `checklist` (jsonb), `engineers[]`, `lead`
- `db.designTasks[*]` — per-project task. Priority: `Critical/High/Medium/Low`. Status: `Not Started/In Progress/In Review/Completed`. Has `discussions[]`
- `db.designIssues[*]` — per-project issue (optionally linked to task). Severity: `Critical/Major/Minor`. Status: `Open/In Progress/Resolved/Closed`. Has `discussions[]`
- `db.designWorkLog[*]` — daily timesheet per engineer × project. Categories: `Design / Review / Rework / Issue Resolution / Client Support / Meeting / Documentation / Testing/FEA / Other`
- `db.designDCRs[*]` — Design Change Request. DCR-NNNN. Status: `Submitted/Under Review/Accepted/Rejected`
- `db.designDCNs[*]` — Design Change Notice. DCN-NNNN. Linked to a DCR. Status: `Draft/In Progress/Review/Approved/Released`

The 12-item release checklist (legacy `_dpChecklist` L7515) is stored as a jsonb map on `design_projects.checklist`.

---

## Build plan (this session)

Ordered smallest-first by isolation, ensuring downstream features have their dependencies.

### Slice A — Migration `0033_phase8_design.sql`

8 new tables in one transaction:
- `design_tracker` + `design_time_log`
- `design_projects` + `design_tasks` + `design_issues` + `design_work_log`
- `design_dcrs` + `design_dcns`

Every table follows the standard envelope (`company_id`, audit cols, `deleted_at`, RLS company-isolation policy, manager-write policy).

### Slice B — Design Tracker (`/design-tracker`)

Per `renderDesignTracker` L7259 + helpers L7338–7489.

- 5-tile KPI strip (Total / Pending / In Progress / Review / Approved + conditional Overdue tile)
- 10-col list table (Design No. / SO / Item / Designer / Start / Target / Status / Rev / Hours / Actions)
- Modal flows: `+ Assign Design`, `✏ Edit`, `⏱ Log Time` (with previous entries shown), `✔ Submit Review`, `✅ Approve` (admin only), `↩ Revise` (admin only, with reason prompt → increments revision counter + appends to revision_history)
- BOM gate: `getIsDesignApproved(soId)` helper exposed for the BOM Master to consult on Equipment SOs.

### Slice C — Design Projects (`/design-projects`)

Per `renderDesignProjects` L7570 + `_dpRenderDetail` L7623 + tabs.

- List view: 5-tile KPI strip + filterable card grid (cards link to detail)
- Detail view: header + 4-tile KPI + 4 tabs (Tasks / Issues / Checklist / DCR-DCN)
  - **Tasks tab** — Table + Kanban view toggle. Add/Edit/View task modals. Per-task discussion thread.
  - **Issues tab** — Add/Edit/View issue modals. Discussion thread. Optional task linkage.
  - **Checklist tab** — 12-item release checklist by category. "Release Design Package" CTA appears when all checks done + all tasks complete + all issues resolved.
  - **DCR/DCN tab** — Sub-tab toggle (DCR Register / DCN Register). New DCR + New DCN modals.

### Slice D — All Design Issues (`/design-issues`)

Per `renderDesignIssuesPage` L7890.

- 4-tile KPI strip (Total / Open / Resolved / Critical) with click-to-filter
- Cross-project issue list with `_dpViewIssue` modal reuse from Slice C.

### Slice E — Daily Work Log (`/design-work-log`)

Per `renderDesignWorkLog` L7935 + sub-tab helpers L7947–8054.

- 5 tabs (My Timesheet / Daily View / Weekly View / Project Hours / Alerts)
- Entry form on My Timesheet + Recent Entries list grouped by date
- Daily View with engineer cards + per-engineer entries
- Weekly View — 7-col grid (Mon–Sun) + engineer rows + totals
- Project Hours — per-project total + breakdown by engineer + by category
- Alerts — unlogged days + low-hours days + 10-day utilization table

### Slice F — Sidebar parity

Add 5 missing entries per legacy L441–449 in correct order. Mirror the ungrouped layout (no group labels in legacy Design).

---

## Acceptance for "Design module 1:1 with HTML"

Every legacy Design sidebar link navigates to a React route that renders within ±5% of legacy DOM (chrome, columns, modals, KPI tiles, button labels, validation rules). Status machine transitions match legacy verbatim.

Tests deferred — user explicitly said "we will test once Design module built entirely" (carried over from store goal wording).
