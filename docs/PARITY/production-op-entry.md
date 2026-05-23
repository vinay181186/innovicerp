# PARITY — Op Entry (`renderOpEntry`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L5202–5352 (list `renderOpEntry`), helpers `updateOpForm`/`quickFill`/`submitOpEntry` L5354+, `submitStartOp`.
> **React target:** `apps/web/src/modules/op-entry/routes/index.tsx` + `components/{op-entry-form,jc-ops-table,op-log-history}.tsx` (route `/op-entry`).

---

## Verdict: functionally complete, **wrong chrome + structure** — refactor needed

The React page **works** (backend wired: enriched ops, op_log, running ops, start/stop, QC sub-form). But it is built in **shadcn/Tailwind chrome** (`container max-w-6xl py-10`, `<Button>`/`<Input>`/`<Label>`/`<Select>`/`<Textarea>`, `rounded-md border bg-card`) — not legacy chrome — and its layout diverges from legacy. This is a `refactor-page-to-legacy` job + a structural alignment.

### 1. Page shell / chrome
| Element | Legacy | React | Tag |
|---|---|---|---|
| Wrapper | `<div style="max-width:980px">` | `<main className="container max-w-6xl py-10">` | **BLOCKER** chrome |
| Header | `.section-hdr` "Operation Entry" | `<h1 class="text-2xl…">Op Entry</h1>` + subtitle | **BLOCKER** chrome |
| Panels | `.panel`/`.panel-hdr`/`.panel-body` | `rounded-md border bg-card` | **BLOCKER** chrome |
| Buttons/inputs | `.btn`/`.innovic-input`/`.innovic-select` | shadcn components | **BLOCKER** chrome |

### 2. Structure / layout (legacy L5272–5351)
| # | Legacy | React | Tag |
|---|---|---|---|
| 1 | **Start ▶ / Complete ✓ mode toggle** in entry panel header | Start/Stop buttons in form footer (no top-level mode toggle) | **DELTA** — different but functional |
| 2 | Single **JC No. + Op Seq** datalist search (2 inputs) | JC search loads ops into a **table**; select a row | **DELTA** — React's table-select is arguably clearer |
| 3 | **Op preview card** (Order/Done/Available/Running nums + CPO/QC-REQ/REWORK badges + running banner) | sits inside JcOpsTable row + form header | **DELTA** — legacy's big preview card missing |
| 4 | 2-col grid: entry form \| **Recent Activity feed (15)** | entry form + "Recent log" (per-op) | ⚠️ POLISH — legacy feed is global last-15; React is per-op |
| 5 | **"Ready to Process" table** at bottom (click row → quickFill): JC·Op·Operation·Machine·Done·Available·Status | replaced by the per-JC ops table | **DELTA** — global ready-to-process list missing |

### 3. Build plan
- **Slice A (chrome):** refactor `index.tsx` + the 3 components to legacy chrome (`.panel`, `.section-hdr`, `.btn`, `.innovic-input/select`, `.innovic-table`). No backend change.
- **Slice B (structure):** add the op **preview card** (Order/Done/Available/Running) and a global **"Ready to Process"** panel (enriched ops where `available>0 || in_progress`, click→select). Backend already exposes enriched ops.

### Remaining
- Start/Complete top-level mode toggle (cosmetic; current Start/Stop works).
- Global last-15 activity feed (vs current per-op log).
