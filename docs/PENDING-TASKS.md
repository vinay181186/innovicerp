# PENDING TASKS — Master Change-Request Tracker

> Single source of truth for user-reported change requests. New requests (in the
> "Sr No / Page / Change Request / Status / Open / Closing" format) get **appended**
> here and status-updated as work progresses.
>
> **Status legend:** ✅ Fixed (branch) · 🟢 Already-working · 🟡 Data/config (no code) · 🚀 Deployed · 🔴 Open
> Last updated: 2026-07-28 · **All 19 addressed** (14 code-fixed on branch `fix/pending-tasks-batch-1`, 4 already-working, 1 data). **Not yet deployed.**

## Commits (branch `fix/pending-tasks-batch-1`)
`f3d1602` T20/T22/T30a/T31 · `124ccbb` T25/26/T29/T15/T32b · `c9aa59f` T13 · `883ddf0` T32a · `5dcbea1` T33 · `5743fb9` T28 · `3e5fe94` T23 · `142563e` T27

| # | Page | Change Request | Status | Resolution | Closed |
|---|------|----------------|--------|------------|--------|
| 10 | Create PO | Vendor name not visible | 🟢 Already-working | Both PO surfaces render "code · name"; dashes only if free-text vendor lacks a master name. | 28-Jul |
| 12 | Create OSP DC | DC number auto-generate | 🟢 Already-working | `DocNumberInput type="delivery_challan"` prefills `IN-DC-#####` + server backstop. | 28-Jul |
| 13 | Create OSP DC | Validation failed saving DC | ✅ Fixed `c9aa59f` | DC date required + guarded (blank date was the cause); item code falls back to item name. | 28-Jul |
| 15 | SO/JWSO Planning | Show item on right side | ✅ Fixed `124ccbb` | Item code/name added to the right-pane header. | 28-Jul |
| 19 | Purchase Request detail | Source SO line / PO / JC op missing | 🟢 Already-working | API returns + UI renders; dashes = null source on that PR. | 28-Jul |
| 20 | Create PO from PR | Validation failed | ✅ Fixed `f3d1602` | Blank code → `undefined` → server auto-generates. | 28-Jul |
| 21 | Purchase Request detail | PO-created → view; disable Create-PO | 🟢 Already-working | "View linked PO" shown; create/edit hidden; server blocks re-create. | 28-Jul |
| 22 | Create PO | Number must auto-generate | ✅ Fixed `f3d1602` | Prefills `IN-PO-#####`; fixed blank→`''` gap. | 28-Jul |
| 23 | Doc numbers (global) | Except SO, all auto-generate | ✅ Fixed `3e5fe94` | PR (the only manual one) now auto-generates `IN-PR-#####` on blank; others already prefill. | 28-Jul |
| 25/26 | OSP Outward DC list | Drop Lines col; add Action +Receive | ✅ Fixed `124ccbb` | Removed Lines; added Action column with "+ Receive" (enabled while `issued`). | 28-Jul |
| 27 | Multiple pages | SO No. everywhere | ✅ Fixed `142563e` | Added SO to Op Entry (biggest gap); already shown on JC/PR/DC/Dispatch/Invoice/QC. *Follow-up: PO detail/list, and GRN (needs a multi-SO display decision).* | 28-Jul |
| 28 | Planning Dashboard | Sorting doesn't work | ✅ Fixed `5743fb9` | Recent Plans table columns now sortable (click headers). | 28-Jul |
| 29 | Planning Dashboard | See SO + search by SO | ✅ Fixed `124ccbb` | SO column + SO search already existed; placeholder relabelled. *Follow-up: server-side SO search beyond latest 50.* | 28-Jul |
| 30 | JC Status | Due date not visible / Route Card None | ✅ Fixed `f3d1602` (due date) · 🟡 (route card) | Due date now falls back to source line. Route Card None = that item has no route-card master row (data). | 28-Jul |
| 31 | QC Call Register | Default sort by timestamp | ✅ Fixed `f3d1602` | Pending list sorts by `qc_call_date DESC`. | 28-Jul |
| 32a | Edit Job Card | Machine dropdown doesn't work | ✅ Fixed `883ddf0` | Swapped the collapsing datalist for the shared SearchableSelect. | 28-Jul |
| 32b | Edit Job Card | OSP machine field → inactive | ✅ Fixed `124ccbb` | OSP op shows an inactive "🏭 OSP" badge (like QC). | 28-Jul |
| 33 | JC / Job Queue / all | Log only after Start | ✅ Fixed `5dcbea1` | JC table + Job Queue show Start for not-started ops, Log once started. *Follow-up: central gate in op-entry-form.* | 28-Jul |

---

## Documented follow-ups (minor / decision-gated — not blocking)
- **T27** PO detail/list SO column; **GRN** SO display needs a decision (a GRN can trace to *multiple* SOs).
- **T33** central enforcement in `op-entry-form.tsx` mode toggle (surfaces already gated).
- **T29** full server-side SO search across all plans (client search covers latest 50).
- **T30b** route card is a data task (create a route card for the item).

## Deploy
Branch `fix/pending-tasks-batch-1` — **not deployed.** Merge to `main` → Railway (API) + Cloudflare Pages (web) auto-deploy.
</content>
