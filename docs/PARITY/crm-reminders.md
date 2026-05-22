# PARITY — CRM Reminders & Follow-ups (`renderCRMReminders`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L16283–16357. Helpers: `_crmNewReminder` L16359, `_crmEditReminder` L16364, `_crmReminderForm` L16370, `_crmDoneReminder` L16416.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/crm-reminders` route. No `crm-reminders` module folder.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

Action queue for the Sales/CRM team: every reminder is a follow-up tied to either a lead OR a customer (clients). Reminders are auto-created when a lead's `nextActionDate` is set (see `crm-leads.md` §6). Users can also add them manually.

Schema fields referenced (`db.crmReminders[*]`):
- `id`, `leadId` (FK→leads), `customerCode` (FK→clients.code; only one of `leadId`/`customerCode` is set)
- `dueDate` (nullable)
- `actionType` (e.g. `Follow up`, `Call`, `Send quote`, `Visit`)
- `assignedTo` (user name; nullable)
- `notes`
- `status` (`Open` | `Done`)
- `createdAt`, `createdBy`, `completedAt`

---

## 1. Page chrome

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `⏰ CRM Reminders & Follow-ups` (L16299) | needs port |
| 2 | + New Reminder button | `_crmNewReminder()` (L16300) | **BLOCKER** |

---

## 2. KPI stat strip (L16304–16309) — 4 tiles

| # | Label | Value | Colour |
|---|---|---|---|
| 1 | Overdue | count `dueDate < today` (status≠Done) | sig-critical (red) |
| 2 | Today | count `dueDate === today` | sig-warn (orange) |
| 3 | Future | count `dueDate > today` | sig-info (blue) |
| 4 | No Date | count `!dueDate` | text3 (grey) |

**Tag:** **BLOCKER** — the funnel metric.

---

## 3. Bucketed sections (L16311–16346)

Reminders are filtered to non-`Done`, sorted by `dueDate` ascending (nulls last), then split into 4 panels rendered in order:

| section | filter | colour | title |
|---|---|---|---|
| 🔴 Overdue | `dueDate < today` | sig-critical | `🔴 Overdue (N)` |
| 🟡 Today | `dueDate === today` | sig-warn | `🟡 Today (N)` |
| 🔵 Coming Up | `dueDate > today` | sig-info | `🔵 Coming Up (N)` |
| ⚫ No Due Date | `!dueDate` | text3 | `⚫ No Due Date (N)` |

Each panel has a 3-px coloured left border + header + 5-column table:

| col | header | format |
|---|---|---|
| 1 | Due | `fmt(dueDate)` 11px bold (or `—` if no date) |
| 2 | Lead/Customer | `🔥 <leadCompany>` (from `db.leads`) or `🏢 <clientName>` (from `db.clients`); fallback `(no target)` |
| 3 | Action | `<actionType>` bold + `<notes>` below in muted 10px |
| 4 | Assigned | `r.assignedTo` |
| 5 | Actions | ✓ Done (sig-ok) + ✏ Edit |

Empty state (when no open reminders at all): full panel with ✅ icon and message "No open reminders. Add a reminder via + New Reminder button, or set a Next Action Date on a lead."

**Tag:** **BLOCKER**.

---

## 4. Reminder form (L16370–16414) — `_crmReminderForm`

`showModal` (not `showModalLg` — smaller). 5 fields in 2-col grid:

| pos | field | type | required | options |
|---|---|---|---|---|
| 1 | Lead or Customer * | select full-width | ★ | `L:<leadId>` for active leads (status≠Won/Lost), `C:<clientCode>` for all clients |
| 2 | Due Date | date | — | — |
| 3 | Action Type | text | — | placeholder `Call / Send quote / Visit` |
| 4 | Assigned To | select | — | active users; default `-- Anyone --` |
| 5 | Notes | textarea full-width | — | min-height 50px |

Target encoding: prefix `L:` for lead-targeted, `C:` for client-targeted; the save handler splits and stores the appropriate FK.

**Tag:** **BLOCKER**.

---

## 5. Mark-done flow (`_crmDoneReminder` L16416)

✓ Done button sets `status='Done'` + `completedAt=now()`. No confirmation dialog — single-click action.

**Tag:** **BLOCKER**.

---

## 6. Summary — building from scratch

This module pairs with `crm-leads.md` — same migration slice.

```
apps/web/src/modules/crm-reminders/
  ├── routes/list.tsx
  ├── components/reminder-form.tsx
  ├── components/reminder-section.tsx
  └── api.ts
apps/api/src/modules/crm-reminders/service.ts + routes.ts
packages/shared/src/schemas/crm-reminder.ts
```

Schema (Drizzle): `crm_reminders` table — RLS by company, FK to leads + clients, status enum.

### BLOCKERs
1. Schema + migration.
2. List page with 4-tile KPI + 4 bucketed sections.
3. New/Edit reminder form.
4. ✓ Done action (single-click).
5. Auto-create-from-lead path (covered in `crm-leads.md` §6 — same migration slice).

### DELTAs
- Today filtered list is hard-coded to "anyone" — consider adding "Mine only" toggle for personal workflows.
- Encoding `L:`/`C:` in the select value is brittle — React port should use two separate fields or a discriminated-union shape.

### POLISH
- Coloured left-border panels (3px, by section).
- 32px ✅ in empty state.

---

**Sign-off needed:**
- Confirm this slices with `crm-leads` as one PR (recommended — they share tables, modal patterns, status enum).
- Decide if "Mine only" filter is desired for v1.
