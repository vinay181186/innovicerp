# PARITY — Job Cards (`renderJobCards`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L5739–5791 (list).
> Modal helpers: `jcModalBody` L5943, `addJC` L6020, `editJC`, `nextJCNo` L5793, `jcModalOpsHtml` L5868, `jcModalDocsHtml` L5809.
> **React target:** `apps/web/src/modules/job-cards/routes/list.tsx` (route `/job-cards`). Backend: `apps/api/src/modules/job-cards/{service,routes}.ts` (read-only).

---

## 0. Route + entry points

- ✅ Route `/job-cards` exists (list only — no detail/new/edit route).
- Legacy nav: dept `production`, page `jobcards`, label "Job Cards", icon 📝.
- Legacy create entry = header button **"+ Plan & Create Job Card"** → `nav('planning')` (gated `canEntry()`). React has no create button. **BLOCKER** (entry point).

---

## 1. Toolbar (L5777–5783)

| # | Element | Legacy | React (before) | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Title | "Job Cards" | "Job Cards" + subtitle | ✅ (subtitle is extra) | — |
| 2 | Search | `searchBox` "Search JC No., Item, SO…" | input "Search code, item, customer, SO/JW…" | ✅ structure | POLISH placeholder |
| 3 | + Plan & Create Job Card | `nav('planning')`, gated canEntry | (missing) | ❌ | **BLOCKER** |
| 4 | status/machine/operator/date filters | (none in legacy) | present in React | ⚠️ EXTRA | DELTA-extra — kept (useful, non-conflicting) |

---

## 2. List table columns (L5747–5773, headers L5786)

Legacy: **14 columns**. React (before): 10 columns.

| # | Legacy header | Legacy data / style | React (before) | Match? | Tag |
|---|---|---|---|---|---|
| 1 | JC No. | cyan, dotted underline, → `viewJCStatus(id)` | "Code" → /op-entry?jc | ✅ col / ⚠️ link target | DELTA (link) |
| 2 | Date | text2 11px, `fmt` | ✅ Date | ✅ | — |
| 3 | SO/WO | mono, `soNo` + `/soLineNo` if ≠1 | merged into "Source" | ⚠️ | DELTA |
| 4 | CPO Ln | mono purple, `clientPoLineNo` | (missing) | ❌ | **BLOCKER** (data: `sol.client_po_line_no`) |
| 5 | Item Code | td-code purple | merged "Item" | ⚠️ | POLISH |
| 6 | Item Name | plain | merged "Item" | ⚠️ | POLISH |
| 7 | Order Qty | ctr mono bold | ✅ Qty | ✅ | — |
| 8 | **Completed** | green bold `qtyDone` + 52px progress bar + `qtyPct%` | (missing) | ❌ | **BLOCKER** (data: last-op `completed_qty`) |
| 9 | **Pending** | ctr mono bold, red if >0 else green | (missing) | ❌ | **BLOCKER** (`orderQty − qtyDone`) |
| 10 | Priority | `badge(priority)` (Normal/High) | lowercase text | ⚠️ | POLISH (badge) |
| 11 | Due Date | text2 `fmt` | ✅ Due | ✅ | — |
| 12 | Ops Done | ctr text2 `doneOps/totalOps` | ✅ "Ops" | ✅ | — |
| 13 | Status | `badge(status)` + `▶N` amber when running | badge only | ⚠️ | DELTA (running badge; data: `runningCount`) |
| 14 | Actions | View 👁 / Print 🖨 / Edit ✎(canEdit) / Assign 👤(admin·mgr) / Delete 🗑(admin) | (missing) | ❌ | **BLOCKER** (View) + remaining (Print/Edit/Delete) |
| — | Customer | (none in legacy) | present in React | ⚠️ EXTRA | DELTA-extra — kept |

Empty state: legacy `colspan=14` "No job cards".

---

## 3. Create / Edit modal (`jcModalBody` L5943 / `addJC` L6020) — large, deferred

Legacy modal sections: ▸ JC DETAILS (JC No auto `nextJCNo`, Date, SO/WO search w/ balance banner, Priority, Item w/ route-card auto-load + stock hint, Order Qty, Due) · ▸ DRAWING ATTACHMENT (image upload) · ▸ OPERATION ROUTING (per-op machine/operation/cycle/program/tool, QC-op rows, outsource toggle+vendor+cost, reorder, add/remove) · ▸ QC DOCUMENTS (MIR/MCR/etc. file attach).

- ❌ Not in React. **Backend JC writes do not exist** ("JC writes still go through op-entry per Phase 3" — service.ts header). This is a full feature build (writes + ops-routing builder + file upload), not a UI refactor.
- **Remaining / documented in LEGACY_AUDIT.md.** List-page "+ Plan & Create" routes to `/planning` (legacy parity for the create entry point); the standalone JC modal is the secondary path.

---

## 4. Build plan (this slice — list parity, full-stack)

1. **Backend** (`job-cards/service.ts` + `schema.ts`): add `clientPoLineNo` (SO line; null for JW), `lastOpCompletedQty` (max op_seq `completed_qty` from `v_jc_op_status`), `runningCount` (`running_ops` joined via `jc_ops`, status='running').
2. **Frontend**: rebuild columns to legacy's 14 (SO/WO split, CPO Ln, Item Code+Name split, Completed w/ bar, Pending, Ops Done, running badge), add "+ Plan & Create Job Card" → `/planning`, add Actions col (View → `/so-status`; Print/Edit/Delete deferred w/ disabled-or-omitted per role). Keep React filter bar + Customer as non-conflicting extras.

### Remaining after this slice (LEGACY_AUDIT)
- JC create/edit modal (ops routing builder, drawing + QC doc upload) + backend JC writes.
- Print job card template.
- Delete (admin) + Assign-to-user (Tasks module).
