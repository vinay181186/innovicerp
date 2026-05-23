# PARITY — Production Section (consolidated)

> Legacy source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Goal (2026-05-23): map every Production page from HTML, map remaining differences, build same as HTML. Build directly, no commit prompts; ask only on data conflicts; full-module testing at the end.

Canonical Production pages (legacy `render()` dispatch L2382, dept `production`):

| Page | Legacy fn | React route | Status |
|---|---|---|---|
| Job Cards | `renderJobCards` L5739 | `/job-cards` | ✅ **list built** (14-col) · create/edit modal remains |
| Operator Master | `renderOperators` L13699 | `/operators` | ✅ **at parity** (status label fixed) |
| Machine Master | `renderMachines` L13070 | `/machines` | ⚠️ **mapped** — 4 backend cols remain |
| Op Entry | `renderOpEntry` L5202 | `/op-entry` | ⚠️ **functional, chrome refactor needed** |
| Shop Floor / Machine Op Entry | `renderShopFloor` L10286 | `/op-entry/machines` + `/op-entry/running` | ⚠️ **functional, chrome refactor needed** |
| Machine Loading | `renderLoading` L5021 | — | ❌ **missing** (needs `v_machine_load`) |
| Production Dashboard | `renderDashboard` L3658 | — | ❌ **missing** (needs calc aggregation) |

Per-page detail: `production-{job-cards,operators,machines,op-entry,shop-floor,machine-loading,dashboard}.md`.

---

## Build waves

- **Wave 1 (done):** JC list 14-col full-stack parity (`5687534`); Operator + Machine master parity/map (`d89feec`).
- **Wave 2 (frontend-only, no migration):** Op Entry + Shop Floor legacy-chrome refactor (pages work; convert shadcn→`.panel`/`.innovic-table`/`.btn`); add Op-Entry preview card + global Ready-to-Process panel.
- **Wave 3 (full-stack, needs `v_machine_load`):** Machine Loading page; backfill Machine Master cols 7-8 + Shop-Floor card load bars.
- **Wave 4 (full-stack):** Production Dashboard (reuses Wave 3 aggregation).
- **Wave 5 (full-stack):** JC create/edit modal + backend JC writes (ops routing builder, drawing + QC-doc upload), JC print, JC delete.

## Cross-cutting backend gaps
1. **`v_machine_load`** — per-machine avail qty, pending hrs, daily cap, days-to-clear, load %, load status. Powers Machine Loading + Production Dashboard + Machine Master + Shop-Floor cards.
2. **`machines` columns** — `hour_rate`, `maint_cycle_days`, `last_maint_date` + `machine_maint_log` table.
3. **JC write endpoints** — create/update/delete job cards with ops + docs (Phase-3-level; currently read-only).

> New migrations intentionally deferred while uncommitted store-wave migrations (0030–0032) remain in the working tree, to avoid sequence entanglement. Resume migration-bearing waves (3-5) once those land.
