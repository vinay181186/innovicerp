# PARITY — Dashboard (home landing page)

> Source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`, read directly
> 2026-06-03. The "Dashboard" = the **home landing page** `renderHome` (L2486),
> a role-aware view. NOT `renderDashboard` (L3658) — that's the Production
> Dashboard (already shipped as `production-dashboard`).

---

## 1. Surface map (legacy → ours)

`renderHome` (L2486) dispatches by mode + role:

| Mode / role | Legacy fn | Ours |
| ----------- | --------- | ---- |
| Customize screen (`_dashConfigMode`) | `_dashConfigScreen` L3390 | Home "Customize" view |
| Widgets view (`_dashWidgetMode`) | `_dashWidgetView` L3313 | Home "Widgets" view |
| Alerts view (`_homeMode='alerts'`) | `_homeAlertsView` L2878 | Home "Alerts" view (reuses `/alerts`) |
| auto + operator | `_homeOperatorView` L2674 | Home operator layout |
| auto + specialist (non-admin/mgr w/ primary dept) | `_homeSpecialistView` L2769 | Home specialist layout |
| auto + admin/manager (default) | `_homeAdminView` L2560 | Home admin layout |

Shared: `_homeHeader` L2530 (greeting + mode toggles), `_kpiCard` L2550,
`_homeStatRow` L2665, `_workListPanel` L3222 (My Work), `_renderQuickLinks`
L3380, work-list rules L2959–3193, `_dashWidgets` L3495, `_allQuickLinks` L3347.

Role routing (L2505-2518): operator→operator; non-admin/non-manager with
`!fullAccess` and a detected primary dept→specialist; else admin. Primary dept =
first true dept in order `qc,purchase,design,sales,store,production,finance,
planning` (`_detectPrimaryDept` L2522).

---

## 2. Data model — `dashboard_config` (migration 0052)

No table exists. New `dashboard_config`, ONE row per user, holding UI layout
preference. Legacy `db.dashboardConfig = [{userId, widgets:[keys], quickLinks:[pages]}]`.

| col | type | legacy |
| --- | ---- | ------ |
| id | uuid pk | |
| company_id | uuid | tenancy |
| user_id | uuid→users (UNIQUE per company) | userId |
| widgets | jsonb (ordered array of widget keys) | widgets[] |
| quick_links | jsonb (ordered array of page keys) | quickLinks[] |
| + standard audit cols | | |

`widgets`/`quick_links` are **ordered lists of enum-like UI keys** (layout
preference), not entity records — jsonb is the right shape (NOT the JSON-blob
**entity** anti-pattern #1, which is about storing collections of business
records as one document). `null`/absent = show all (defaults). RLS:
company_read + self_or_manager_write (`user_id = current_user_id()` OR mgr).

---

## 3. Server data (reuse-first)

Everything computed server-side (Rule #1/#6). Reuse:
- **`v_jc_op_status`** view (computed_status, op_type, qc_required, completed_qty,
  qc_accepted_qty, input_avail, available, outsource_status) for op/JC aggregates
  (running ops, ready ops, JC status, QC-pending).
- **`getMyAccess(user)`** (access-control) → `{fullAccess, departments{dept:bool}}`
  for layout routing + primary-dept detection + work-list dept gating.
- **`runAllAlerts(user)`** (alerts module) for the Alerts view + counts.
- raw SQL for SO / PO / PR / GRN / NC / customer_dispatches / op_log / machines.
- **tasks** + **capa** tables for My Work.

### `GET /dashboard/home` → role-aware payload
```
HomeResponse {
  userName, role, dateLabel,
  layout: 'admin' | 'operator' | 'specialist',
  primaryDept?: string,
  workList: WorkListItem[],          // §4
  // admin layout:
  kpis?: { activeSOs, overdueSOs, dueThisWeekSOs, openJCs, overdueJCs,
           machsRunning, machsTotal, todayOutputQty },
  today?: { grnReceived, dispatches, opsRunning, opsCompleted },
  needsAttention?: AttnItem[],       // hand-rolled, legacy L2630-2637
  // operator layout:
  operator?: { myOutputQty, myEntries, readyCount, allRunningCount,
               running: RunningOp[], ready: ReadyOp[] },   // legacy L2674
  // specialist layout (qc|purchase|design):
  specialist?: { dept, kpis: {label,value,sub,nav,color}[], panels: Panel[] },
}
```
`needsAttention` items (severity critical/warn/info): overdue SOs/POs/JCs (crit),
draft POs + pending PRs + pending NCs (warn), SOs due-this-week (info) — legacy
L2630-2637, capped 6.

### `GET /dashboard/widgets` → WidgetData[] (for Widgets view)
13 widgets (legacy `_dashWidgets`): open_sos, jc_status, running_machines,
machine_loading, qc_pending, stock_alerts, pr_pending, my_tasks, … (+ quick_links
is rendered client-side, full-width). Each widget = `{key, dept, label, icon,
color, navPage, data}` where `data` is the few numbers that widget shows. Server
computes `data`; web renders the card. Visibility filtered by dept access.

### `GET /dashboard/config` / `PUT /dashboard/config`
`{ widgets: string[]|null, quickLinks: string[]|null }`. PUT upserts the user's
row. Web Customize screen edits + saves (reorder widgets, toggle widgets +
quick links). Available widget/quick-link registries returned so the web can
render the chooser with labels/icons/dept + access flags.

---

## 4. Work List (My Work) — 9 rules, server-side

`_buildWorkList` L3196 runs 9 rules, each dept-gated, concatenated + sorted by
severity (critical<warn<info) then age desc. Each item:
`{ key, dept, severity, icon, title, detail, age, action:{label, navPage} }`.

| # | rule | gate | source |
| - | ---- | ---- | ------ |
| 1 | PO awaiting approval | purchase | purchase_orders status=draft; sev by age (>3 crit,>1 warn) |
| 2 | PR approved, no PO | purchase | purchase_requests status=approved & no linked PO |
| 3 | Pending incoming QC | qc | grn_lines qc_status=pending |
| 4 | Equipment SO BOM pending | design | sales_orders type=equipment & bom_status=pending & not closed |
| 5 | My assigned tasks | (all) | tasks assigned_to=me, status≠completed/cancelled; unread marker |
| 6 | My CAPAs | qc | capa_records responsible=me.name, status not closed/verified |
| 7 | Overdue JCs | production | v_jc_op_status rollup: due<today & not complete |
| 8 | Overdue PO delivery | purchase | purchase_orders open/partial & required_date<today |
| 9 | Stuck running ops | production | running_ops past expected cycle (elapsed/expected≥1) |

(Action `onclick` legacy nav targets map to our routes; `navPage` is our route
path. Some legacy actions open record modals — we point to the list route.)

The web My Work panel mirrors `_workListPanel`: severity-styled rows, age chips,
action buttons, "N critical · M total" badge, show-all expand (>10). Operator
home shows the compact `_workListStripOperator` (tasks + capas only, top 5).

---

## 5. Quick Links (`_allQuickLinks` L3347, `_renderQuickLinks` L3380)

~28 module shortcuts, each `{page, label, icon, color, dept}`. Shown filtered by
(a) dept access and (b) the user's `quick_links` selection (null = all accessible).
Web renders the same colored chip row → navigates to our route for that page.

---

## 6. Authorization & layout

- Read: any company member (RLS company_read). Layout/visibility is by
  `getMyAccess` (fullAccess / per-dept), exactly as legacy `_hasDeptAccess`.
- Config write: self or admin/manager.
- Quick-backup button (admin, L2538) — points to existing `/backup` (no new work).

## 7. Out of scope / deferred (noted)

- Login toast + `_markTasksViewed` on home render — tasks module already exposes
  `POST /tasks/mark-viewed`; the home calls it on mount (operator/specialist/admin
  all call it in legacy). Toast deferred (no global toast bus; unread badge in My
  Work covers it).
- Realtime auto-refresh — polling (TanStack Query) per ADR-004.
- `quickFill` deep-link into Op Entry from operator ready-rows — we navigate to
  `/op-entry` (the prefill side-channel is a follow-up).
- Stuck-running-ops elapsed-time math uses running_ops.start_date/time; if those
  are null the rule yields nothing (same as legacy guard).

No business-data conflicts found. `dashboard_config` jsonb-array storage is an
internal layout-preference choice (documented above), not a data conflict.
