# PARITY — CRM Leads & Pipeline (`renderCRMLeads`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L15998–16092 (`function renderCRMLeads()`). Supporting modals: `_crmNewLead` L16100, `_crmEditLead` L16105, `_crmLeadForm` L16111, `_crmConvertLead` L16188. Filter helper: `_crmFilterByStatus` L16094.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/crm-leads` / `/leads` route exists. No `apps/web/src/modules/leads/` or `crm-leads/` folder.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

A sales pipeline view: lead-stage funnel + KPI strip + leads table + lead form modal + lead→customer conversion. Sales/CRM team's primary screen for managing prospects.

Schema fields referenced in legacy (`db.leads[*]`):
- `id`, `leadNo` (auto-generated `LEAD-NNNNN`)
- `companyName`, `contactPerson`, `phone`, `email`
- `source` (one of `_CRM_LEAD_SOURCES`)
- `status` (one of `_CRM_LEAD_STATUSES`: New, Contacted, Quoted, Negotiating, Won, Lost, Dormant)
- `interest` (product/inquiry description)
- `estimatedValue` (₹)
- `assignedTo` (user name)
- `nextActionDate`, `nextActionType`
- `notes`
- `createdAt`, `createdBy`

---

## 1. Page chrome

| # | Element | Legacy (line) | Tag |
|---|---|---|---|
| 1 | Section header | `🔥 Leads & Pipeline` (L16024) | needs port |
| 2 | + New Lead button | `_crmNewLead()` (L16025) | **BLOCKER** |

---

## 2. Pipeline funnel (L16029–16040)

Single panel with 7 cells in a `grid-cols-7` row, one per `_CRM_LEAD_STATUSES`:

| status | count colour | click action |
|---|---|---|
| New | text2 | filter by status |
| Contacted | text2 | filter by status |
| Quoted | blue `#3b82f6` | filter by status |
| Negotiating | amber `#f59e0b` | filter by status |
| Won | `var(--sig-ok)` (green) | filter by status |
| Lost | `var(--text3)` (grey) | filter by status |
| Dormant | text2 | filter by status |

Cells are clickable; click sets `window._crmStatusFilter` and re-renders.

**Tag:** **BLOCKER** — this is the visual pivot of the screen.

---

## 3. KPI stat cards (L16043–16049) — 5 tiles

Below the funnel, an auto-fit grid of 5 stat cards:

| # | Label | Value | Colour |
|---|---|---|---|
| 1 | Open Leads | `leads - won - lost` count | sig-info (blue) |
| 2 | Pipeline Value | Σ `estimatedValue` where not Won/Lost, formatted `₹ N` IN-style | sig-info |
| 3 | Hot Pipeline | Σ `estimatedValue` where status ∈ {Quoted, Negotiating} | amber `#f59e0b` |
| 4 | Today's Follow-ups | count where `nextActionDate === today` | sig-warn (orange) |
| 5 | Overdue | count where `nextActionDate < today` AND status ∉ {Won, Lost} | sig-critical (red) |

**Tag:** **BLOCKER** — operations metrics.

---

## 4. Status filter banner (L16052–16058)

When `window._crmStatusFilter` is set, a thin banner appears above the table: `Filtered by status: <X> (N leads)` + ✕ Clear button.

**Tag:** **POLISH** (follows from §2 click-to-filter).

---

## 5. Leads table (L16085–16089) — **8 columns**

| # | header | data | format | tag |
|---|---|---|---|---|
| 1 | Lead No. | `l.leadNo` | mono cyan 11px | **BLOCKER** |
| 2 | Company / Contact | `companyName` bold + `contactPerson` muted below | 2-line cell | **BLOCKER** |
| 3 | Source | `l.source` | 11px text | **BLOCKER** |
| 4 | Status | status pill — `bg <statusColor>22`, `color statusColor`, 10px bold | colour by status | **BLOCKER** |
| 5 | Est. Value | `₹ N` formatted `en-IN` | mono bold, sig-info, td-right | **BLOCKER** |
| 6 | Next Action | `Today` (warn) / `overdue` (critical bold) / formatted date | colour-coded | **BLOCKER** |
| 7 | Assigned | `l.assignedTo` | 11px text | **BLOCKER** |
| 8 | Actions | ✏ Edit + 💬 Log Comm + →C Convert (only when not Won/Lost) | inline buttons | **BLOCKER** |

Zebra striping: `i%2===0?'var(--bg)':'var(--bg3)'`.

Sort: by `nextActionDate` ascending (nulls last), then `createdAt` descending (L16000–16006).

Empty state: `No leads yet. Click + New Lead to add the first one.`

