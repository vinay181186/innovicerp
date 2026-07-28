# PENDING TASKS — Master Change-Request Tracker

> Single source of truth for user-reported change requests. New requests (in the
> "Sr No / Page / Change Request / Status / Open / Closing" format) get **appended**
> here and status-updated as work progresses.
>
> **Status legend:** 🔴 To-do · ✅ Fixed (branch `fix/pending-tasks-batch-1`, undeployed) · 🟢 Already-working · 🟡 Data/config (no code) · 🔵 Needs decision · 🚀 Deployed
> Last updated: 2026-07-28 · **11 of 19 fixed on branch; not yet deployed.**

## Progress log (branch `fix/pending-tasks-batch-1`)
- `f3d1602` — T20, T22, T30a, T31
- `124ccbb` — T25/26, T29(placeholder), T15, T32b
- `c9aa59f` — T13
- `883ddf0` — T32a
- `5dcbea1` — T33 (JC table + Job Queue)

| # | Page | Change Request | Status | Root cause + fix (file:line / commit) |
|---|------|----------------|--------|------------------------------|
| 10 | Create PO | Vendor name not visible | 🟢 Already-working | Both surfaces render "code · name" (`from-pr.tsx:180`, `purchase-order-form.tsx:252`). Dashes only when a free-text vendor has no master name. |
| 12 | Create OSP DC | DC number auto-generate | 🟢 Already-working | `create.tsx:232` `DocNumberInput type="delivery_challan"` + server `nextDcCode`. If blank, verify `/doc-numbers/check` at runtime. |
| 13 | Create OSP DC | "Request validation failed" saving DC | ✅ Fixed `c9aa59f` | Blank DC date sent `''` → server regex reject. Now required + guarded; item code falls back to item name. |
| 15 | SO/JWSO Planning | Show item on right side | ✅ Fixed `124ccbb` | Item code/name added to the right-pane header (`workflow.tsx:304`). |
| 19 | Purchase Request detail | Source SO line / Linked PO / Source JC op missing | 🟢 Already-working | API returns + UI renders (`service.ts:338`, `detail.tsx:210`). Dashes = null source on that PR. |
| 20 | Create PO from PR | "Request validation failed" | ✅ Fixed `f3d1602` | Blank code sent `''`; now `\|\| undefined` → server auto-generates (`from-pr.tsx:64`). |
| 21 | Purchase Request detail | PO-created → view; disable Create-PO | 🟢 Already-working | `detail.tsx:62,94-115` "View linked PO" + hides create/edit; server `ConflictError`. |
| 22 | Create PO | Number must auto-generate | ✅ Fixed `f3d1602` | Prefills `IN-PO-#####`; fixed the blank→`''` gap in `onValid` (`purchase-order-form.tsx:145`). |
| 23 | Doc numbers (global) | Except SO, all auto-generate | 🔵 Needs decision | Only **PR** is manual (no generator). Fix = `nextSeriesCode('pr')` + `/purchase-requests/next-code` + `DocNumberInput`. **Decide:** PR prefix (`IN-PR-` vs `IN-JWPR-`) + strict read-only vs prefilled-editable. |
| 25/26 | OSP Outward DC (list) | Drop Lines col; add Action col +Receive | ✅ Fixed `124ccbb` | `list.tsx` — removed Lines, added Action column with "+ Receive" (enabled while `issued`). |
| 27 | Multiple pages | SO No. everywhere | 🔵 Needs decision (partial) | Already shown on JC/PR/DC/Dispatch/Invoice/QC. Gaps: Op Entry, PO detail, PO list, GRN. **Decide:** order + how to show a multi-SO GRN. |
| 28 | Planning Dashboard | Sorting doesn't work | 🔴 To-do | Plain `<table>`, no sort wired (`dashboard.tsx:387,192`). Fix = convert to `useReactTable` + `SortableHead` (pattern in `job-cards/routes/list.tsx`). |
| 29 | Planning Dashboard | See SO + search by SO | ✅ Partial `124ccbb` | SO column + SO search already existed; relabelled placeholder. **Residual:** full server-side SO search across all plans (client search covers only latest 50) — bundle with T23/decision. |
| 30a | JC Status | SO/WO due date not visible | ✅ Fixed `f3d1602` | Falls back to source line: `COALESCE(jc.due_date, sol.due_date, jwl.due_date)`. |
| 30b | JC Status | Route Card: None | 🟡 Data | Route card resolved by item match; that item has no `route_cards` master row. Remedy = create a route card for the item. |
| 31 | QC Call Register | Default sort by timestamp | ✅ Fixed `f3d1602` | Pending list now `ORDER BY qc_call_date DESC`. |
| 32a | Edit Job Card | Machine dropdown doesn't work | ✅ Fixed `883ddf0` | Datalist collapsed on pre-filled value → swapped to shared `SearchableSelect` (matches create/plan). |
| 32b | Edit Job Card | OSP op machine field → inactive | ✅ Fixed `124ccbb` | OSP op now shows an inactive "🏭 OSP" badge (like QC). |
| 33 | JC / Job Queue / all | Log only after Start | ✅ Fixed `5dcbea1` (2 of 3 surfaces) | JC table + Job Queue now show Start for not-started ops, Log only once started. **Follow-up:** central gate in `op-entry-form.tsx` mode toggle. |

---

## Remaining work
- **🔴 T28** — Planning Dashboard sortable tables (clean but non-trivial refactor).
- **🔵 T23** — PR auto-number: needs a **prefix decision** + read-only-strictness decision.
- **🔵 T27** — SO No. on Op Entry / PO detail / PO list / GRN: needs **priority + multi-SO-GRN display decision**.
- **Follow-up** — T33 central enforcement in `op-entry-form.tsx`; T29 full server-side SO search.
- **🟢 Already-working (verify against live build):** T10, T19, T21, T12 — if still seen, it's a deploy lag or data condition, not a code defect.

## Deploy note
Branch `fix/pending-tasks-batch-1` is **not deployed**. API-side fixes (T13-frontend, T30a, T31, PO code) go live once `main` deploys to Railway; frontend fixes via `main` → Cloudflare Pages.
</content>
