# PARITY — Planning sidebar block (#sidebar > .sb-mod-planning)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L399–406 (sidebar HTML). Dept-color block at L23 (`--dept-planning:#6d4ab8;--dept-planning-bg:#ede9f7`). Page-title map L2219, icon map L2256, dept-grouping L2336, render map L2384–2419.
> **React target:** `apps/web/src/components/shared/sidebar.tsx` L48–65 (SECTIONS[0] `key:'planning'`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## Comparison matrix

### Section header (L399)

| # | Element | Legacy (L399) | React (sidebar.tsx) | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Section key | `'planning'` | `key: 'planning'` | ✅ | — |
| 2 | Section label | `Planning` | `Planning` | ✅ | — |
| 3 | Section icon | 📋 (`&#128203;`) | 📋 | ✅ | — |
| 4 | Mod class | `sb-mod-planning` | `modClass: 'planning'` → `sb-mod-planning` | ✅ | — |
| 5 | Dept colour | `#6d4ab8` (`--dept-planning`) | inherits CSS var (no override) | ✅ | — |
| 6 | Default open | collapsed (`display:none` L400) | auto-opens if current route is inside section, else collapsed | ✅ (richer) | — |

### Section items (L401–405)

| # | Position | Legacy item (line) | React item (sidebar.tsx) | Match? | Tag |
|---|---|---|---|---|---|
| 1 | 1st | `plandash` · 📊 **"Planning Dashboard"** (L401) | `/planning-dashboard` · 📊 **"Plan Dashboard"** | ❌ label paraphrased | **POLISH** (label only — "Plan" vs "Planning") |
| 2 | 2nd | `planning` · 📋 **"SO/JW Planning"** (L402) | `/planning` · 🎯 **"SO/JW Planning"** | ❌ icon | **POLISH** (icon 🎯 vs legacy 📋) |
| 3 | 3rd | `sooverview` · 📊 **"SO Overview"** (L403) | *(missing — `/so-overview` lives under "Sales & CRM → Reports" instead)* | ❌ wrong section | **BLOCKER** (planners expect SO Overview in Planning per legacy) |
| 4 | 4th | `sostatus` · 📊 **"SO Status Review"** (L404) | *(missing — `/sales-orders/$id/status` reachable only from drill-throughs)* | ❌ missing from sidebar | **BLOCKER** (no direct sidebar entry — only reachable by clicking activity icons in SO Overview) |
| 5 | 5th | `assytracker` · 📦 **"Assembly Tracker"** (L405) | `/assemblies` · 🔧 **"Assembly Tracker"** | ❌ icon, ❌ position | **POLISH** icon (🔧 vs 📦); position differs because items 3–4 are missing — order auto-fixes when they're added |
| — | extra | *(not in legacy Planning sidebar)* | `/plans` · 📋 **"Plans"** | ⚠️ EXTRA IN REACT | **DELTA** — legacy has no top-level "Plans" entry; plans are reached via Plan Dashboard recent-plans table. Keeping is acceptable; consider moving below assytracker. |
| — | extra | *(legacy puts `jobcards` under Production at L459)* | `/job-cards` · 🏭 **"Job Cards"** | ⚠️ EXTRA IN REACT | **DELTA** — legacy renders Job Cards under Production dept (`dept:'production'` L3353). Today it lives under Planning. Move-out is a separate ticket; not blocking. |

### Dept-grouping consistency (L2336, L2894, L3349–3352)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Pages tagged `dept:'planning'` | `['planning','sooverview','sostatus','plandash','assytracker']` (L2336) | sidebar Planning section: `['planning-dashboard','planning','plans','assemblies','job-cards']` | ❌ | mirrors row-by-row tags above |
| 2 | Default page when dept tile is clicked | `'planning'` (L2894 `deptPages.planning`) | n/a — no dept-tile pattern in React today | ❌ | **POLISH** (dept tiles aren't shipped; defer) |

---

## Page-title map (L2219–2221)

Legacy `_pageTitles` for Planning pages:

| page | title |
|---|---|
| `plandash` | `Planning Dashboard` |
| `planning` | `SO/JW Planning` |
| `sooverview` | `SO Overview` |
| `sostatus` | `SO Status Review` |
| `assytracker` | `Assembly Tracker` |

React `section-hdr` strings today:

| route | hdr text | match? |
|---|---|---|
| `/planning-dashboard` | `📊 Planning Dashboard` | ✅ |
| `/planning` | (see `docs/PARITY/so-planning.md` §1.1) | — |
| `/so-overview` | `📋 SO Overview` | ✅ |
| `/sales-orders/$id/status` | (see `docs/PARITY/so-status.md`) | — |
| `/assemblies` | `🔧 Assembly Tracker` | ❌ legacy uses 📦 in sidebar but `_pageTitles` has no icon — React adds an icon prefix; pick **📦** to match sidebar |

---

## Summary

Total elements: 14
Matching: 6
Differing: 8 (2 BLOCKER + 1 DELTA-extra-Plans + 1 DELTA-extra-JobCards + 4 POLISH)

### BLOCKERs
1. **Add `/so-overview` to Planning sidebar** — currently under Sales & CRM. Either move it, or add a second entry under Planning. Legacy puts it under Planning only.
2. **Add `/sales-orders/$id/status` entry to Planning sidebar** — legacy has a top-level "SO Status Review" link (L404) that opens an SO picker / index. Today it's drill-through-only. Likely needs an index route `/so-status` (SO picker) before this entry is useful.

### DELTAs (workable today; review later)
3. **Plans entry** — legacy doesn't surface a Plans index in the sidebar. Keep as a React-only convenience; reposition below `assytracker` so the legacy order is preserved at the top.
4. **Job Cards entry** — legacy puts it under Production. Move to Production section in a future sidebar ticket; today's placement is functional.

### POLISH (deferred)
5. Label "Plan Dashboard" → "Planning Dashboard" (one extra letter).
6. Icon for SO/JW Planning: 🎯 → 📋.
7. Icon for Assembly Tracker: 🔧 → 📦.
8. (Future) dept-tile click target for dashboard widgets.

---

**Sign-off needed before code:**
- Confirm the 2 BLOCKERs above are the right scope (or downgrade if SO Status Review isn't reachable as an index page yet).
- Approve moving `/so-overview` from Sales to Planning (or keep dual-mounted).
- Decide whether `/plans` and `/job-cards` should be removed from Planning per legacy, or kept as React conveniences.