---

## 6. Lead form modal (L16111–16185) — `_crmLeadForm`

`showModalLg` with title `🔥 New Lead — <leadNo>` or `✏ Edit Lead — <leadNo>`.

13 form fields in 2-column grid:

| pos | field | type | required | source/options |
|---|---|---|---|---|
| 1 | Lead No. | read-only display | — | auto `_nextSeriesNo('LEAD-', db.leads, 'leadNo', 5)` |
| 2 | Status | select | — | `_CRM_LEAD_STATUSES` |
| 3 | Company Name * | text full-width | ★ required | — |
| 4 | Contact Person | text | — | — |
| 5 | Phone | text | — | placeholder `+91 90000 00000` |
| 6 | Email | text | — | — |
| 7 | Source | select | — | `_CRM_LEAD_SOURCES` |
| 8 | Product / Interest | text full-width | — | — |
| 9 | Estimated Value (₹) | number | — | — |
| 10 | Assigned To | select | — | active users from `db.users` |
| 11 | Next Action Date | date | — | — |
| 12 | Next Action Type | text | — | placeholder `Call / Email / Send quote` |
| 13 | Notes | textarea | — | min-height 60px |

**Side effect on save (L16166–16179):** if `nextActionDate` is set on create, **auto-creates** a row in `db.crmReminders` with `actionType: nextActionType || 'Follow up'`, `notes: 'Auto-created from lead <leadNo>'`, `status: 'Open'`, `assignedTo`.

**Tag:** **BLOCKER** — form is the entry point.

---

## 7. Convert-to-customer flow (L16188+)

Triggered by →C button (L16080). Confirmation dialog: "Convert lead '<name>' to a customer? This will: • Create a new Client Master entry • Mark lead as Won • Link communications history. Proceed?"

If a client with matching company name already exists → reuse its code. Otherwise → create new client. Then mark lead status → Won. (Full body cut off at L16196 — read more if needed.)

**Tag:** **BLOCKER** — this is the lead-funnel terminal action.

---

## 8. Log communication (L16079)

💬 button per row → `_crmLogComm(null, l.id)`. Opens a communications log modal (not shown here; lives nearby). Communications drive the Customer 360° view.

**Tag:** **BLOCKER** (lead-side activity log).

---

## 9. Constants referenced (need porting)

```
_CRM_LEAD_STATUSES = [...]   // 7 stages — find definition in legacy
_CRM_LEAD_SOURCES  = [...]   // sources list — find definition in legacy
```

---

## 10. Summary — building from scratch

This is a **net-new module** for React. Recommended structure:

```
apps/web/src/modules/leads/
  ├── routes/list.tsx           — pipeline + stats + table
  ├── routes/new.tsx            — new lead form (or modal-route)
  ├── routes/edit.tsx           — edit lead form
  ├── components/lead-form.tsx  — shared 13-field form
  ├── components/lead-pipeline-funnel.tsx
  ├── components/lead-stat-strip.tsx
  └── api.ts                    — TanStack Query hooks
apps/api/src/modules/leads/
  ├── service.ts                — CRUD + convert
  ├── routes.ts                 — GET /leads, POST /leads, ...
  └── ...
packages/shared/src/schemas/lead.ts
                                — Zod schemas + status/source enums
```

Schema (Drizzle) needs new tables: `leads`, possibly `lead_communications` (for Customer 360°), `crm_reminders` (also referenced by `renderCRMReminders` — separate module).

### BLOCKERs (entire module is BLOCKER for the CRM team)
1. Schema + RLS + migrations for `leads` and `crm_reminders`.
2. List page: funnel + 5 KPI tiles + table.
3. New/Edit lead form (13 fields).
4. Status filter via funnel-cell click.
5. Convert-to-customer flow (creates/links Client Master entry).
6. Auto-create reminder on lead save when `nextActionDate` set.
7. Log-comm button (deferred to CRM Customer 360° doc).

### DELTAs
- The original is a single-file render with global state (`window._crmStatusFilter`). React port should use URL search-state for the filter so deep links work.

### POLISH
- `₹ N` formatting via `Intl.NumberFormat('en-IN')`.
- Status pill colours match legacy hex values exactly.

---

**Sign-off needed before code:**
- Confirm scope: the whole module (schema + API + web + form + convert flow). Estimate: ~600–800 LOC across 8 files.
- Decide: SO-form Quick-add equivalent here? (i.e., quick-add a Lead from another screen.)
- Confirm `_CRM_LEAD_STATUSES` + `_CRM_LEAD_SOURCES` enums — capture exact list from legacy file before building.
