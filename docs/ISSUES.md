# ISSUES.md — Audit Backlog

> Append-only log of issues surfaced during build that we've explicitly chosen to **defer** rather than fix inline.
> Per user direction 2026-05-15: build database + UI fully across all modules first, then do a single focused logic-correction pass working straight from this file.
>
> **Severity legend:** P1 = data corruption / blocks cutover · P2 = wrong logic but workaround exists · P3 = UX / polish
>
> **Status legend:** [ ] open · [~] partial fix in flight · [x] fixed · [-] won't-fix / wontfix-with-reason

---

## ISSUE-001 — op-entry submit form has no QC guard

- **Surfaced:** 2026-05-15 (browser smoke for Resume Checklist #1)
- **Closed:** 2026-05-15 (T-040d per ADR-025)
- **Severity:** P1 (creates phantom complete-logs on QC ops; corrupts `v_jc_op_status`)
- **Status:** [x] Fixed — defensive `op.opType === 'qc'` throw added to `submitOpLog` (`apps/api/src/modules/op-entry/service.ts`); `op-entry-form.tsx` now renders the QC inspection sub-form on qc-bearing ops (production form hidden entirely). Phantom row `LOG-20260515092904` left in DB per "leave all 3 in place" direction (kept as before/after evidence; cleaned during the eventual audit pass).

**Repro:** Pick a JC with QC-typed ops (e.g., IN-JC-00002 Op 6 DIR). In `/op-entry`, click the QC op row, enter any qty, click "Submit completion". The submit succeeds even though the op is `op_type='qc'`.

**Effect:** A row lands in `op_log` with `log_type='complete'` against a QC op. `v_jc_op_status` rolls this into `completed_qty`, flipping the op from `waiting`/`available` to `in_progress` (or even `complete` if qty meets target). The "real" QC log path uses `log_type='qc'` with separate accept/reject columns and is the correct shape.

**Root cause:** `apps/api/src/modules/op-entry/service.ts:258-262` blocks `op.opType === 'outsource'` but not `'qc'`. `apps/web/src/modules/op-entry/components/op-entry-form.tsx:54-63` `blockedReason` checks only `outsource`, `qc_pending`, `noAvailable`.

**Fix sketch:** Add a `op.opType === 'qc'` block in both layers, mirroring the outsource guard. Message: "This is a QC operation; use the QC inspection flow." The actual QC inspection flow is the larger Phase 6 work — the guard alone is ~5 lines.

**Phantom rows created so far:** 1 (`LOG-20260515092904` on IN-JC-00002 op 6, qty=55, log_date=2026-05-15).

---

## ISSUE-002 — legacy data has 2 stray complete-logs on QC ops

- **Surfaced:** 2026-05-15 (during ISSUE-001 investigation)
- **Severity:** P2 (legacy data oddity; not a code bug; affects 2 rows on 1 JC)
- **Status:** [ ] open

**Repro:** In dev DB, query `SELECT * FROM op_log WHERE log_no IN ('LOG-034','LOG-036')`. Both have `log_type='complete'`, qty=20, against IN-JC-00003 op 1 (MIR QC) and op 2 (MCR QC) respectively.

**Effect:** IN-JC-00003 ops 1 and 2 (both QC) show `computed_status='qc_pending'` because the view sees `completed_qty=20` (from the stray rows) yet `qc_accepted+qc_rejected` doesn't cover that 20. Confusing UX.

**Root cause:** Legacy export has both rows with the `type` field **entirely absent** (legacy app's UX let an operator enter qty against a QC op without selecting a type marker). The migration's `normaliseLogType(undefined)` defaults to `'complete'` (`migration/transforms/op-log.ts:70-75`). Operator-name on both is "Vinay", date 2026-03-18.

**Likely operator intent:** "20 inspected/accepted" — i.e., what would be `log_type='qc'` with `qty=20` and `rejectQty=0`.

**Fix options:**

1. Re-run migration with a transform patch: when `r.type` is undefined AND the target op is `op_type='qc'`, default to `log_type='qc'` instead of `'complete'`. Reload affected rows.
2. One-off SQL `UPDATE op_log SET log_type='qc' WHERE log_no IN ('LOG-034','LOG-036')` as a data fix.
3. Leave as-is and document.

Per user direction 2026-05-15, **leave in place** until the audit pass.

---

## ISSUE-003 — T-033 cascade browser e2e gated on QC + outsource flows

- **Surfaced:** 2026-05-15 (Resume Checklist #1 step 7a)
- **Severity:** P2 (cascade code is unit-tested via `sales-cascade.test.ts`; browser-level e2e against migrated data is blocked)
- **Status:** [x] Resolved 2026-05-19 — all three flows now ship. QC submit (T-040d per ADR-025) writes `log_type='qc'`; outsource outward (T-059a per ADR-026) flips `po_created → sent` via `POST /delivery-challans` + the new `/delivery-challans/new?poId=<jw-po-id>` web flow; outsource receive-back (T-059b per ADR-026) flips `sent → received` via `POST /delivery-challans/:id/receive` + the new `/delivery-challans/$id/receive` web flow. The patched `v_jc_op_status` view (also from T-059b) projects `'complete'` for outsource ops at `outsource_status='received'` so the JC→SO cascade fires when outsource is the last/only step. End-to-end smoke against migrated data — `IN-JC-00002` ops 1–6 production → ops 7 outsource issue+receive → ops 8/9 QC → SO-436 line 6 close — is now drivable through real UI. Browser smoke remains gated on user driving the click-through; code coverage is via the 39/39 DC suite + 12/12 cascade suite.

**Repro:** The only migrated JCs linked to SO lines are IN-JC-00002 (→ SO-436 line 6) and IN-JC-00003 (→ SO-436 line 4). Neither can be driven to `v_jc_status.computed_status='complete'` via current UI flows:

- IN-JC-00002 op 7 COATING is outsource → needs the procurement receive-from-vendor flow (not built).
- IN-JC-00002 ops 8/9 are QC → need QC inspection submit flow that writes `log_type='qc'` (not built; only `log_type='complete'` is writable from any current API path).
- IN-JC-00003 ops 1/2 are stuck `qc_pending` for the same reason.

**Workaround taken today:** seeded `SO-TEST-CASCADE` + `TEST-CASCADE-001` (a synthetic JC with 2 process ops, no QC, no outsource), then drove the cascade end-to-end via op-entry. Real cascade verification against migrated data deferred until QC inspection + outsource receive flows ship (Phase 6).

---

## ISSUE-004 — migration `normaliseLogType` defaults are context-blind

- **Surfaced:** 2026-05-15 (ISSUE-002 investigation)
- **Severity:** P2 (only affects 2 legacy rows currently; future re-imports could re-create)
- **Status:** [ ] open

**Repro:** `migration/transforms/op-log.ts:70-75` — `if (raw is not 'start' and not 'qc') return 'complete'`. The transform does not look at the target `jc_op.op_type`. A legacy row with type=undefined against a QC op gets `log_type='complete'`; the legacy operator's intent was almost certainly a QC inspection log.

**Fix sketch:** Pass `jc_ops` opType into transform context, key on it when raw is undefined. Add anomaly when defaulting so the migration log records the override. Per ADR-011 #11 the transform context already has lookups; a `jcOpsById[jcOpId].opType` lookup is cheap.

---

## ISSUE-005 — SO detail "ITEM" column shows `— linked —` for every row

- **Surfaced:** 2026-05-15 (browser smoke T-030 SO detail view)
- **Severity:** P3 (UX clutter; data is correct, display is opaque)
- **Status:** [x] Fixed 2026-05-19 — path (a) from the fix sketch. New `itemCode: string | null` field added to `salesOrderLineSchema` in shared (defaults to null on create/update returns). `getSalesOrder` LEFT JOINs items on the line's itemId and surfaces the live `items.code`. SO detail UI changed from `l.itemCodeText ?? (l.itemId ? '— linked —' : '—')` to `l.itemCode ?? l.itemCodeText ?? '—'` — live code wins when itemId is set, snapshot text falls back for unresolved-at-create cases, em-dash for genuinely-empty. 16/16 sales-orders tests green; web build clean (index 999.79 KB / 132.20 KB gzip, unchanged ceiling). Other "— linked —" placeholders in PO / PR / NC / JW / GRN detail pages NOT touched — they have the same root cause but no user-reported pain.

---

## ISSUE-007 — `job_cards.closed_at` not set when cascade fires

- **Surfaced:** 2026-05-15 (cascade smoke verification on TEST-CASCADE-001)
- **Severity:** P2 (cascade still fires correctly; downstream consumers reading `closed_at` will miss the event)
- **Status:** [x] Fixed 2026-05-19 — `sales-cascade.ts` now sets `closed_at = now()` in the same tx as the JC_COMPLETE audit emit (path (a) from the fix sketch). Idempotent via `WHERE closedAt IS NULL`. Early-return check relaxed to accept both `'complete'` and `'closed'` so re-runs still flow through to the inner cascade (preserves the existing `so_line_already_terminal` skipped contract). 2 new tests in `sales-cascade.test.ts` verify closed_at gets set + stays stable on re-run; full cascade suite 12/12 green.

**Repro:** Run a full op-entry cascade through TEST-CASCADE-001. After Op 2 submit, query `SELECT closed_at FROM job_cards WHERE code='TEST-CASCADE-001'` — value is `NULL` even though `v_jc_status.computed_status='complete'` and the SO/SO-line are both `closed`.

**Effect:** `v_jc_status` derives `'closed'` from `jc.closed_at IS NOT NULL` first, then `'complete'` from op completeness. So a cascade-completed JC sits in derived state `'complete'` forever, never `'closed'`. Reports / alerts / dashboards keying off `closed_at` (`apps/api/src/modules/reports/definitions/jc-ageing.ts`, `al-012-jc-overdue.ts`, etc.) won't see the JC as closed.

**Root cause hypothesis:** `sales-cascade.ts` closes SO/JW lines + headers but doesn't touch `job_cards.closed_at`. There may not be any code path that sets `closed_at` automatically — possibly intended as a manager-explicit-signoff field, but if so the v_jc_status `'complete'` vs `'closed'` distinction needs documentation.

**Fix sketch:** Either (a) extend `tryCascadeJcComplete` to set `jobCards.closed_at = now()` in the same tx when computed_status flips to complete, or (b) document that `closed` and `complete` are distinct states with `closed` reserved for manager signoff and audit alignment of all JC consumers.

---

## ISSUE-006 — no global nav / Home button in /apps/web

- **Surfaced:** 2026-05-15 (browser smoke T-030 / T-031 / T-032)
- **Severity:** P3 (navigation UX; everything still reachable via URL bar / back)
- **Status:** [x] Fixed 2026-05-19 — new `components/shared/nav-bar.tsx` (sticky top bar with Home link → /, user email + role chip, sign-out button). Wired into `routes/_authenticated.tsx` so every authenticated screen inherits it. Per-route breadcrumb deferred — the Home link covers the primary nav need; breadcrumbs can ship as a follow-on once user UX feedback demands it. Index page's duplicate sign-out + role indicator removed since the nav bar covers them. Web bundle: index chunk grew 999.79 KB → 1002.05 KB raw / 132.20 KB → 132.53 KB gzip (just barely tipped past Vite's default 1000 KB warning ceiling; gzip delivery size is what matters and that's fine). Typecheck + lint + prettier + build clean.

---

## ISSUE-008 — `/op-entry` ops table DONE column misleading on QC ops

- **Surfaced:** 2026-05-16 (browser smoke T-040d Test 1, IN-JC-00003 Op 1)
- **Severity:** P2 (numbers visibly disagree with status badge; will confuse operators)
- **Status:** [ ] open

**Repro:** Open `/op-entry?jc=IN-JC-00003`. Op 1 MIR badge reads **Complete** but the DONE column reads **20** (of 60 order qty). The real "inspected" count is `qc_accepted_qty + qc_rejected_qty = 60 + 0`.

**Effect:** Three numbers on the same row contradict each other — DONE=20, AVAILABLE=40, status=Complete. Operator cannot tell at a glance what the op actually did.

**Root cause:** The web table maps DONE to `completed_qty` from `v_jc_op_status`. The view defines `completed_qty = SUM(qty WHERE log_type='complete')` — that field is only meaningful for process ops. On a QC op, `completed_qty` reflects only stray legacy `log_type='complete'` rows (per ISSUE-002), never the qc submits. The QC writes go into `qc_accepted_qty` + `qc_rejected_qty` and never into `completed_qty`.

**Fix sketch:** In the ops-table renderer (`apps/web/src/modules/op-entry/components/ops-table.tsx` — check actual path), branch the DONE cell on `op.opType`:

- `process` / `outsource` → render `completed_qty` (current behaviour)
- `qc` → render `qc_accepted_qty + qc_rejected_qty` with `qc_rejected_qty` annotated in red, e.g. `60 (incl. 5 rej)`

Pure presentation change; no view/service edits needed.

**Related:** ISSUE-009 (AVAILABLE column same root cause); ISSUE-002 (the stray legacy COMPLETE rows that show up in DONE on QC ops).

---

## ISSUE-009 — `/op-entry` ops table AVAILABLE column non-zero on Complete QC ops

- **Surfaced:** 2026-05-16 (browser smoke T-040d Test 1, IN-JC-00003 Op 1)
- **Severity:** P2 (same row-level contradiction as ISSUE-008)
- **Status:** [ ] open

**Repro:** On `/op-entry?jc=IN-JC-00003` Op 1 MIR (status=Complete), AVAILABLE reads **40**. On Op 2 MCR (status=QC Pending), AVAILABLE also reads **40** while QC pending is 30.

**Effect:** A Complete op shows 40 "available" work. For QC ops, AVAILABLE means nothing useful — `qc_pending` is the actionable count.

**Root cause:** Web table maps AVAILABLE to `v_jc_op_status.available`. The view computes `available = input - completed_qty` for all op types. For a QC op, `completed_qty` is the stray-legacy count (per ISSUE-002 / ISSUE-008), so `available` ≈ `input`, regardless of inspection progress.

**Fix sketch:** Same branch as ISSUE-008. In the table renderer, swap AVAILABLE → `qc_pending` for `op_type='qc'` rows, and label the column header accordingly (or replace the cell with a "Pending QC: X" pill). Pure presentation change.

**Related:** ISSUE-008.

---

## ISSUE-010 — `/op-entry` ops table MACHINE column shows literal "QC" on QC ops

- **Surfaced:** 2026-05-16 (browser smoke T-040d, IN-JC-00003 + IN-JC-00002)
- **Severity:** P3 (duplicates the TYPE column; cosmetic but every QC op row reads "QC QC")
- **Status:** [ ] open

**Repro:** Every QC op row on `/op-entry` shows MACHINE="QC" and TYPE="QC". Process ops correctly show MACHINE="CNC-01" / "CNC-02" / TYPE="PROCESS".

**Root cause confirmed:** Legacy export has `machine_code_text='QC'` literal on every QC op (`jc_ops.machine_id` is null on all of them — verified 2026-05-16 via direct DB query against IN-JC-00002 + IN-JC-00003: 9/9 QC ops have `machine_code_text="QC"`, `machine_id=null`). Not a renderer fallback bug; data is what it is.

**Fix sketch:** Two options:

1. **Renderer fix (recommended):** For `op_type='qc'` rows, render MACHINE cell as `—` (or hide entirely) — TYPE already conveys "QC", machine is not a meaningful field for inspection. Pure web change; legacy data left intact.
2. **Data fix:** One-off SQL `UPDATE jc_ops SET machine_code_text = NULL WHERE op_type = 'qc' AND machine_code_text = 'QC'`. Cleaner but touches legacy data; bundle with the audit-pass cleanup.

## ISSUE-011 — `cycle_time_min` column name vs stored hours semantics across `route_card_ops` + `jc_ops`

- **Surfaced:** 2026-05-20 (RC-1 schema review per ADR-029)
- **Severity:** P3 (no current bug — every reader treats the stored value as opaque numeric; risk is future regressions or report miscalculations)
- **Status:** [ ] open

**Repro:** Column is named `cycle_time_min` but stores HOURS (matches legacy `cycleTime` field — form L10240 placeholder reads `"hrs"`, view modal L10163 header reads `Cycle(h)`). UI labels read "Cycle (hrs)" so user-facing semantics are correct, but any code reading `cycle_time_min` and treating the value as minutes would compute a 60× error.

**Affected tables:** `route_card_ops.cycle_time_min`, `jc_ops.cycle_time_min` (Phase 3 already inherits the same mismatch via the route-card-to-JC snapshot).

**Fix sketch:** Single migration during the audit-phase cleanup pass:

1. ALTER both tables: `RENAME COLUMN cycle_time_min TO cycle_time_hours`.
2. Update Drizzle schema entries.
3. Update shared zod schemas (`route-card.ts`, `op-entry.ts`, `job-card.ts`).
4. Update all readers (op-entry service, JC display, reports definitions, store-tx cascades — none of which currently arithmetic on the value).

Pure rename — no data conversion needed since the stored unit was always hours. ~60-80 LOC across schema + 5-6 reader sites. Defer until the audit pass per "build first, audit later" mode.

## ISSUE-012 — `items-on-hand` report has a -3 row from pre-existing dev DB state

- **Surfaced:** 2026-05-20 (RC-6 quality gates)
- **Severity:** P3 (single item; doesn't affect production data, only test flakiness)
- **Status:** [ ] open

**Repro:** Running `pnpm test` against dev Supabase, the test `reports service > runReport "items-on-hand" returns one row per item incl. zero-stock items` fails on the assertion `expect(Number(row['on_hand_qty'])).toBeGreaterThanOrEqual(0)` — at least one item has `on_hand_qty = -3` in `item_stock_balances`. Reproduces in isolation, so it's not a parallel-test race.

**Root cause hypothesis:** Some prior test run (likely GRN or store-tx) left a soft-deleted item whose store_transactions rows weren't fully reversed, leaving a negative balance. The `item_stock_balances` table is trigger-maintained per T-042, so once a negative lands it stays until either (a) the test that owns the item cleans up its txns, or (b) a reconcile run hits the row.

**Fix sketch:**

1. Identify the offending item id via direct SQL: `SELECT item_id, on_hand_qty FROM item_stock_balances WHERE on_hand_qty < 0`.
2. Trace its store_transactions rows; identify the test prefix.
3. Patch that test's afterAll to reverse its txns OR add a reconcile script invocation to `package.json`'s `test:reset`.
4. As a one-off fix, manually `DELETE` the orphan ledger row (admin SQL via Supabase studio, NOT app code).

Defer to audit phase OR when this flake blocks a release. Not caused by route-cards (route-cards module doesn't touch `store_transactions`).

## ISSUE-013 — SO Master: Client-PO file link (📎) on rows

- **Surfaced:** 2026-06-03 (screen-by-screen parity review, SO Master)
- **Severity:** P3 (convenience; the client-PO *number* already shows)
- **Status:** [x] RESOLVED 2026-06-13 — client-PO file stored in `file_registry` (category `client_po`, no new SO column); upload + ⬇View on the SO detail (`ClientPoFileBar`), 📎 link in SO Master (list service LATERAL-joins the latest active client_po file → `clientPoFilePath`). Create-form-time upload deferred (SO id only exists post-create) — upload from detail covers it.

**Gap:** Legacy `renderSOmaster` (L11866) renders a 📎 link next to the Client-PO number when `clientPoFileUrl` is set, opening the uploaded client-PO document. Our SO Master shows the PO number but has no file link.

**Why deferred:** We don't store a client-PO file anywhere — there's no `client_po_file_url` column on `sales_orders`, no upload UI in the SO create/edit form, and no Supabase Storage wiring for it. This is a small feature, not a one-line fix.

**Fix sketch:**
1. Add `client_po_file_url text` (or a `client_po_file_path` + storage object) to `sales_orders` (migration).
2. Add a file upload to the SO create/edit form (reuse the QC-docs Supabase Storage pattern from `qc-documents`).
3. Render the 📎 link in the SO Master "Client PO" cell when set.

~80-120 LOC + a migration + storage bucket policy. Defer until file-attachment UX is prioritised.

## ISSUE-014 — Contextual "Assign to user" (👤+) across record screens

- **Surfaced:** 2026-06-03 (screen-by-screen parity review, SO Master) — but it spans many screens
- **Severity:** P3 (the Task Board already lets you assign tasks manually)
- **Status:** [x] RESOLVED 2026-06-13 — reusable `<AssignTaskButton linkedRef suggestedTitle />` (wraps `AssignTaskModal`, lazy user-options fetch, self-gates to admin/manager) wired into all 8 screens: SO/PR/PO/NC/GRN detail headers + CAPA/Job-Cards/Design-Issues list rows. Uses the existing Tasks `linkedRef` path (ADR-043).

**Gap:** Legacy `_assignTaskFromContext` (L14360) adds an "Assign to user 👤+" button on records across **SO Master, Purchase Requests, Purchase Orders, NC Register, CAPA, Job Cards, GRN/Incoming-QC, and Design Issues**. It opens the task modal pre-filled with a `linkedRef` {type,id,display,navPage} so the assignee sees a direct link in their My Work list. None of these buttons are wired in our build.

**Why deferred:** The data path already exists — the Tasks module's create endpoint accepts an optional `linkedRef` (built in TASK-1/ADR-043), and the My Work engine already renders linked tasks. What's missing is the per-screen UI button + a small "assign task from this record" modal, repeated across ~8 screens.

**Fix sketch:**
1. Build one reusable `<AssignTaskButton linkedRef={...} suggestedTitle=... />` component that opens a compact assign modal (reuse `AssignTaskModal` from the tasks module, pre-filling `linkedRef`).
2. Drop it into each record row/detail: SO Master, PR, PO, NC, CAPA, JC, GRN, Design Issues — mirroring the legacy `_assignTaskFromContext(...)` call sites.
3. Gate to admin/manager (legacy gate).

~40 LOC for the shared button + ~1-2 lines per screen. Do as a single cross-screen pass once the per-screen parity review is done.

## ISSUE-015 — SO form: Delivery Schedule / Milestones (lots)

- **Surfaced:** 2026-06-03 (screen-by-screen parity review, New Sales Order form)
- **Severity:** P3 (planning aid; not required to create/produce an SO)
- **Status:** [x] RESOLVED 2026-06-13 — new `so_milestones` table (migration 0056, applied to dev): SO-level lots {lotNo, qty, dueDate, remarks}, merged like lines (id→update / new→insert / absent→soft-delete). Repeatable "📅 Delivery Schedule / Milestones" section in the SO form (component SOs); read-only Delivery Schedule panel on the SO detail.

**Gap:** Legacy `soHeaderForm` (L12294-12300) has a "📅 Delivery Schedule / Milestones" section on component SOs — repeatable lots of `{lot#, qty, dueDate, remarks}` (`_soMilestones`). Stored on the SO and used as a delivery plan. Our SO form has no milestones section.

**Why deferred:** Needs a new data model — there's no `so_milestones` table or jsonb field on `sales_orders` (the shared schema even notes "milestones[] (#8, no current data)"). Per user direction 2026-06-03, items 1-9 of the SO-form parity were built; milestones (10) + client-PO upload (11, see ISSUE-013) were backlogged as they each need a migration.

**Fix sketch:**
1. Migration: `so_milestones` (id, company_id, sales_order_id FK cascade, lot_no int, qty int, due_date date, remarks text, + audit cols, RLS company_read + manager_write). One row per lot.
2. Shared schema + API: include milestones in the SO create/update input (merge by id like lines) and in the SO detail read.
3. Web: a "Delivery Schedule" repeatable section in `sales-order-form.tsx` (+ Add Lot / remove), shown for non-Equipment SOs.

~1 migration + ~120-160 LOC. Do alongside any other SO-form deepening.

## ISSUE-016 — Master lists: click-to-sort column headers (legacy sTh/sArr)

- **Surfaced:** 2026-06-06 (screen-by-screen parity review, Client Master)
- **Severity:** ~~P4~~ **P3** (the UI advertises sorting with clickable ▲/▼ arrows that do nothing — users can click forever and rows never reorder)
- **Status:** [!] **REOPENED 2026-07-15** — the 2026-06-13 fix below shipped every layer except one, so click-to-sort has **never worked** on any master list. See "Why it never worked" below. ~~[x] RESOLVED 2026-06-13~~
- ~~**Status:** [x] RESOLVED 2026-06-13 (master lists)~~ — server-side `ORDER BY` (lists are server-paginated, so client-side sort would only reorder the visible page). Added `sortBy`/`sortDir` to clients/items/vendors list query + service; reusable `<SortTh>` header (asc→desc→none, ▲/▼) drives URL search params. Other minor lists not swept (each is its own list; extend on demand using `SortTh`).

**Why it never worked (found 2026-07-15 by the REFACTOR-1 parity pass — independently by the Clients agent, the Vendors agent, and a manual trace):**

The chain is correct at every layer but one:

| Layer | State |
| --- | --- |
| `packages/shared/src/schemas/{client,item,vendor}.ts` (L58/L58/L62) | `sortBy` + `sortDir` defined ✅ |
| `apps/api/src/modules/{clients,items,vendors}/service.ts` (L46-48/L45/L51-53) | real `ORDER BY` implemented ✅ |
| `apps/api/src/modules/*/routes.ts` | parses the schema ✅ |
| `apps/web/src/modules/*/routes/list.tsx` | `SortTh` builds the query + drives URL params ✅ |
| **`apps/web/src/modules/{clients,items,vendors}/api.ts` → `toQueryString`** | **drops both params** ❌ |

All three `toQueryString` bodies serialize only `search`, a type/active filter, `limit`, `offset`. A grep for `sortBy|sortDir` across **every** `api.ts` in `apps/web/src/modules/` returns **zero matches** — the params are built into the query object, passed to `toQueryString`, and silently dropped on the floor.

**Effect:** clicking a sort header flips the arrow and rewrites the URL, then fires a network request with a **byte-identical** query string. TanStack Query sees a new key and refetches; the server always falls back to code/asc. Rows never move.

**Blast radius:** exactly the 3 files using `SortTh` — `clients`, `items`, `vendors` list pages (grep-confirmed). These are exactly the 3 named as fixed on 2026-06-13.

**Fix:** 2 lines per file, 6 total — in each `toQueryString`:
```ts
if (q.sortBy) params.set('sortBy', q.sortBy);
if (q.sortDir) params.set('sortDir', q.sortDir);
```
**Not applied** — `api.ts` is outside the REFACTOR-1 UI-only scope, and per the 2026-05-15 project mode logic fixes are deferred to the audit pass. Offered to the user 2026-07-15; do it here or in the audit pass.

**Lesson:** the backend half was tested and the UI half looked right in review; nothing checked the wire. Worth an integration test asserting the query string, not just the service.

**Gap:** Legacy master lists use `sTh(collection, field, label)` headers + `sArr()` to click-sort by column (e.g. Client Master sorts by Code / Client Name, L12991). None of our ported lists have click-sort — TanStack Table is wired with `getCoreRowModel` only.

**Why deferred:** POLISH across every list screen, not specific to one parity pass; no ported list has it, so doing it per-screen would be inconsistent.

**Fix sketch:** one shared pass — enable `getSortedRowModel` + a sortable-header cell (▲/▼ indicator) in the TanStack lists, or `ORDER BY` params on the server-paginated ones (clients, items, vendors). Do as a single cross-screen pass after the parity review.

## ISSUE-017 — Parity policy: don't copy legacy's dead attributes over working React behavior

- **Surfaced:** 2026-07-15 (legacy page-parity refactor track, REFACTOR-1)
- **Severity:** P4 (policy note + one logged delta; no user-visible defect outstanding)
- **Status:** [x] Policy set 2026-07-15 by user direction — recorded here so the remaining ~147 pages follow it.

**Policy:** When the legacy HTML contains an attribute or behavior that provably does nothing in a browser, and the React page has a working equivalent, the refactor keeps the working behavior and logs the delta here. Strict byte-for-byte parity is not worth a real regression when the rendered output is identical either way. Genuine legacy behavior — even surprising behavior — is still the spec and must be matched (see the `full_outsource → 🏭 Mfg` mapping in `plans/routes/dashboard.tsx`, which is deliberate).

**Logged delta — Daily Task Reports date filters (`daily-task-reports/routes/list.tsx`):**
Legacy L14179-14180 puts `placeholder="From"` / `placeholder="To"` on `<input type="date">`. Browsers ignore `placeholder` on date inputs — it renders nothing in legacy too. The refactor pass had swapped React's working `title` tooltip for legacy's dead `placeholder`, which removed the only From/To hint the user had for zero visual gain. Now carries **both**: `title` (works) + `placeholder` (legacy-faithful, inert). Rendered output matches legacy exactly; the tooltip survives.

**Related defect fixed in the same pass (not deferred):** the Daily Report tip text was brought to legacy wording — "Each machine panel has its own 🖨 print button" — but the per-machine buttons themselves were never ported, so the tip described a feature that didn't exist. Per-machine 🖨 built to match legacy L10882 (scoped summary per `printDailyReport(selDate, mId)` at L10918). **Watch for this class:** copying legacy *text* that refers to legacy *features* the React port is still missing.

**Logged deltas — Item Master list (`items/routes/list.tsx`, legacy `renderItems` L11481-11521):**

1. **Row click vs. link.** Legacy L11485 makes the whole `<tr style="cursor:pointer" onclick="viewItemDetail(id)">` clickable and renders the code cell as plain text (L11486). React keeps the Item Code cell as a `<Link>` to the same destination (`/items/$id`). Kept as-is: the link preserves middle-click / open-in-new-tab / status-bar preview that a row `onclick` cannot, and converting it would mean rewiring navigation (out of scope for a markup pass). Rendered position and purple `.td-code` styling are identical; only the click target is narrower.
2. **UOM tag class.** Legacy L11492 uses `<span class="tag" style="background:var(--bg4);color:var(--text2)">`. `.tag` has **no port** in `innovic-theme.css`, and inventing a class is not permitted. Kept `.badge.b-grey`, whose ported rule (`background:var(--bg4)` + muted text + border) is the closest existing equivalent. **If `.tag` is ever ported, revisit this cell.**
3. **React-only controls with no legacy counterpart** — item-type filter `<select>`, "Updating…" fetch indicator, Excel-import result/error banners, and the pagination footer. Legacy renders the full `db.items` array client-side, so it needs none of these; our list is server-paginated. Removing them would delete working behaviour and orphan the `itemType` query param. Kept, and left in legacy's slot order (search → Template → Import Excel → Add Item).

**Trap-1 check passed (no gap):** the Item Master tip names "Store → **Store / Inventory**" (legacy L11518). Verified the destination exists before restoring the wording — `/store-inventory` is in the sidebar (`components/shared/sidebar.tsx:137`). React had drifted to "Store → Stock Ledger", a *different* existing page (`:138`), so this was a genuine wording defect rather than a missing feature.

## ISSUE-018 — Machine Master list: legacy's 3 calc/maint columns + 2 row actions are DELTA

- **Surfaced:** 2026-07-15 (legacy page-parity refactor track, REFACTOR-1, `/machines`)
- **Severity:** P3 (the list is usable and now matches legacy for every field GET /machines returns; the missing columns are load/maintenance visibility, not data loss)
- **Status:** [ ] open — deferred; each item below needs backend work that is outside the UI-only parity pass.

**Fixed in the parity pass (not deferred):**
1. **₹/hr column was missing entirely.** Legacy L13089 renders `<td class="td-ctr mono" style="color:var(--green)">₹{hourRate}</td>`. `hourRate` is already on `machineSchema` (`packages/shared/src/schemas/machine.ts:14`) and already returned by `GET /machines` — the column was simply never ported. Built, no backend change needed.
2. **`td-ctr` on a `<span>` (2 columns).** Cap/Shift and Shifts rendered `<span className="mono td-ctr">`. `.td-ctr` is `text-align:center` (`innovic-theme.css:397`), which does nothing on an inline element — both columns silently shipped left-aligned where legacy centres them. The class now sits on the `<td>`.

**Deferred — needs backend:**
| Legacy column / action | Legacy ref | Blocker |
| --- | --- | --- |
| Avail Qty | L13091 (`m.totalAvailQty`) | calc-engine `machineLoad` (L1703-1715). Exists as `machineLoadCardSchema.totalAvailQty` in the machine-loading module, but `GET /machines` does not return it. Needs the field added to the machines list service (or a second query on this page). |
| Pending Hrs | L13092 (`m.pendingHrs`) | same — `machineLoadCardSchema.pendingHrs`. |
| 🔧 Maint status | L13074-13083, L13093 | `lastMaintDate` + `maintCycleDays` do not exist on the `machines` table at all. Needs a migration. Legacy derives OVERDUE / Due-in-Nd / OK(Nd) from `lastMaintDate + maintCycleDays × 864e5`. |
| 🔧 Log Maintenance row action | L13096, `_logMaint` L13163-13191 | needs a `machine_maint_log` table (date, type, hours, doneBy, notes) + endpoints. Legacy also writes back `m.lastMaintDate` and logs a `MAINTENANCE` activity row. |
| Del row action | L13097 | `useSoftDeleteMachine` exists, but adding a destructive mutation + confirm to the list is behaviour, not markup — out of a UI-only pass. Delete is available on the machine detail page today. |

**Trap-1 hit — search placeholder advertised a search the API cannot do.** Legacy L13103 reads `🔍 Search machine, type…`, which is accurate *there* because legacy `searchFilter` (L1513-1520) text-matches the whole rendered row, type column included. Our `GET /machines` only ILIKEs `code` + `name` (`apps/api/src/modules/machines/service.ts:38-44`) — typing a machine type returns nothing. Placeholder trimmed to `🔍 Search machine…` + `title="Search by machine ID or name"`, matching the Vendors precedent (`vendors/routes/list.tsx:162-163`). **Restore legacy's wording only when `machineType` is added to the service's `or(ilike(...))`** — a 1-line change, but `apps/api/` is out of scope here.

**Missing CSS class — `.b-running`.** Legacy `badge()` (L1963) maps `Running → b-running`, defined at L10561 as a solid green **pulsing** badge (`background:#22c55e;color:#fff;font-weight:800;animation:pulse-run 1.5s infinite`). `innovic-theme.css` has no `.b-running` and inventing one is not permitted, so `statusBadgeClass` keeps `Running → b-blue`. Revisit if `.b-running` + the `pulse-run` keyframes are ever ported. (Legacy also maps `Under Maintenance → b-red`; our status vocabulary is Idle/Running/Down/Maintenance, driven by the route's search enum, so the mapping is left as-is.)

**Deliberately not copied — the "Shifts" column.** The React list carried a Shifts column that legacy's table does not have (legacy carries `shifts` on the machine *form* only, L13119-13121). Dropped so the column set matches legacy, returning that slot to ₹/hr. `shiftsPerDay` is still shown on the machine detail page (`machines/routes/detail.tsx:178`).

**Not affected by ISSUE-016.** `/machines` does not use `SortTh`/URL sort params — it sorts client-side via `SortableHead` + `getSortedRowModel`, so the `toQueryString` drop does not apply here. Its sort *does* work, but only within the loaded 25-row page (the list is server-paginated), so "sort by Name" reorders the current page rather than the whole master. Worth folding into the ISSUE-016 fix.

---

## ISSUE-019 — Route Card Master list: Operation Sequence column + sortable headers are DELTA

- **Surfaced:** 2026-07-15 (legacy page-parity refactor track, REFACTOR-1, `/route-cards`)
- **Severity:** P4 (no data loss and no dead UI — the operation sequence is reachable on the same screen via the expand-row; this records why the column is not inline)
- **Status:** [ ] open — deferred; both items need backend work outside the UI-only parity pass.

**Fixed in the parity pass (not deferred) — the Actions column was missing entirely.** Legacy `renderRouteCards` (L10114-10119) renders `View / Edit / 🖨 / Del` on every row. The React list shipped with **no Actions column at all**, even though every backing piece already existed: the detail route, the edit route (`route-cards/$id/edit`), `useDeleteRouteCard`, and `lib/print-route-card.ts`. All four are now wired. The 🖨 needed a new `PrintRouteCardButton` (ops + item are not on the list row) — it lazily arms `useRouteCard` + `useItem` on first click, mirroring the `PrintJcButton` precedent (`job-cards/components/print-jc-button.tsx`) rather than fetching a detail per row.

**Trap-1 hit — the tip described an action the page did not have.** Legacy's tip (L10132-10133) reads "You can also create/edit route cards **directly here**." The React port had silently dropped that sentence — correctly, because with no Edit button the page could not do it. The sentence is restored now that the Actions column exists, rather than the other way round.

**Deferred — needs backend:**
| Legacy column | Legacy ref | Blocker |
| --- | --- | --- |
| Operation Sequence (inline chips) | L10109-10113 | `RouteCardListItem` carries only `opCount` (`packages/shared/src/schemas/route-card.ts:112-117`); the ops live behind `GET /route-cards/:id`. Rendering the column inline would need either the ops rolled into the list service (`apps/api/src/modules/route-cards/service.ts:207-229`) or one detail request per row. The expand-row keeps the same information one click away and fetches it lazily — kept as the deliberate adaptation. |
| Sortable `RC No.` / `Item Code` / `Last Updated` headers | L10137 (`sTh('routecards',…)` + `sArr` L10100) | `listRouteCardsQuerySchema` has no `sortBy`/`sortDir` at all and the service hardcodes `ORDER BY rc.code DESC` (service.ts:227). Needs the query params + service support before `SortTh` can be used. |

**Not affected by ISSUE-016.** `/route-cards` has no sorting whatsoever — no `SortTh`, no sort search-params — so the `toQueryString` drop that breaks clients/items/vendors does not apply. It is missing sortable headers rather than shipping broken ones, so no UI currently advertises sorting that does nothing.

**Missing CSS class — `.tag`.** Legacy renders the Rev cell as `<span class="tag" style="background:var(--bg4);color:var(--cyan);font-weight:700">R1</span>` (L10107). `innovic-theme.css` has **no `.tag` rule** (the token appears nowhere in the file) and inventing one is not permitted, so the cell keeps the existing `mono fw-700` + cyan span, which renders the same `R1` text. Revisit if `.tag` is ever ported.

**Deliberately not copied — `canEntry()` gate on the Add button.** Legacy hides `+ Add Route Card` behind `canEntry()` (L10127), a per-user *per-form* access model (`_getUserAccess`, L13785-13791) that has no React equivalent — our authz is role-based. `POST /route-cards` enforces no role server-side, so the button stays visible to every authenticated user and no gate was invented. `Del` **is** admin-gated, because that one is a real enforced backend rule (`service.ts:698`) — matching the Route Card detail page.

## ISSUE-020 — `td-ctr` on inline `<span>`: 9 list pages render centred columns left-aligned

- **Surfaced:** 2026-07-15 (REFACTOR-1 parity pass — found on Item Master, scale confirmed by the Machines agent)
- **Severity:** P3 (purely visual, but wrong on the busiest lists in the app, and invisible to code review)
- **Status:** [~] partial — fixed on `items`, `machines`, `job-cards`, `sales-orders`, `purchase-requests`, `cost-centers` as their pages were refactored.
- **⚠ THE COUNT BELOW IS A LOWER BOUND, NOT A TOTAL.** It came from `grep '<span[^>]*\btd-ctr\b'`, which is **line-based**: any JSX span written across multiple lines (`<span\n  className="mono td-ctr">`) is invisible to it. This has already under-counted twice — first with an even narrower pattern (`<span className="td-ctr"`) that reported **1** instance app-wide when there were 21, missing every case where the class was second (`className="mono td-ctr"`); then on Job Cards, where the grep found 2 sites and the agent found **4**. Treat the table as "at least these"; each page's refactor must grep its own file *and* read the cell renderers.

**The bug:** `.td-ctr { text-align: center }` (`apps/web/src/styles/innovic-theme.css:397`). `text-align` aligns inline content *within a block container* — it does **nothing** when applied to an inline `<span>`. Many list pages put the class on a `<span>` inside a TanStack `cell:` renderer, while the `<td>` itself is emitted bare by `flexRender` (e.g. `sales-orders/routes/list.tsx:372`, `purchase-orders/routes/list.tsx:322` — both literally `<td key={cell.id}>`, no className). `.innovic-table td` sets no `text-align` either (only `th` does, L362), so every one of these columns falls back to left-aligned where legacy centres them.

**Why it survived review:** the class name reads correctly in the diff. You have to know `text-align` doesn't apply to inline elements to spot it. `purchase-orders/routes/list.tsx` was marked **Refactored** by an earlier pass and still carries 3 instances.

**Remaining (grep `<span[^>]*\btd-ctr\b` over `apps/web/src/**/*.tsx`):**

| File | Count |
| --- | --- |
| `job-work-orders/routes/list.tsx` | 5 (L132, L133, L142, L154, L165) |
| `sales-orders/routes/list.tsx` | 3 (L236, L237, L246) |
| `purchase-orders/routes/list.tsx` | 3 (L121, L145, L156) |
| `goods-receipt-notes/routes/list.tsx` | 2 (L136, L142) |
| `delivery-challans/routes/list.tsx` | 2 (L172, L180) |
| `job-cards/routes/list.tsx` | 2 (L208, L289) |
| `qc-processes/routes/list.tsx` | 2 (L75, L108) |
| `nc-register/routes/list.tsx` | 1 (L155) |
| `purchase-requests/routes/list.tsx` | 1 (L132) |

**Fix:** the class belongs on the `<td>`. Two ports already exist — a type-only `ColumnMeta.tdClass` augmentation consumed in the `flexRender` loop (`items/routes/list.tsx`), or dropping `useReactTable` for plain `<tr>/<td>` per the `bom-master` gold standard (`vendors`, `machines`, `operators`). Either is fine; pick per page.

**Disposition:** every affected file is a page on the REFACTOR-1 list, so each gets fixed when its batch comes up. No separate sweep needed — but if REFACTOR-1 is ever stopped early, this becomes an orphan and needs one.

**Lesson:** a CSS class can be spelled right, imported right, typecheck clean, lint clean, and still be inert. Neither `tsc` nor `eslint` knows `text-align` needs a block container. Only comparing rendered intent against legacy caught it.

---

## ISSUE-021 — Cost Center Master list: Actions column was missing; Status/weight rendering are DELTA

- **Surfaced:** 2026-07-15 (legacy page-parity refactor track, REFACTOR-1, `/cost-centers`)
- **Severity:** P4 (the missing Actions column is fixed below; what remains is cosmetic and needs no backend work)
- **Status:** [ ] open — remaining items are deliberate deviations recorded for review, not deferred work.

**Fixed in the parity pass — the Actions column was missing entirely.** Legacy `renderCostCenters` (L17176) renders `✏` (edit) + `✖` (delete) on every row and declares `<th>Actions</th>` (L17186) with `colspan="7"` on the empty state (L17187). The React list shipped **6 columns and no Actions cell**, even though both backing pieces already existed: the `cost-centers/$id/edit` route (`routes/edit.tsx:11`) and `useSoftDeleteCostCenter` (`api.ts:73`). **Edit was unreachable from the list** — same defect class as Route Cards (ISSUE-019) and Operators. Both are now wired, gated on `canWrite`, with legacy's exact confirm copy `Delete this cost center?` (L17236).

**Also fixed:** legacy puts `mono fw-700` / `text3` on the `<td>` itself (L17170-17176); the port had them on `<span>`s inside a bare `flexRender` `<td>`. Rows are now plain `<tr>/<td>` per the `bom-master` gold standard. Legacy sets **no** font-size on Department/Type (L17172-17173) — the port was shrinking both to 11px for no reason; removed. Only Description keeps `font-size:11px`, which legacy does specify (L17174).

**Status colour was wrong.** Legacy (L17168, L17175) renders Status as bold text coloured `var(--green)` when Active and **`var(--text3)`** when Inactive. The port used `badge b-amber` for Inactive — amber reads as a warning state that legacy never intended. Now `b-grey`, which is literally `color: var(--text3)` (`innovic-theme.css:459-463`), matching legacy's colour and the Operators precedent.

**Deliberately not copied:**
| Legacy behaviour | Legacy ref | Reason |
| --- | --- | --- |
| Status as a bold `<span>` rather than a `.badge` | L17175 | Legacy styles it with inline `font-weight:700;color:…`. Reproducing it exactly needs a new inline style (not permitted) and would break from every sibling master list, which all badge Active/Inactive. `b-green`/`b-grey` carry the same two colours. |
| Name cell at `font-weight:600` | L17171 | `innovic-theme.css` has `.fw-700` but **no `.fw-600`**, and inventing one is not permitted. Kept `fw-700` (what the port already used, and what Operators uses). Cosmetic 100-weight delta. |
| Blank cells for empty Department / Type / Description | L17172-17174 (`esc(cc.department\|\|'')`) | Legacy renders an empty cell; the port renders `—`. Left as-is: `—` is the established convention across every ported master list (`operators/routes/list.tsx:203`), and changing it would make this page the odd one out for zero parity gain. |
| Search / department / type / status filters + pagination | — | Legacy has **none** of these (it renders `db.costCenters` unfiltered and unpaginated). All four are real, server-backed React additions (`service.ts:32-42`) and removing working features is not the job of a parity pass. |
| Sortable headers | L17186 (plain `<th>`) | Legacy's headers are not `sTh`. The port's client-side `SortableHead` is a DELTA, kept per instruction. Same caveat as ISSUE-018: it sorts only the loaded 25-row page. |

**Trap 1 — clean, verified not assumed.** The search placeholder reads `Search code, name, description…`, and unlike Machines/Vendors this one is **accurate**: `listCostCenters` ILIKEs all three of `code`, `name`, `description` (`apps/api/src/modules/cost-centers/service.ts:32-39`). The `department` / `type` / `isActive` selects are likewise all honoured server-side (service.ts:40-42). The empty state's `Click + Add Cost Center` (L17187) points at a button that exists — though note legacy shows that text even to users who cannot see the button (it gates the button on `canEntry()` at L17183 but never gates the sentence); the port reproduces that flaw faithfully rather than diverging.

**Not affected by ISSUE-016.** `listCostCentersQuerySchema` has no `sortBy`/`sortDir` **at all**, so `toQueryString` (`api.ts:19-28`) has nothing to drop. Sorting here is purely client-side. The service hardcodes `ORDER BY code ASC` (`service.ts:51`). Blast radius stays clients/items/vendors.

## ISSUE-022 — Report / Document Master data goes nowhere: the SO/JW Planning integration was never ported

- **Surfaced:** 2026-07-15 (REFACTOR-1, Report Types list)
- **Severity:** P2 (a whole master screen users can fill in that has no downstream effect)
- **Status:** [ ] open — web UI gap only; the backend already supports it

**Gap:** The Report Master tip promises report types "will appear as options when adding QC document requirements in SO/JW Planning." Legacy delivers this — L9511 builds the `dlDocPresets` datalist from Active report types, and L9761 auto-applies a preset's `defaultMandatory` when a known name is selected. In our port, `useReportTypes` is consumed by **`report-types/routes/list.tsx` and nothing else**; `modules/plans` has zero matches for `reportType` / `requiredDocs` / `docReq`. Whatever an admin defines here currently affects nothing.

**Why the text was kept (not deleted):** unlike the Daily Report defect (ISSUE-017), the promise is not about a control on the Report Master page — it describes behavior on the *Planning* screen. Deleting the sentence would conceal the gap rather than surface it, and the one-page rule barred the agent from touching Planning. Kept deliberately, logged here instead.

**Backend already supports it:** `requiredDocs` exists in `packages/shared/src/schemas/plan.ts:95,202,267`. The missing piece is the Planning web UI (datalist + defaultMandatory auto-apply).

**Fix sketch:** in the Planning doc-requirements editor, feed `useReportTypes()` (Active only) into a datalist and auto-apply `defaultMandatory` on name match. Mirrors legacy L9511 + L9761. Do it when Planning pages come up on the REFACTOR-1 list.

## ISSUE-023 — User Management list: legacy's Access column would INVERT our access semantics; Del + Import deltas

- **Surfaced:** 2026-07-15 (REFACTOR-1, Users list)
- **Severity:** P2 (the Access column is a **do-not-build-verbatim** trap on an authorization screen)
- **Status:** [-] Access column won't-fix as legacy renders it — needs a decision, see below. Del / Import: [ ] open.

**1. Access column (legacy col 4, L13443/L13450) — deliberately NOT built.** It is buildable UI-only: `useUserAccessList()` already returns `fullAccess` / `deptCount` / `totalDepts`. It was still refused, because **the semantics are inverted between the two systems**:

- Legacy: `"Not configured"` means **restricted** — the user has no access.
- Ours: `isUnconfigured()` (`apps/web/src/lib/access-control.ts:137-147`) returns `true` = **ALLOW everything** (deliberate opt-in day-one rollout).

A verbatim port would show a grey `"Not configured"` badge — which reads as *locked down* — against users who in fact hold **full access to everything**, on the exact screen an admin uses to audit permissions. This is the one place where "match legacy exactly" produces a dangerous lie.

**Decision needed:** (a) leave it off — `/access-control` already shows this correctly with semantics explained; (b) build it with **our** wording (e.g. "Full access" / "N of M depts"), accepting the label delta from legacy; (c) build it verbatim (NOT recommended). Default until told otherwise: (a).

**2. Del button (legacy L13454) — NOT built though `useSoftDeleteUser()` exists (`users/api.ts:79`).** Destructive + guard semantics differ: legacy guards with `db.users.length<=1`; our edit page guards self-delete and already offers Delete with a confirm. Decide the guard before putting it on the list.

**3. 📥 Template / 📤 Import (legacy L13462-63) — NOT built, no backend exists** (nothing in `apps/api/src/modules/users`). Bulk user import creates auth accounts and assigns roles — permission-granting. Not faked; the advertising text was not shipped either.

**4. Tip wording corrected, not copied.** Legacy L13469 says Edit manages "name, role, email, department access, form permissions, and approval rights — all in one window" (legacy `_unifiedUserForm` L13474). Our `/users/$id/edit` has none of those three: email is read-only (Supabase Auth owns it), dept/form permissions live on `/access-control`. Reworded to what Edit actually does — trap 1 per ISSUE-017. **Confirm the wording.**

**5. Minor:** `useApprovalConfig()` fires before the `!isAdmin` early-return with no `enabled` guard (unlike `useUsersList`), so it 403s for non-admins. Pre-existing; fix needs `api.ts`.

## ISSUE-024 — `form-label-required`: an invented CSS class the refactor skill itself prescribed

- **Surfaced:** 2026-07-15 (REFACTOR-1, Report Types list)
- **Severity:** P3 (required-field star renders unstyled instead of red)
- **Status:** [~] source fixed + `report-types` fixed. **1 live instance remains: `qc-documents/routes/list.tsx:1233`.**

**The bug:** `form-label-required` is defined in **no stylesheet** — `grep -rn "form-label-required" apps/web/src/styles/` returns nothing. The real convention is `<span className="req">★</span>`, styled by `.form-label .req` (`innovic-theme.css:566`, red, `margin-left:2px`) — used by `bom-master/components/bom-form.tsx:244`, `clients/components/client-form.tsx:110`, and every other form in the repo.

**The source was our own tooling.** `.claude/skills/refactor-page-to-legacy.md:186` prescribed `<span className="form-label-required">*</span>` in its form-field worked example — in the same document whose rules say *"Don't invent CSS classes — use only what's in innovic-theme.css."* Every agent following the example would reproduce it. **Skill corrected 2026-07-15** with a note explaining why.

**Remaining:** `qc-documents/routes/list.tsx:1233` (`File <span className="form-label-required">★</span>`). Page #123 on the REFACTOR-1 list; its batch will fix it.

**Lesson (same family as ISSUE-020):** a CSS class can be spelled plausibly, typecheck clean, lint clean, review clean — and be completely inert. Nothing in the toolchain checks that a class exists. Grep `apps/web/src/styles/` before trusting one.

## ISSUE-025 — Status badge colours drift from legacy on Job Cards (3 of 5) and Purchase Requests (3 of 4)

- **Surfaced:** 2026-07-15 (REFACTOR-1, batch 4)
- **Severity:** P3 (semantic — a colour signals a state the record is not in)
- **Status:** PR badge [x] fixed 2026-07-15. **JC badge [ ] open — needs a decision, see below.**

**Purchase Requests — FIXED.** `pr-status-badge.tsx` vs legacy `stColor` (L6253): `open` blue→**amber**, `approved` cyan→**blue**, `cancelled` grey→**red**. The port signalled `cancelled` as neutral grey and `open` as steady blue; legacy flags open=amber (needs attention), cancelled=red. Component is shared with the module's own `detail.tsx`, so both pages move together — same module, acceptable.

**Job Cards — NOT fixed, deliberately.** `jc-status-badge.tsx` vs legacy `badge()` (L1961-67):

| Status | Legacy | Ours | |
| --- | --- | --- | --- |
| `open` | `b-cyan` | `b-grey` | WRONG |
| `complete` | `b-green` | `b-cyan` | WRONG |
| `no_ops` | `b-grey` | `b-red` | WRONG |
| `qc_pending` | `b-amber` | `b-amber` | ok |
| `closed` | `b-green` | `b-green` | ok |

`no_ops` rendering **red** is the worst — it signals an error state for a JC that merely has no operations yet.

**Why deferred (3 reasons, all real):**
1. `JcStatusBadge` is shared with `jc-status-content.tsx` — fixing it silently refactors a **second page**, breaking the one-page rule.
2. **`docs/STYLE_GUIDE.md:229-241` documents the current mapping** (Open→`b-grey`, Complete→`b-cyan`) as a project-wide rule. Code and doc must move together.
3. Status colour is muscle memory for 15-20 live users. Changing it mid-flight without telling them is its own defect.

**Fix:** a dedicated task covering `jc-status-badge.tsx` + `STYLE_GUIDE.md` + both consuming pages, announced to users. Not a drive-by.

## ISSUE-026 — Purchase Requests: Approve / Cancel row actions need backend before they can ship

- **Surfaced:** 2026-07-15 (REFACTOR-1, PR list)
- **Severity:** P2 (wiring the obvious UI would silently corrupt the outsource chain)
- **Status:** [ ] open — **do NOT build the buttons until the backend lands**

**Gap:** legacy L6256-6259 puts Approve / Cancel on each PR row. Ours has neither.

**Why it was NOT built (the important part):** `PATCH /purchase-requests/:id` sets `status` only (`apps/api/src/modules/purchase-requests/service.ts:429`). It does **not** stamp `approved_by` / `approved_at`. And legacy `cancelPR` (L6426+) resets the upstream JC op `outsourceStatus` back to `Pending` — our PATCH does nothing of the sort. Wiring a button to the existing endpoint would look correct, return 200, and leave the outsource chain corrupt on a live system. `docs/erp-map/purchase-requests.md:28` confirms no approve endpoint exists.

**Fix sketch:** real `POST /purchase-requests/:id/approve` (stamps approver + timestamp) and `/cancel` (cascades `outsourceStatus` back to Pending on the source JC op, in a transaction). Then the UI is trivial. **Backend first.**

**Related, same page, also deferred:**
- **SO filter (legacy L6301)** — `ListPurchaseRequestsQuery` has no SO/JC param. Client-side filtering would filter only the loaded 25-row page and silently mislead.
- **Checkbox multi-select + "Create PO from Selected" (L6295/L6304/L6323)** — already ported on `/outsource-jobs` (`from-pr-batch`) for OSP PRs only. Duplicating that modal here is a feature port, not a parity pass.
- **Tip line (L6308) deliberately NOT shipped** — it advertises exactly the checkbox flow and SO filter this page lacks (trap 1, ISSUE-017).

## ISSUE-027 — `.tbl-frozen` does not exist: the two widest tables lost legacy's frozen columns

- **Surfaced:** 2026-07-15 (REFACTOR-1 — hit independently on Job Cards and Sales Orders)
- **Severity:** P3 (usability on the widest tables in the app)
- **Status:** [x] **RESOLVED 2026-07-15 — `.tbl-frozen` ported verbatim from legacy L119-122** into `innovic-theme.css`. It was never a design decision: legacy defines it in its MAIN stylesheet as descendant selectors (`.tbl-frozen tbody td:first-child, .tbl-frozen thead th:first-child { position:sticky; left:0; ... }`) plus 3 background rules that keep the pinned cell opaque over the zebra/hover rules. An earlier grep for a bare `.tbl-frozen {` rule missed it and I nearly wrote it off as dead — **the same too-narrow-pattern error as the ISSUE-020 under-count.** Pages must now add `tbl-frozen` alongside `tbl-wrap` where legacy has it (JC L5784, SO L11970, PO L25349, GRN L26492, + L14319, L16085).

### The missing-class family, resolved — each one checked against legacy's ACTUAL stylesheet

The rule that settles every case: **grep legacy for the definition, and check WHICH `<style>` block it lives in.** Legacy's main stylesheet opens at L10; a second, print-only block opens at **L10539**. A class defined only in the print block does nothing in legacy's app.

| Class | Legacy definition | Verdict |
| --- | --- | --- |
| `.tbl-frozen` | **L119-122, main CSS** | **PORTED** — real, was a genuine gap |
| `.tag` | **L272, main CSS** | **PORTED** — real; small square mono chip, distinct from pill `.badge` (Item UOM L11492, Route Card Rev L10107) |
| `.b-running` | L10561 — **PRINT BLOCK ONLY** (opened L10539) | **DO NOT PORT.** Legacy's `badge()` maps `Running → b-running` in the app, but the app CSS never defines it — so it renders **unstyled** in legacy. Porting the green pulse would DIVERGE. Machines' `b-blue` fallback is also a divergence; matching legacy means no colour at all. |
| `.stat-card.blue` | **NOT DEFINED ANYWHERE** — legacy defines exactly cyan/amber/green/red (L97-102) | **DO NOT PORT.** Legacy writes `stat-card blue` (QC L23608, PO L25336, GRN L26487) against a class it never defines, so those tiles have a 2px bar with **no background in legacy too**. Our theme already ports all four real variants faithfully. The GRN port removing its *invented* inline blue border was CORRECT — it moved us TOWARD legacy. **I added a `.blue` rule here on the assumption legacy must define it, did not check, and reverted it.** Assumed-not-verified, exactly the error this track keeps finding in others. |
| `.fw-600` | **NOT DEFINED** — legacy uses inline `font-weight:600` | Correct to refuse. Cost Centers kept `fw-700`; the 600/700 delta is cosmetic and logged. |
| `.row-actions` / `-btn` / `-menu` (+2) | **L148-152, main CSS** | **NOT ported — deliberate.** CSS alone won't reproduce it: it's a kebab dropdown needing open/close state, outside-click dismissal and z-index management. That's a component port, not a stylesheet gap. No list in this repo has legacy's kebab menu; ours use inline buttons. Decide separately. |
| `form-label-required` | **NOT DEFINED — invented by our own skill** | See ISSUE-024. Use `<span className="req">★</span>`. |

**The generalisable lesson:** "legacy references class X" does NOT imply "legacy defines class X", and "legacy defines X" does not imply "X applies in legacy's app" (it may be print-only). Both directions produced wrong conclusions here — mine included. Check the definition AND its `<style>` block before porting or refusing.

**Gap:** legacy wraps its widest tables in `<div class="tbl-wrap tbl-frozen">` — Job Cards L5784 (15 columns), Sales Orders L11970 (12 columns). `.tbl-frozen` is in **no** stylesheet here; our pages use plain `tbl-wrap`, so nothing pins. On a 15-column table you lose the JC No. as soon as you scroll right.

**Not approximated** — a sticky-column rule is a real design decision (which column pins, how it interacts with `tbl-wrap` overflow and the zebra `nth-child` rule, behaviour at narrow widths). Both agents stopped and reported rather than guess.

**Fourth member of the invented/missing-class family** alongside `.tag`, `.b-running`, `.fw-600` (referenced by legacy, never ported) and `form-label-required` (ISSUE-024, invented outright). Worth one pass deciding each: port it, or record why not.

## ISSUE-028 — Sales Orders list: fields legacy shows that our payload/scope cannot reach

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO list)
- **Severity:** P3
- **Status:** [ ] open

1. **`clientCode` not on the list payload.** Legacy L11865 renders `clientCode — customer`; `salesOrderListItemSchema` carries only `customerName`. Not faked. Needs the field on the list endpoint.
2. **`LINKED BOM` fact + `Plan BOM Items (N parts)` count absent** (legacy L11891/L11894). Data exists (`soStatusEquipmentInfo.bomNo/bomRev/bomName/bomPartsCount`) but rendering needs a `useSoStatus` call inside `EquipmentSoExpand` — a request per expanded Equipment SO, including ones with no BOM. Data-fetching change, outside UI-only scope.
3. **Search placeholder — trap 1, third occurrence.** Legacy L11964 advertises `Search SO, client, item...`; `listSalesOrdersQuerySchema:258` matches code / customer / clientPoNo only — no item join. Port's accurate text kept. **Vendors and Machines had the identical defect.** Worth one backend pass adding item search across all three.
4. **Overdue warning icon on Due Date is invented semantics** — legacy never signals it. Kept (useful, deliberate), but same family as the Cost Centers amber drift. **User's call whether it stays.**

## ISSUE-029 — Duplicate `ColumnMeta` module augmentations (orchestration defect, fixed)

- **Surfaced:** 2026-07-15 (REFACTOR-1, caught during batch 4 reconciliation)
- **Severity:** P4 (fixed same day; recorded because the failure mode is non-obvious)
- **Status:** [x] fixed 2026-07-15 — consolidated to `apps/web/src/types/tanstack-table.d.ts`

Four list pages (`items`, `job-cards`, `sales-orders`, `purchase-requests`) each independently declared `declare module '@tanstack/react-table'` with an identical `ColumnMeta.tdClass` while fixing ISSUE-020. Each agent did the locally-correct thing and could not see the other three — a parallel-orchestration artefact, not a page defect.

**Why it mattered:** it is a *global* augmentation. Four copies typecheck **only** while all four stay byte-identical; the first divergence produces an obscure error far from the cause. It was also on track to spread to ~30 more list pages as batches continued.

**Fix:** one shared `.d.ts`, per-page copies removed (plus their now-unused `RowData` imports). The `import type { RowData }` in that file is load-bearing — without a top-level import the file is not a module, and `declare module` would **replace** `@tanstack/react-table` types instead of augmenting them. Typecheck passing is the proof it augments. The skill now documents `meta.tdClass` and tells agents not to re-declare it.

## ISSUE-030 — Purchase Orders list: legacy elements our payload / CSS / one-page scope cannot reach

- **Surfaced:** 2026-07-15 (REFACTOR-1 re-audit of a page an earlier pass had already marked "Refactored")
- **Severity:** P3 (P2 for the Value column — it is the only money figure on the screen)
- **Status:** [ ] open

Legacy `renderPurchaseOrders` L25209. ISSUE-020 (3+ dead `td-ctr` spans), the missing Actions column and an over-promising search placeholder were fixed in the pass; the following were not, each for a stated reason.

1. **"Value" column not shipped (legacy L25256, `<th style="color:var(--green)">Value</th>` L25354).** Legacy sums `qty*rate` across the PO's lines. `purchaseOrderListItemSchema` aggregates `lineCount / totalQty / receivedQty` only — no rate, no value. The list SQL (`service.ts` L216-224) would need `SUM(qty*rate)` in `line_agg`. **Not faked.** This is the only column legacy shows that carries money.
2. **Approve / Reject row actions not wired (L25260-25265).** The endpoint is a faithful port (stamps `approvedBy`/`approvedAt`, enforces the approver ceiling, draft-only — `service.ts` L1000-1075), so this is *not* an ISSUE-026-style backend gap. The blocker is the **gate**: legacy shows the buttons only when `_isPoApprover(tVal)` — i.e. the PO's value is within the approver's ceiling — and `tVal` is exactly the value the list payload lacks (see #1). Gating on approver-ness alone would show Approve to users legacy hides it from and surface the ceiling as a server error. Both actions remain on the detail page, one click from the row's View. **Fix #1 and this unblocks with it.**
3. **Print row action not shipped (L25267).** `printPurchaseOrder()` needs the full `PurchaseOrderDetail` (lines), vendor, company and templates. From a list row that is a detail fetch per row — a data-fetching change, outside UI-only scope. Print lives on the detail page.
4. **Stat-card filter row not shipped (L25332-25345) — blocked on a missing CSS class.** Legacy's Open card is `<div class="stat-card blue">`. **`.stat-card.blue` is in no stylesheet** — only `.cyan`, `.amber`, `.green`, `.red` variants exist (`innovic-theme.css:312-323`), and there is no `.blue` colour util either (unlike `.cyan`/`.amber`/`.green`/`.red` at :766-775). Rendering `stat-card blue` would silently drop the accent bar — the same inert-class failure as ISSUE-020/024. Not approximated with `cyan`. The counts themselves are reachable via the `COUNT_*` constant-query pattern the PR list already uses. **Fifth member of the missing-class family** (`.tbl-frozen` ISSUE-027, `.tag`, `.b-running`, `.fw-600`, `form-label-required` ISSUE-024) — plus `.row-actions` / `.row-actions-btn` / `.row-actions-menu` / `.ra-sep` / `.ra-icon` (legacy `rowActions` L28095), which is why no list page can reproduce legacy's kebab dropdown and all of them render actions inline instead. **This family now spans 10 classes and 6 issues — it wants one deliberate CSS pass, not six workarounds.**
   - Second, smaller blocker: legacy's Closed card counts `Closed || Cancelled` (L25216) but `ListPurchaseOrdersQuery.status` takes one status, so the card's click could not reproduce its own count.
5. **"PO Creation Pending — Approved PRs" panel not shipped (L25315-25331).** A cross-module panel: approved PRs + a "📝 Generate PO" button per row. The PR list already ports that action (`/purchase-orders/from-pr?prId=`), so this is a duplicate surface, and building it here is a feature port (a `usePurchaseRequestsList({status:'approved'})` call on the PO page), not a parity pass.
6. **`prCodeText` occupies legacy's SO/JW slot (position 5, L25252).** Legacy renders the linked SO via `first.soRefId → CASCADE.findOrder(...)._refNo`. Our payload has no SO/JW back-reference; `prCodeText` is the upstream-doc reference we do have, so it takes the slot rather than sitting in the Value slot where the earlier pass left it.
7. **Vendor renders `name` where legacy renders `Name [Code]`** (`vndLabel` L25251). The list SQL joins `v.name` but not `v.code`; `vendorCodeText` is the *free-text* vendor (used when `vendorId IS NULL`), not a linked vendor's code — using it as the `[Code]` would be wrong. **Same shape as ISSUE-028 #1 (`clientCode` missing on the SO list payload).** Two lists now want a code on the payload.
8. **Dates render raw ISO (`2026-07-15`) where legacy renders `15-Jul-26`** (`fmt()` L1948, applied at L25250). **Not a PO defect — an app-wide one:** the SO list (:210) and PR list (:141, :228) render raw ISO too. A one-off formatter here would diverge from every sibling list. Wants one cross-cutting decision + a shared helper.
9. **Badge drift, not fixed here (ISSUE-025 family).** `PoStatusBadge` maps `cancelled → b-grey`; legacy's `badge()` (L1959) maps `'Cancelled' → b-red`. The component is shared with the PO **detail** page, so changing it edits a second page — out of this pass's one-page scope. `draft→b-grey`, `open→b-blue`, `partial→b-amber`, `closed→b-green`, `qc_pending→b-amber` all verified correct against the PO list's own colour fn (L25244), which is the authority for this page and overrides the generic `badge()` (that one says `'Open'→b-cyan`).

**ISSUE-016 — this page is NOT affected.** `toQueryString` (`purchase-orders/api.ts` L21-32) does drop `sortBy`/`sortDir`, but `listPurchaseOrdersQuerySchema` has no such params to drop: PO sorting is client-side (`getSortedRowModel`) and the API is hard-ordered `ORDER BY po.code ASC` (`service.ts` L233). Worth noting the consequence anyway: client-side sort orders **the loaded 25-row page only**, while legacy's `sTh` sorts the whole array. Legacy makes only PO No. and Date sortable (L25351); ours makes every accessor column sortable — a superset, left alone.

## ISSUE-031 — NC Register: `rework_done` NCs can never be closed from the UI

- **Surfaced:** 2026-07-15 (REFACTOR-1, NC Register list)
- **Severity:** P2 (a live record state with no exit — data gets stuck)
- **Status:** [ ] open — detail-page fix, outside the list's scope

The backend cascade `closeNcReworkCascade` (`apps/api/src/modules/nc-register/cascades.ts:395`) accepts **`disposed` OR `rework_done`**, and legacy offers ✅ Close for **both** (L22540 *and* L22541). But `detail.tsx:75` gates the Close button on `status === 'disposed'` **only**. So an NC that reaches `rework_done` has no way to be closed from the UI even though the API would accept it.

The new list-page ✅ Close link was gated the same way **deliberately** — offering it for `rework_done` would land the user on a detail page with no Close button (trap 1). Fix the gate on `detail.tsx:75` and the list link can widen with it.

## ISSUE-032 — Delivery Challans: the KPI strip is ported from the WRONG legacy screen

- **Surfaced:** 2026-07-15 (REFACTOR-1, DC list)
- **Severity:** P2 (the tiles answer a different screen's question)
- **Status:** [ ] open — needs API summary fields

Our DC list shows **Total Dispatched / Dispatch Entries / Items Dispatched**. Those are a port of **`renderDispatchRegister` L10748-10770** — a **customer finished-goods** screen over `db.dispatchLog`. This page's actual counterpart, `_ospDCRegister` (L27419), has a **different 5-tile strip** (L27424-27429): **Total DCs** (cyan) / **Total Sent** (blue) / **At Vendor** (amber) / **Returned** (green) / **Vendors**.

Someone grafted the customer-dispatch KPIs onto the outsource-DC page. `At Vendor` / `Returned` / `Vendors` need fields `dispatchSummarySchema` doesn't return (it has only `totalDispatched` / `entryCount` / `itemCount`).

**Left intact deliberately** — the current tiles are live and data-backed; deleting them for parity would destroy a working feature. Fixing means backend summary fields + `api.ts`, both out of UI scope.

**Also on this page, reported not built:** `Process` / `Returned` / `Pending` columns (absent from `deliveryChallanListItemSchema`; Returned/Pending exist as *receipts* in our richer model, so they need an aggregate); the `Items` column shows a **count**, not item codes — NOT renamed "Items", since labelling a count as codes is trap 1 in reverse; per-row 🖨 (needs a detail fetch per row).

**Per-row ✏ edit deliberately NOT wired — the ISSUE-026 trap again.** Legacy `_ospDCEdit` (L27445) writes `returnedQty`/`status` **directly**. Our equivalent is the atomic `/receive` endpoint that cascades into `jc_ops`, `store_transactions` and auto-NC. Wiring legacy's edit would bypass all of it and corrupt the outsource chain on a live system.

## ISSUE-033 — QC Process Master never reaches Route Cards or Job Cards

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Processes list)
- **Severity:** P2 (a master whose records don't drive the screens its own tip names)
- **Status:** [ ] open — needs edits in two other modules

The QC Process Master tip (legacy L23467, kept verbatim) says these processes "can be added as **QC operations** in Route Cards and Job Cards". Legacy delivers: `_selQCProcesses` feeds Route Cards (L10215) and the JC op modal (L5877), auto-filling cycle time.

In our port, **only `so-planning/components/edit-plan-modal.tsx:130` imports `useQcProcessesList`.** `route-cards/components/route-card-form.tsx` and `job-cards/components/job-card-form.tsx` do offer QC ops (`opType: 'qc'`), but the process name is **free text** — not picked from this master. So the master's records don't drive either screen.

**Text kept deliberately.** Unlike Daily Report (ISSUE-017), the tip doesn't point at a control that doesn't exist — QC ops genuinely exist on both screens. It's ISSUE-022's shape inverted: there, Planning was never wired; here, Planning **was** wired and the two screens the tip names weren't.

**Fix:** feed `useQcProcessesList()` into the route-card and JC op forms as a picker with cycle-time auto-fill, mirroring L10215 / L5877. Do it when those pages come up on REFACTOR-1.

**Also on this page:** legacy's header says **`Std Time (h)`** — hours. Our `defaultCycleTimeMin` is genuinely **minutes** (`qc-process.ts:22`, ADR-016; `detail.tsx:154` agrees). Kept "(min)" — copying legacy's "(h)" would label minutes as hours, a worse defect than the mismatch. **Product call: which unit is right?**

**And:** legacy `delQCProcess` (L23508) has **no permission check at all** — any user can delete. Not copied; `canWrite` gate kept (CLAUDE.md §6).

## ISSUE-034 — `.b-purple` absent: NC "Return to Vendor" renders the wrong colour

- **Surfaced:** 2026-07-15 (REFACTOR-1, NC Register list)
- **Severity:** P4
- **Status:** [ ] open — one CSS rule away

Legacy colours the `Return to Vendor` disposition **purple** (L22524). `nc-disposition-badge.tsx` uses **`b-orange`**. There is no `.b-purple` badge class in `innovic-theme.css` — only the `--purple` token. Per the no-invented-class rule the agent stopped rather than approximate.

The component is used only inside the nc-register module (list + detail), so this is safely fixable once someone decides whether to port a `b-purple` badge variant. Check legacy's own `.badge` set first (see ISSUE-027's method: main stylesheet L10 vs print block L10539).

## ISSUE-035 — Per-agent typecheck is NOT authoritative during parallel batches

- **Surfaced:** 2026-07-15 (REFACTOR-1, batch 6 — caught by the DC agent)
- **Severity:** P4 (process note; no product impact)
- **Status:** [x] understood — post-batch combined verification is the control

The DC agent's first `pnpm --filter web typecheck` failed with `nc-register/routes/list.tsx(403): Cannot find name 'Plus'` — **a file it never touched**. The NC Register agent was mid-edit in the same working tree; `Plus` vanished between two runs. The re-run was clean.

**Implication:** when N agents refactor concurrently in one working tree, each one's typecheck/lint/test run observes the others' half-written files. A per-agent PASS can be luck and a per-agent FAIL can be someone else's transient state. **The orchestrator's combined typecheck + lint + build + test after every batch is the real gate** — agents' own runs are a smoke check only.

Not worth serialising the batches over: the failure is loud, transient, and the combined run catches anything real. But never treat a single agent's green as proof for the tree.

## ISSUE-036 — QC Documents matrix cannot select a Job Work Order

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Documents list)
- **Severity:** P2 (a whole document class is unreachable on this screen)
- **Status:** [ ] open — needs API + page work, out of a UI-only pass

Legacy's selector merges **both** collections — `db.salesOrders` **and** `db.jobWorkOrders`, keyed by `soNo`/`jwNo` (L23042-23043) — and is labelled **`SELECT SO / JW:`** (L23111). Every downstream helper does the same merge (`_qcDocExportExcel` L23162-23163, `_qcDocDownloadAllSO` L23215).

Our port is **SO-only at every layer**: `listQcMatrixSos` (`service.ts:164`) says so in its own comment — *"JW left as a follow-up"* — and the page uses `useSalesOrdersList` anyway. So QC documents for a JW-driven JC can't be reached from this screen at all.

**Label kept as `SELECT SO:` (Trap 1).** Copying legacy's `SELECT SO / JW:` would name a picker option that cannot exist. Fix the capability, then the label.

**Second, smaller finding:** `useQcMatrixSos` / `GET /qc-documents/so-list` (`api.ts:51`) is **dead code** — the page calls `useSalesOrdersList({ limit: 20 })` through a `SearchableSelect` instead. Both are SO-only, so this is not a behaviour gap, and the searchable/paginated picker beats legacy's unbounded `<select>` on an SO list this size. But two SO-list paths for one screen is drift: either delete the endpoint or move the page onto it (and give it the JW half). Hook choice is logic, so untouched here.

## ISSUE-037 — `signedUrlFor()` issues no download disposition; "Download" opens a tab

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Documents list)
- **Severity:** P3 (works, but not what the label promises)
- **Status:** [ ] open — one option away, in a shared lib

Legacy stores files as `data:` URLs, so it can render a true `<a download="MIR_JC-001_2026-04-29.pdf">` that saves with a **meaningful filename** (L23089, L23336), and `_qcDocDownloadAllSO` (L23217) / `_qcDocDownloadAllLine` (L23418) synthesise names like `L1_MIR_IN-JC-00001_2026-04-29.pdf`.

We serve Supabase signed URLs. `signedUrl()` (`lib/storage.ts:40`) calls `createSignedUrl(path, expiresIn)` **without** the `{ download }` option, so every "Download" on this page — matrix cell, Download All Reports, Download All, and the new per-doc-type ⬇ — actually **opens a browser tab**. `download` on a cross-origin `<a>` is ignored, so markup alone can't fix it.

**Consequence — legacy's per-upload `⬇ Download` (L23336) was NOT ported.** The row already has `👁 View`; a second button opening the same tab would be a decoy. Per the "don't wire an action the backend can't complete" rule, reported instead of faked.

**Fix:** `createSignedUrl(path, expiresIn, { download: fileName })` and thread the filename through. `QcLineDoc.fileName` and `QcMatrixCell.fileName` are **already on the payload** and already unused by the page — the data is there, only the lib option is missing. Shared lib + multi-page blast radius, so not done in a one-page pass.

## ISSUE-038 — QC Documents: two legacy style decls not copied (one inert, one harmful)

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Documents list)
- **Severity:** P4
- **Status:** [x] decided — deliberate divergence, no action

Both on legacy L23113, the QC matrix table wrapper/header:

1. **`<tr style="background:var(--bg4)">` on the thead row — inert.** Legacy's own `th{background:var(--bg3)}` (L110) paints every cell, and with `border-collapse:collapse` no row background is ever visible. A Trap-2 dead attribute: copying it would add markup that renders nothing. Our `.innovic-table th` (`innovic-theme.css:359`) already reproduces the bg3 that users actually see.

2. **`overflow:hidden` on `.tbl-wrap` — real in legacy, harmful here.** It overrides `.tbl-wrap{overflow-x:auto}` (L108), so **legacy's own QC matrix cannot scroll sideways** — the author's intent was clipping the `border-radius:8px` corners, and killing the scroll was collateral. This table's width is *dynamic* (`MIR/MCR/DIR/TPI` + any extra QC op names, L23057-23060), so on a wide SO legacy silently clips columns with no way to reach them.

Not copied, per "never delete a working feature to reach parity". The border + radius are kept; the corners stay square where a scrollbar sits. This is the rare case where legacy is the spec **and** legacy is broken — logged rather than reproduced.

## ISSUE-039 — CAPA: closed records were editable behind a button labelled "👁 View"

- **Surfaced:** 2026-07-15 (REFACTOR-1, CAPA list)
- **Severity:** P2 (a quality-compliance record could be silently rewritten by someone who thought they were reading it)
- **Status:** [x] fixed 2026-07-15 — **but this REMOVES a live capability; confirm with the user**

Legacy hides ✏ for `Closed` CAPAs (L22816). Our port showed **"👁 View"** on closed records but opened the modal with `readOnly={!canWrite}` — so any admin/manager/qc user got a live **Save CAPA** button on a closed corrective-action record. The label said view; the modal saved.

Now 👁 is genuinely read-only and ✏ is hidden when Closed, per legacy. **If anyone relies on re-opening closed CAPAs this removes it** — trivial to revert, but today they're doing it through a mislabelled button.

**Also on this page, reported not built:**
- **`_capaDetail` (L22910-22949) was never ported.** Legacy's 👁 opens a distinct read-only detail modal with ✅/⏳ per-step completion, an NC/JC/Item/Dept grid and a "Created: {date} by {createdBy}" line. Ours approximates with the read-only edit modal. **Blocked:** `capaRecordSchema` has no `createdBy`.
- **New-CAPA modal lacks legacy's readonly "CAPA No." preview** (L22835, `_nextCAPANo`). Not added — the code is server-generated; a client preview duplicates numbering logic in the frontend (CLAUDE.md rule 1) and can disagree with the server under concurrency.
- **Numbering diverges:** `capa/service.ts:111` emits `CAPA-0001` (padStart 4); legacy `_nextCAPANo` (L22756) emits `CAPA-001` (padStart 3). Backend. Matters if legacy CAPA records are ever migrated in.
- **A legacy bug deliberately NOT copied:** legacy calls `esc()` on its own fallback markup (L22810), so it literally prints `<span style="...">Pending...</span>` as visible text on screen, plus `title="undefined"`.

## ISSUE-040 — App-wide: dates render raw ISO where legacy renders `15 Jul 26`

- **Surfaced:** 2026-07-15 (REFACTOR-1 — independently on NC Register, CAPA, Delivery Challans, PR, PO, Op Log, Job Queue, Machine Loading, Outsource Jobs, Task Board, Design ×3, Stock Valuation…)
- **Severity:** **P2** — upgraded. This is the display half of **ISSUE-065 (P1)**: both stem from the same root cause — **no shared IST-aware date utility**, despite CLAUDE.md §6 rule 5 mandating one and `date-fns-tz@^3.2.0` already being installed.
- **Status:** [ ] open — **needs ONE shared helper + one sweep, not per-page fixes**
- **⚠️ COUNT CORRECTION (2026-07-15):** this issue originally said "four local `fmt()` copies". **The real number is 12** — `grep -rlE "function fmt(Date)?[A-Za-z]*\s*\(" apps/web/src` returns **12 files**. Agents reported 4, then 5, then 7, then 12 as they each found more; every count was a lower bound because each agent only saw its own page. **Do not trust the number in a brief — grep.** (Same lesson as ISSUE-071.) Every agent correctly refused to add copy #13, which is the only reason this hasn't gotten worse.

Legacy's `fmt()` (L1484) renders `15 Jul 26`. Most ported lists print raw ISO (`2026-07-15`). Five separate agents hit this and **all correctly declined to fix it on one page** — a one-off would just make that page inconsistent with every other list.

Complication: the only existing helper (`lib/print/doc-print.ts:34`) emits `dd-MM-yyyy` — a **third** format, and it lives in the print layer. `invoices/routes/list.tsx` and `op-log/routes/list.tsx:45` now each carry a local `fmt()`, so the drift is already starting.

**Fix:** one shared presentational `fmt()` (IST per CLAUDE.md §6 rule 5 — `date-fns-tz`, `Asia/Kolkata`), then sweep every list. Do it as one task before more pages grow their own copy.

## ISSUE-041 — App-wide: `.badge` is uppercased; legacy's is not

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoices list)
- **Severity:** P3 (every badge on every page; one line)
- **Status:** [ ] open — **shared/global, needs a user decision (ISSUE-025 class)**

`innovic-theme.css` `.badge` is a near-exact port of legacy L125 — identical `display`, `padding`, `border-radius`, `font-size`, `font-weight`, `letter-spacing`, `font-family`, `white-space` — **except the port added `text-transform: uppercase`, which legacy does not have.**

Legacy renders `Paid` / `Open` / `Closed`. We render `PAID` / `OPEN` / `CLOSED`. Every badge, every page.

**The irony worth noting:** seven batches of agents have carefully matched legacy's exact badge *wording* (`Active` not `active`, `Pending` not `pending`) — and this one line uppercases all of it anyway. That label work only becomes visible if this is removed.

**Not changed unilaterally:** it's one line but an app-wide visual change for 15-20 live users. Same class as ISSUE-025 (JC badge colours). Decide deliberately; if removed, re-check that every badge's source string carries legacy's own casing.

## ISSUE-042 — Invoices list: `+ New Invoice` ungated, `🖨` unwirable, `💳 Pay` navigates

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoices list)
- **Severity:** P3
- **Status:** [ ] open

1. **`+ New Invoice` is ungated; legacy gates on `canEntry()` (L21136).** **Deliberately NOT changed** — no `invoice` key exists in `ACCESS_FORM_KEYS`, and the only mirror precedent (`job-cards/routes/list.tsx:116`) hard-codes `admin||manager`. Applying that would **remove invoice creation from every operator on a live system**. Needs a user decision.
2. **`🖨` row action can't be wired UI-only.** `printInvoice()` needs `InvoiceDetail` (`lines`, `clientGst`, `paymentTermsDays`); the list payload is `InvoiceRow` and has none. No capability lost (Print works on the detail page). Deliberately not faked — **printing a money document from a partial payload is exactly the wrong place to improvise.**
3. **`💳 Pay` navigates instead of opening legacy's in-place modal** (`_addPayment`, L21243). The repo has **no Modal component** (`components/ui/` is button/card/input/label/select/table/textarea), so an in-place port means duplicating a payment form — a component port touching money. The link reaches the detail page's Add Payment panel, which calls the same `useAddPayment`. Delta: one extra click.

**Clean on this page:** every list/summary field is now rendered (`overdueCount` was the one gap — it was on the payload, unused). No frontend money math: `balance` / `overdueAmount` / `outstanding` all come from the server, which already mirrors legacy's formulas (`service.ts:45-96`). Unlike the SO list (ISSUE-028), this payload was complete.

## ISSUE-043 — **APP-WIDE:** paginated `total` ignores the filters the rows apply → phantom pages (3+ modules confirmed)

- **Surfaced:** 2026-07-15 (REFACTOR-1 — hit independently on GRN, Store Transactions, Sales Orders)
- **Severity:** **P2** — live users page into empty results on the busiest lists; backend fix
- **Status:** [ ] open — **supersedes/absorbs the GRN instance filed as ISSUE-030**

### The pattern

A module's row query is raw SQL with filter fragments; its `total` is a **separate Drizzle count** that rebuilds the WHERE clause **and omits filters**. Rows narrow, `total` doesn't, `totalPages = ceil(total/PAGE_SIZE)` stays high → the pager offers pages that render nothing.

**Confirmed on three modules, each with a comment above it asserting the opposite:**

| Module | Rows apply | `total` applies | Missing |
| --- | --- | --- | --- |
| `store-transactions/service.ts:80-89` | item, type, source, **search, from, to** | item, type, source | search, from, to |
| `goods-receipt-notes/service.ts:281-292` | vendor, po, **search, qcStatus, from, to** | company, deleted, vendor, po | search, qcStatus, from, to |
| `sales-orders/service.ts:278-289` | status, type, client, **search, from, to** | status, type, client | search, from, to |

**`items` / `clients` / `vendors` are SAFE** — they reuse the *same* `where` variable for both queries, correct by construction. The bug only appears where the count re-derives its conditions.

### Why it survived review — the comments are wrong

`store-transactions:83` and `sales-orders:278` both say:
```ts
// Total count uses Drizzle ORM with the same filter set.
```
It is **not** the same filter set. A comment asserting correctness sits directly above the defect.

`sales-orders` goes further and fabricates a justification:
```ts
// search/dates omitted from the count for performance; total is approximate
// when search is active (acceptable — UI shows "X+ results"). Tighten later
```
**The UI shows no such thing.** `sales-orders/routes/list.tsx:346` does `totalPages = Math.ceil(total / PAGE_SIZE)` and `:426` renders `Page {currentPage} / {totalPages}` with Next enabled while `currentPage < totalPages`. Grep for `+ results` / `approx` / `~` in that file returns **nothing**. The trade-off the comment claims was accepted was never implemented — so "approximate" silently became "wrong", and the comment is why nobody looked again.

### Fix

Derive **one** condition set per query and use it for both rows and count (the `items`/`clients`/`vendors` shape). If a filtered count is genuinely too slow to run, then *actually* render an approximate indicator instead of feeding a precise-looking pager — but measure first; these are indexed columns on tables of this size.

**Interim UI note:** `store-transactions` already returns a correct `summary.txnCount` over the same filter set. Pointing the pager at it would mask the bug on one page while `total` stays wrong for every other consumer. Fix the count.

**Sweep the rest:** `purchase-orders:242`, `job-cards:933`, `purchase-requests:252`, `nc-register:290`, `delivery-challans:147` all build a separate count — unaudited, same shape, likely same bug.

---

### Original entry (Store Transactions instance)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Store Transactions / Stock Ledger)
- **Severity:** P2 — wrong row count on a ledger; backend fix
- **Status:** [ ] open

`listStoreTransactions` (`apps/api/src/modules/store-transactions/service.ts:80-89`) builds the `total` count with a **different, narrower filter set** than the rows themselves:

```ts
const conditions = [eq(storeTransactions.companyId, companyId)];
if (input.itemId) conditions.push(...);
if (input.txnType) conditions.push(...);
if (input.sourceType) conditions.push(...);
// search / fromDate / toDate are NOT applied
```

The row query and the KPI summary both apply `searchFrag` / `fromFrag` / `toFrag`; only `total` skips them. With a search term active the list shows "Showing 1–50 of 4,812" while `summary.txnCount` (correct, same filter set, no LIMIT) says 37 — and `totalPages` lets you page into empty results.

**Not fixed:** backend, outside a UI/JSX pass. Note the UI *could* be pointed at `summary.txnCount`, which is already correct — but the fix belongs in the count query so `total` stops being wrong for every other consumer.

## ISSUE-044 — Store Transactions: legacy Stock Ledger features the port cannot reach

- **Surfaced:** 2026-07-15 (REFACTOR-1, Store Transactions / Stock Ledger)
- **Severity:** P3
- **Status:** [ ] open

Legacy `renderStockLedger` (L25013-25160) has five things this page does not, none of them safely portable in a UI-only pass:

1. **Running-balance panel (L25105-25127).** When an item is selected, legacy shows a per-item ledger with a `Running Balance` column, computed **in the browser** by looping the movements. Reproducing that client-side violates CLAUDE.md §6 rule 1 on a money-adjacent figure, and the payload carries no running balance. Note the rows *do* carry server-written `stockBefore` / `stockAfter`, which is the same information recorded at write time — a per-item view could render those without any frontend math, if wanted.
2. **Item filter (L25097).** Legacy filters by item **code** via a `<datalist>` of all items. The API filters by `itemId` (uuid) — a code→uuid lookup needs an items source this page has none of. `itemId` is supported by `api.ts` and the query schema but is **unreachable from the UI**.
3. **From / To date filters (L25098-25099).** `fromDate` / `toDate` are supported end-to-end (`api.ts:22-23`, `service.ts:60-61`) and **never surfaced**. This is the cheapest real gap here — it is query wiring, not markup, so it was left for a scoped task.
4. **`⬇ Excel` export (L25102).** `_slExport()` dumps the rendered 500-row table. Ours would export only the 50-row page — a misleading export of a ledger. `xlsx` is already a dependency (`customer-dispatches/lib/export-excel.ts` is the precedent) so this is buildable, but it needs a full-filter-set fetch, not the page payload.
5. **`Sources: <src>: <n>` breakdown (L25144-25146, L25152).** Legacy counts movements per source across the **whole filtered set**. The payload's `summary` has no per-source counts; deriving them from `data.items` would count only the current 50 rows and silently under-report. Needs a `sourceCounts` field on `StockLedgerSummary`.

## ISSUE-045 — Store Transactions: `out` renders amber; legacy's Stock Ledger renders it red

- **Surfaced:** 2026-07-15 (REFACTOR-1, Store Transactions / Stock Ledger)
- **Severity:** P3 (shared component — ISSUE-025 class)
- **Status:** [ ] open

`TxnTypeBadge` (`apps/web/src/modules/store-transactions/components/txn-type-badge.tsx:6-10`) maps `out → b-amber`. Legacy's ledger colours the movement type **green for IN, red for OUT** (L25136), with no amber anywhere on the screen — amber in legacy means *pending*, not *outward*.

**Not changed:** the component is imported by `items/routes/detail.tsx:14` (the Stock history card), so recolouring it changes a second page in a one-page pass. Same class as ISSUE-025.

Note the **Qty** cell on the ledger list *is* now green/red per legacy (L25137), so `out` rows currently show a red qty beside an amber type badge. That inconsistency is visible and argues for fixing the badge — but deliberately, and on both pages at once.

## ISSUE-046 — Stock Valuation: category taxonomy is `item_type`, not legacy's item category

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stock Valuation)
- **Severity:** P2 (money page; blocks ~40% of legacy's chrome)
- **Status:** [ ] open — **needs a user/data-model decision, not a UI fix**

Legacy buckets stock by `item.category`, a six-value business taxonomy hard-coded at L20942:
`Raw Material | Component | Finished Goods | Bought Out | Consumable | Other`.

Our `category` is `items.item_type` (`service.ts:56`, `i.item_type::text AS category`), whose enum is
**`['component','assembly']`** (`packages/shared/src/enums/item-type.ts:1`). There is no `category`
column on `items` at all.

**Three pieces of legacy chrome are therefore NOT ported — deliberately:**

1. **The five fixed summary cards (L20988-20994)** — TOTAL / RAW MATERIAL / FINISHED-COMPONENT /
   BOUGHT OUT / CONSUMABLE. Hard-coding these against our data renders **₹0 on four of five tiles**
   while the real money hides in categories with no tile. Shipping ₹0 stock-value tiles to 15-20
   live users is worse than the current dynamic grid. Kept: 1 total card + N per-category cards.
   The TOTAL card is already an exact legacy match.
2. **The VALUE DISTRIBUTION bar (L20997-21015)** — same keys, so `rmPct/fgPct/bopPct` all compute 0
   and `conPct = 100-0-0-0 = 100`, i.e. **a full amber bar reading "Other 100%" regardless of the
   actual mix.** It also needs `rmVal/grandTotal` money math in the browser (CLAUDE.md §6 rule 1) and
   `fgVal = FinishedGoods.value + Component.value`, a money aggregate the payload doesn't carry.
   Per the ISSUE-028 precedent this belongs in SQL, not in `useMemo`.
3. **The seven fixed filter buttons (L20972)** — hard-coding legacy's keys yields seven `(0)` buttons
   and makes every real item unreachable. Kept: buttons derived from `data.categories`.

**Fix path (server-side, one task):** decide whether `items` gains a real `category` column matching
legacy's taxonomy (migration + backfill from the Firebase export, where `it.category` exists), or
whether this page is officially re-specced around `item_type`. Until then the three sections above
stay un-ported. **Do not paper over it in the frontend.**

## ISSUE-047 — App-wide: `<th className="td-ctr">` is inert — AND SO IS LEGACY'S. Do not "fix" it.

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stock Valuation)
- **Severity:** P4 — **downgraded from P3. This is NOT a defect: our rendering MATCHES legacy.**
- **Status:** [-] **won't-fix as a bug — dead code only. DO NOT add a `th.td-ctr` override.**

**The mechanism is real; the conclusion filed with it was wrong, and I verified before acting.**

Our `.innovic-table th` sets `text-align: left` at specificity **(0,1,1)**; `.td-ctr`/`.td-right` are
**(0,1,0)**, so the element-qualified rule wins regardless of source order. Every `<th className="td-ctr">`
in the app is inert — **257 of them** (not 185; the original count used a narrower pattern, the same
error that under-counted ISSUE-020 three times).

**But legacy does exactly the same thing.** Legacy's rule is `.panel table th { … text-align:left … }`
— specificity **(0,1,2)**, which *also* beats `.td-ctr` (0,1,0). Legacy writes `<th class="td-ctr">`
**36 times** and every one of those is **equally inert**. Legacy's headers render left-aligned. **So do
ours. That is parity.**

**Adding `.innovic-table th.td-ctr{text-align:center}` would re-align 257 headers AWAY from legacy** —
it would manufacture a divergence, not fix one. The originally-filed "fix option (a)" is actively harmful.
Do not do it.

**Where legacy really does align a header, it uses an inline style**, which outranks everything:
Stock Valuation L21032 is `<th style="text-align:right">Stock Qty</th>`. That page now mirrors that
inline style exactly — correct, and the only case in this family that needed a change.

**Disposition:** the class on a `<th>` is harmless dead code in both systems. Don't write it on new
`<th>`s (it means nothing), don't strip it from existing ones for its own sake, and **never** add the
override. If a specific header must align, check legacy: if legacy uses an inline style there, mirror it.

**This is the third time this session that "legacy references X" was mistaken for "legacy behaves as X":**
`.stat-card.blue` (legacy never defines it — I wrongly added a rule and reverted it), `.b-running`
(defined only in legacy's print block, so unstyled in its app), and now `th.td-ctr` (defined, referenced,
and out-specified in both systems). **Method, every time: find the definition, check which `<style>` block
it lives in, and compare specificity against the rules that also match.** See ISSUE-027.

## ISSUE-048 — Stock Valuation: valuation formula diverges from legacy in three ways

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stock Valuation)
- **Severity:** P2 (**changes the ₹ figure**, not the pixels)
- **Status:** [ ] open — **REPORTED, not "fixed" on either side, per the money-page rule**

Legacy rate resolution (L20931-20951): `rate = lastGRNRate[code] || firstPORate[code] || item.rate || 0`.
Ours (`service.ts:36-58`): `rate = COALESCE(lastGrnPoLineRate, latestPoLineRate, 0)`.

1. **Missing third fallback — the item master's own rate.** Legacy falls back to `n(it.rate)` (L20950).
   Our `items` table **has no rate column**, so an item with stock but no GRN and no PO is valued at
   **₹0 / "No Rate"** by us and at `qty × item.rate` by legacy. Understates `grandTotal`.
2. **GRN rate source.** Legacy reads the GRN's own `g.rate` (L20934). Our `goods_receipt_note_lines`
   has **no `rate` column** (`schema.ts:1560-1590`), so we join out to `purchase_order_lines.rate` via
   `purchase_order_line_id` — which is **nullable** (`onDelete: 'set null'`). A direct/PO-less receipt
   therefore contributes **no rate at all** in our port.
3. **PO fallback picks a different PO.** Legacy iterates `db.purchaseOrders` **unsorted** and the
   `!lastRates[...]` guard makes the **first-encountered** PO rate win (L20937-20939). We take the
   **latest by `po_date`** (`ORDER BY pol.item_id, po.po_date DESC`). Ours is the more defensible rule;
   it is still a different number.

(1) and (2) need schema decisions; (3) is a one-line service change. **All three are backend and all
three move money — none touched in a UI pass.**

## ISSUE-049 — Stock Valuation: `Location` column has no source; export deltas

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stock Valuation)
- **Severity:** P3
- **Status:** [ ] open

1. **Legacy's 9th column, `Location` (L21032, L21049), is not ported and cannot be UI-only.** There is
   **no `location` column on `items`** (`schema.ts:205-228`) and the payload has no field for it
   (`stockValuationRowSchema`). Needs a migration + service change. Our table stays at 8 columns; the
   TOTAL row's trailing cell is `<td/>` (1) not legacy's `colspan="2"` accordingly.
2. **Export (`lib/export.ts`) is missing the same `Location` column** (legacy `_svExportExcel` L21080)
   for the same reason, and the **filename differs**: legacy `InnovicERP_StockValuation_YYYYMMDD.xlsx`
   vs ours `stock-valuation-YYYY-MM-DD.xlsx`. Both sheets ("Stock Detail", "Category Summary"), the
   `stockQty > 0` filter, and all other columns already match. Not touched — the export builder is
   logic, not JSX, and it emits a money document.

---

## ISSUE-050 — Incoming QC: pending queue is sorted oldest-first; legacy sorts newest-first

- **Surfaced:** 2026-07-15 (REFACTOR-1, Incoming QC)
- **Severity:** P3 (row order only — no figure changes)
- **Status:** [ ] open — **REPORTED, not fixed: the ORDER BY is in the service, not the JSX**

Legacy sorts the pending queue **newest GRN first** (`renderIncomingQC`, HTML L23754:
`(b.grnDate||'').localeCompare(a.grnDate||'')`) and then reads the **last** element as the oldest for
the `Oldest GRN` tile (L23820: `pendingGrns[pendingGrns.length-1]`).

Our service orders `h.grn_date ASC` (`apps/api/src/modules/incoming-qc/service.ts:54`) and reads
`pending[0]` as the oldest (`service.ts:147`). **The `Oldest GRN` tile is therefore correct in both** —
the two implementations agree on the value and disagree only on the display order of the queue.

Operationally ours is arguably the better default (oldest-waiting at the top of an inspection queue),
which is why it is flagged rather than flipped: it is a one-line `ASC → DESC` in the service, but that
is business logic and it would also require inverting the `oldest` index in the same commit. Needs a
user call on which order the QC desk wants.

---

## ISSUE-051 — Incoming QC: vendor cell drops legacy's `[CODE]` suffix (payload has no vendorCode)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Incoming QC)
- **Severity:** P4
- **Status:** [ ] open

Legacy renders both vendor tds via `vndLabel(g.vendorCode, g.vendorName)` (HTML L23770, L23797), which
emits `Name <span style="color:var(--text3);font-size:10px">[CODE]</span>` whenever name and code both
exist and differ (helper at L1492-1499).

Our payload carries only `vendorName` (`COALESCE(v.name, h.vendor_code_text)`,
`service.ts:38`/`:83`); `incomingQcPendingRowSchema` / `incomingQcCompletedRowSchema` have no
`vendorCode` field. The `[CODE]` suffix cannot be rendered without a schema + service change, so the
cell ships as bare `{vendorName ?? '—'}`. The `'—'` fallback already matches `vndLabel`'s own.

Same shape as the other `vndLabel` gaps — worth one sweep across every ported vendor column rather
than a per-page fix.

---

## ISSUE-052 — Incoming QC: `QcReportLink` renders a bare button; legacy's report cell is a `btn btn-ghost btn-sm`

- **Surfaced:** 2026-07-15 (REFACTOR-1, Incoming QC)
- **Severity:** P4 (shared component — ISSUE-025 class)
- **Status:** [ ] open

Legacy's completed-row Report cell (HTML L23806) is
`<button class="btn btn-ghost btn-sm" style="font-size:10px">📄 Report</button>`.

`QcReportLink` (`apps/web/src/components/shared/qc-report-attach.tsx:133-153`) renders an unclassed
button with `background:none;border:none;padding:0`, cyan text at `fontSize:11` — i.e. a text link, not
a ghost button. This pass passed `label="Report"` so the **text** now matches legacy exactly; the
button chrome does not. Not changed: the component is shared with every other QC submit form and
completed table, so restyling it here would silently restyle those (ISSUE-025 rule).

Also note the **doc comment is stale**: it says the label "defaults to the file name, else `📄 Report`",
but the code is `📄 {label ?? '⬇'}` — there is no file-name default and the fallback glyph is `⬇`.

## ISSUE-053 — QC Dashboard: rejection-reason percentages are computed over a `LIMIT 8` subset

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Dashboard / legacy `renderQCEngineerDash`)
- **Severity:** P2 — the numbers are wrong whenever there are >8 distinct reject reasons
- **Status:** [ ] open — backend

`qc-dashboard/service.ts:310` computes `reasonTotal` by summing the rows it already truncated to `LIMIT 8`. Legacy (L4065) divides each reason's count by the total across **all** reasons.

**Effect:** with more than 8 distinct reason categories, every displayed percentage is inflated, and the top-8 percentages sum to exactly 100% — asserting that the eight shown reasons account for all rejections when they don't. It looks self-consistent, which is why it reads as correct.

**Fix:** compute the denominator over the unlimited set (a second aggregate, or a window function), then take the top 8 for display.

**Fixed on the page in the same pass (browser math → server figures):** the TOTAL row was summing `engineerPerf.reduce(...)` **client-side** while `summary.monthAccepted` / `summary.monthRejected` sat **unused on the payload** (schema L33-34). Now reads the server's values. This is the 8th page where a field already on the payload was never surfaced.

**Also reported, not changed:**
- **Pending list is `LIMIT 200`** (`service.ts:198`) while the PENDING CALLS tile counts all — diverges only past 200 rows. Legacy is unbounded.
- **`0%` vs `—` on TODAY/MONTH RATE.** Legacy coerces empty → `0%` (L3984). Our API sends `null` (schema L31) meaning *nothing was inspected*. Rendering `0%` would assert a zero-percent pass rate that was never measured — a false statement about quality data. Kept `—`; coercing is a logic change, not chrome. **Confirm which you want.**
- **A legacy bug deliberately not copied:** `"—d"` (L4019) — legacy always concatenates `d`, so it prints `—d` when there's no measurable response time. Legacy's *colour* rule (null → amber) was copied faithfully.

**Correct nuance worth keeping:** this page hand-rolls `.panel` tiles rather than using `.stat-card` — and so does legacy (L4087-4093). `.stat-grid` is `repeat(4,1fr)`; forcing it here would break legacy's 7-tile `auto-fit` row, which legacy's own mobile rule (L299) explicitly targets. Not every tile strip is a `stat-card` strip.

## ISSUE-054 — Inline `text-align` on `<th>` IS a real divergence (unlike the inert class)

- **Surfaced:** 2026-07-15 (REFACTOR-1 — found independently by Incoming QC, QC History and QC Dashboard)
- **Severity:** P4 (fixed on the three pages that had it; recorded so the distinction isn't lost)
- **Status:** [x] fixed on `/incoming-qc`, `/qc-history`, `/qc-dashboard`

**The distinction that matters, and it cuts both ways:**

- `<th className="td-ctr">` → **inert in BOTH systems** (`.innovic-table th` (0,1,1) and legacy's `.panel table th` (0,1,2) both out-specify `.td-ctr` (0,1,0)). **Matches legacy. Leave it. See ISSUE-047.**
- `<th style={{textAlign:'center'}}>` → **inline styles beat everything**, so this **DOES** apply. Where the port added inline centring and legacy left-aligns, that is a **real divergence** and must be removed.

Three agents hit this independently and all three reached the same conclusion: strip the **inline** styles, keep the inert **classes**. 7 inline styles removed from QC History, 7 from QC Dashboard, several from Incoming QC.

**The inverse also holds:** where legacy itself uses an inline `text-align` (Stock Valuation L21032 `<th style="text-align:right">`), that DOES apply in legacy, and the port must mirror the inline style — the class would do nothing.

**Rule:** on a `<th>`, ignore the class, match the inline style.

## ISSUE-055 — TPI: the inspecting organization is never audited (compliance gap)

- **Surfaced:** 2026-07-15 (REFACTOR-1, TPI)
- **Severity:** **P2** — on a third-party-inspection record, "who certified this" is the point
- **Status:** [ ] open — backend

Legacy `_tpiSubmit` (L21565) stamps the audit trail with the org: `logActivity('TPI', …, accept+' acc, '+reject+' rej by '+inspector+' ('+org+')')`. Ours (`apps/api/src/modules/op-entry/service.ts:589-592`) emits `action:'OP_QC'` with detail `"…accepted, …rejected by <name>"`.

Two consequences: a **TPI is indistinguishable from in-house QC** in the activity log (same action code), and **the certifying third-party organization is never recorded at all**.

**Fix:** distinct `action:'TPI'` + include the org in the detail, mirroring L21565.

**Verified clean on the same page (worth recording):** the submit endpoint IS a faithful port — `submitQcLog` was traced against legacy `_tpiSubmit` line by line: call-date backfill, attended date, TPI metadata, auto-NC on reject, last-op stock cascade, SO auto-close — all six match. **No ISSUE-026 refusal was needed** — the agent verified rather than assuming, and got to wire the form. Completed TPI records are read-only in both systems (append-only `op_log`), so there is no CAPA-style silent-edit path (ISSUE-039).

**Also:** `QcReportAttach` hardcodes "Attach QC Report (optional)" where legacy says "Attach **TPI** Report" (L21410). Shared across QC modules — reported, not changed (ISSUE-025, same component as ISSUE-052).

## ISSUE-056 — QC Call Register: COMPLETE tile counted a capped array, and counts the wrong thing

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Call Register)
- **Severity:** P2
- **Status:** [~] browser-math half **fixed**; semantic half [ ] open (needs a server field)

**Fixed — the tile silently froze at 500.** `completeCount` was bound to `data.logs.length`, but `qc-call-register/service.ts:98` caps logs at `LIMIT 500`, while `stats.totalEntries` — a real `COUNT(*)` at `service.ts:124` — **sat unused on the payload**. Past 500 entries the number simply stopped moving. Now bound to `stats.totalEntries`. That makes **9 pages** where a server-owned figure was recomputed or truncated client-side while the correct value was already on the payload.

**Still open — it counts the wrong thing.** Legacy's COMPLETE tile is `completeQC.length` = QC-required **ops whose status is Complete** (L4130), not a count of QC log entries. Our payload carries no such figure. Deliberately not computed client-side.

**Two more, reported not changed:** legacy's blink condition is `qcCallDate && waitingDays > 1` (L4148) where ours uses the server's `overdue` (`pendSince < today`); and legacy back-fills a null `qcCallDate` from the last non-QC op log **and mutates `theOp.qcCallDate` during render** (L4141-45), which our server does not do.

**My advance intel for this page was WRONG and the agent caught it.** I briefed it that `clientPoLineNo` / `qcCallDate` / `logNo` were unsurfaced and the L4163 inline QC entry form unported. **All were already present**; only the form's L4167 header was missing. The agent verified instead of trusting the brief — which is why the 8-for-8 streak broke honestly rather than by confirmation bias. **Lesson: intel derived from schema comments is a hypothesis, not a finding.**

## ISSUE-057 — Topbar TITLE_MAP mangles every acronym route (fixed)

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Call Register)
- **Severity:** P3
- **Status:** [x] fixed 2026-07-15

`deriveTitle` (`components/shared/topbar.tsx:50`) falls back to humanizing the slug per-word, so any route absent from `TITLE_MAP` rendered **"Qc Call Register"**, **"Capa"**, **"Tpi"**, **"Incoming Qc"**, **"Qc History"**.

It became urgent because the QC Call Register refactor **correctly removed that page's `.section-hdr`** — legacy renders no in-content title there (L4221; the title comes from the topbar) — leaving the mangled string as the page's **only** title. A correct parity change exposed a latent defect: same shape as the Daily Report tip (ISSUE-017).

**Fixed** by adding 8 keys using **legacy's own nav labels** (not invented): `/qc-call-register`, `/qc-command`, `/qc-history`, `/qc-processes`, `/qc-docs`, `/incoming-qc`, `/capa`, `/tpi`. Additive keys only — no existing route's title can change.

**Not exhaustive:** any future acronym route needs a key or it gets mangled. A more robust fix is an acronym-aware humanizer; the explicit map is what the file already does.

## ISSUE-058 — QC Command Center: legacy hardcodes a purple that differs from its own token

- **Surfaced:** 2026-07-15 (REFACTOR-1, QC Command Center)
- **Severity:** P4
- **Status:** [x] matched legacy locally; **other pages may carry the drift**

**Legacy is internally inconsistent.** Both stylesheets define `--purple: #7c3aed`, but legacy *hardcodes* `#8B5CF6` — a different violet — on the QC/FPY/Rework tiles (L18636). Our port used `var(--purple)`: legacy's token rather than legacy's actual pixels.

Matched legacy's literal value on this page. **Worth a sweep:** other ported pages reaching for `var(--purple)` where legacy hardcodes `#8B5CF6` carry the same drift. Decide once — follow legacy's pixels, or normalise to the token and accept a known delta.

**Also on this page:**
- **`Avg Hrs/Inspection` column missing** (InspectorTab; legacy L18897/18910 renders it from `hoursWorked`). Our `op_log` has no hours column and the figure is not on the payload — **not computed, not faked** (CLAUDE.md rule 1). Needs a backend field. The Inspector tip correctly omits legacy's "requires operators to enter hours on mobile" line, since the column does not exist here (trap 1).
- **Legacy's `3th` typo (L18704) deliberately NOT reproduced.** The skill says reproduce legacy typos and flag them; the agent kept `3rd` and reported instead. Shipping a visible typo to a live system is a quality regression for zero parity gain — but it does deviate from the stated rule. **Your call.**
- **Pareto is CLEAN here** — the server aggregates every NC; `pct`/`totalCount`/`totalQty` are all server-computed. ISSUE-053's inflated `LIMIT 8` denominator is specific to `/qc-dashboard`, not a shared bug.
- **Two more local `fmt()` helpers** (`QueueTab.tsx:16`, `ReworkTab.tsx:6`) with no IST formatting — the ISSUE-040 drift is now at **four copies**.

## ISSUE-059 — App-wide: our `.innovic-table td` declares different values than legacy's `.panel table td`

- **Surfaced:** 2026-07-15 (REFACTOR-1, Design Tracker — reported with wrong reasoning; corrected here after verification)
- **Severity:** P3 — every table cell in the app is 1px larger and 2px more padded than legacy
- **Status:** [ ] open — **app-wide visual change; ISSUE-025 class, needs a user decision. Do NOT fix per-page.**

### The actual finding

| Declaration | Legacy `.panel table td` (0,1,2) | Ours `.innovic-table td` (0,1,1) |
| --- | --- | --- |
| `font-size` | **12px** | **13px** (`var(--fs-control)`, `tokens.css:142`) |
| `padding` | **7px 10px** | **9px 12px** |

Utility classes are identical in both systems (`.td-code{font-family:mono;font-weight:600;font-size:12px}` legacy L115 = ours L393; `.empty-state{text-align:center;padding:40px;color:var(--text3)}` legacy L269 = ours L776). **The theme's base `td` rule is the only divergence** — and everything downstream follows from it.

### Correcting the reported reasoning — there is NO specificity inversion

The Design Tracker agent reported that "our `.innovic-table td` (0,1,1) outranks bare util classes (0,1,0); **legacy's bare `td` (0,0,1) loses to them**". **That is wrong.** Legacy's rule is not a bare `td` — it is **`.panel table td`, specificity (0,1,2)**, which is *higher* than ours. **Both** systems' `td` rules out-specify utility classes. The behaviour is structurally identical; only the declared values differ.

This is the same error I made with `.stat-card.blue` and nearly made with `th.td-ctr`: **a specificity claim asserted without reading the actual selector.** Always print the full selector before reasoning about the cascade.

### What actually renders

- **`<td class="empty-state">`** — the `40px` padding applies in **NEITHER** system: legacy's td rule (0,1,2) and ours (0,1,1) both beat `.empty-state` (0,1,0). Legacy renders `7px 10px`; we render `9px 12px`. The agent's "instead of legacy's 40px" is incorrect — legacy never gets 40px there either. `.empty-state`'s 40px only applies when the class is on a `<div>`, which some pages do.
- **`<td class="td-code">`** → legacy `12px` (its td rule declares 12px, same as `.td-code`'s own — no visible effect). Ours → **`13px`** (our td rule declares 13px, swallowing `.td-code`'s 12px). `font-family:mono` and `font-weight:600` still apply in both (neither td rule declares them).
- **`<span class="td-code">` inside a td** → **`12px` in ours**, because no rule targets the span. **This accidentally matches legacy's rendering.**

### The consequence for this track

Several pages moved `td-code` from an inner `<span>` onto the `<td>` "for structural fidelity" (machines, JWO, incoming-qc, customer-dispatches, and others; `bom-master` already did). **Structurally that matches legacy. Visually it goes 12px → 13px, i.e. away from legacy.** The "unfaithful" span placement rendered the faithful size by accident.

**This is NOT worth un-picking per page.** The root cause is one declaration. If `.innovic-table td` used `font-size:12px`, both placements would render 12px and the whole question dissolves.

### Options (pick one, app-wide)

1. **Set `.innovic-table td { font-size: 12px; padding: 7px 10px }`** to match legacy exactly. One rule; makes every table match legacy and makes the span-vs-td question moot. **But it visibly shrinks every table on a live system** — needs your call.
2. **Leave it.** Accept that our tables run 1px larger / 2px more padded than legacy by deliberate token choice (`--fs-control`), and stop treating `td-code` placement as a fidelity question.

**Do not** add `.innovic-table td.td-code{font-size:12px}` — that patches one symptom of a base-rule divergence and leaves the other cells inconsistent.

## ISSUE-060 — Design module: findings from the first three pages

- **Surfaced:** 2026-07-15 (REFACTOR-1, Design Issues / Design Projects / Design Tracker)
- **Severity:** P3 mixed
- **Status:** [ ] open

**Design Issues**
- **Severity "Major" rendered amber; legacy `_dpBadge` (L7557) uses `--orange`.** Real colour drift on a severity indicator — fixed. (`--purple` was correct here; no ISSUE-058 hardcode.)
- **`_dpViewIssue` modal never ported.** Legacy makes the row clickable → modal with project/severity/status/assignee/raised+age/resolved/description/**discussion thread + Post box**. The payload already carries `partText`, `resolvedDate`, `description`, `discussions`, `raisedByText` — **five server-surfaced fields the UI never renders** (10th page with this pattern). Not built: the Post box needs a comments write endpoint that doesn't exist, and a read-only half would advertise a thread you can't reply to.
- **Legacy's `<td style="max-width:220px">` (L7912) deliberately NOT copied.** Our `.innovic-table td` sets `white-space:nowrap` app-wide, so `max-width` would make long titles **overflow into the next column** instead of wrapping as legacy does. **Copying legacy verbatim would introduce a defect legacy does not have.** Needs a theme decision, not a page hack.
- **`AssignTaskButton` renders `👤+ Assign`; legacy renders a bare `👤+`** (verified on SO L11875, JC L5771). Shared across **12 call sites** → reported, not changed (ISSUE-025).

**Design Projects**
- **Status was a readonly text label** reading "Design Active"; legacy has a working `<select>` (L7759). **Traced before wiring** — `createDesignProjectInputSchema.status` accepts the enum (`design-project.ts:242`) and `createDesignProject` persists it (`service.ts:489`). Backend was ready; only the control was missing. Wired.
- **Design Lead ★ deliberately NOT added.** Legacy marks it required (L7758), but our schema has `leadText: optional` — a star would **advertise a constraint nothing enforces**. Trap 1 applied to form validation. Same for the engineer picker (legacy `<select>` over `_dpGetEngineers()` L7539) and the Engineers checkbox chips (L7752/7762) — both need a users source.
- **Project No. preview absent** (legacy L7754 shows a readonly `DP-NNNN` from `_dpNextProjectNo()`). Ours is server-generated at insert (`service.ts:476`) — the client cannot know it, and computing it would violate CLAUDE.md rule 1. Needs `GET /design-projects/next-code`. **Not fabricated.**
- **SO picker is a typeahead capped at 50**; legacy is a full `<select>` of all non-Cancelled SOs (L7750). Kept the typeahead — converting would silently truncate the SO list.
- **ISSUE-043 pattern, 4th module:** `design-projects/service.ts:156-161` counts with only `companyId` + `deletedAt` while rows apply search + filter. **Latent** — the page has no pagination and never reads `total`.

**Design Tracker**
- **Rows silently truncate at 100.** `PAGE_SIZE=100`, `offset` hard-wired to 0, no pagination UI, no "showing X of Y". Legacy renders every design. Past ~100 rows they vanish with no indication. **This is the live half of the same service's ISSUE-043 count bug.**
- **SO picker allows duplicate designs.** Legacy (L7346-7353) groups Equipment SOs vs Other **and excludes SOs that already have a design**; ours type-aheads all open SOs with no exclusion — a user can assign a second design to the same SO. Needs API support.
- **Legacy's dead `Date` field (L7358) not ported** — legacy renders it but its own save handler (L7378-7383) never reads it, and it's absent from `createDesignTrackerInputSchema`. Porting it would add an input that writes nowhere.
- **Footer tip kept, and it is honest-by-parity:** it claims BOM creation is blocked until approval. Legacy's gate `_dsnIsApproved` (L7484) is **defined but never called anywhere in the legacy file**, and `bom-master/service.ts` has no design check either. The claim is aspirational in **both** systems — so the port is not worse, and removing the text would be inventing. **Flagging because the aspiration is presumably meant to be real.**
- **ISSUE-058 confirmed and mirrored:** legacy L7287-7288 pairs `var(--purple)` (`#7c3aed`) text with an `rgba(139,92,246,.1)` (`#8B5CF6`) background on the Revision status. The port copies both verbatim — correct.

## ISSUE-061 — **APP-WIDE:** every table header looks clickable; legacy's only look clickable when they sort

- **Surfaced:** 2026-07-15 (REFACTOR-1, Op Log)
- **Severity:** P3 — an affordance lie on every table in the app
- **Status:** [ ] open — **theme change, app-wide; ISSUE-025 class, needs a user decision**

Our `.innovic-table th` (`innovic-theme.css:359-379`) declares:
```css
cursor: pointer;
user-select: none;
```
plus an `.innovic-table th:hover` colour rule.

**Legacy's `.panel table th` (L347) declares neither, and legacy has no `table th:hover` rule anywhere.** Legacy adds the pointer *inline*, only on headers that `sTh()` makes sortable.

**Effect:** every header in our app shows a pointer cursor and highlights on hover — inviting a click — whether or not anything happens. On the many ported pages with no sorting at all, users hover, see it light up, click, and get nothing.

**This compounds ISSUE-016.** Where sorting *does* exist on clients/items/vendors, the arrows render and the URL changes but the rows never reorder (`toQueryString` drops the params). So the app currently has two overlapping lies: headers that look clickable but aren't, and headers that are clickable but don't work.

**Fix:** move `cursor:pointer` + `user-select:none` + the `:hover` rule off the base `th` and onto whatever marks a sortable header (`SortTh` / `SortableHead` already exist as components). That is the legacy behaviour, and it makes the affordance honest. **App-wide interaction change — your call.**

**Also on the Op Log page:**
- **Shift rendered as a coloured `badge`; legacy renders plain text** (L13202) — `renderOpLog` has **zero** badges. Port-invented drift, fixed.
- **`badge b-purple` is inert (2 uses).** `.b-purple` is defined in **neither** legacy nor our theme (only the `--purple` token). Renders as an uncoloured pill. Not fixed: the Type/TPI columns don't exist in legacy, so there is no legacy colour to match and picking one is a design call. (Same missing class as ISSUE-034.)
- **`fmtDate` (L39) is a 4th ISSUE-040 copy AND diverges further:** `year:'numeric'` → "15 Jul 2026" vs legacy's `year:'2-digit'` → "15 Jul 26"; legacy also guards falsy → `'—'` where ours yields **"Invalid Date"**. Deliberately not changed — editing one of four copies makes them *more* divergent. Fix once, app-wide.
- **Payload fields fetched and discarded:** `itemCode`, `qcReportPath`, `qcReportName`, `createdAt` cross the wire (`api.ts:10,20-22`) and are never rendered. `qcReportPath`/`Name` is a QC report attachment — plausibly valuable. Legacy shows none of them, so surfacing them would be inventing. **11th page with unsurfaced payload fields.**
- **`operatorId` filter supported end-to-end** (`api.ts:31`, schema:10, service:36) with **no UI control**. Legacy has no filter bar at all.
- **`Del` correctly NOT wired.** Legacy `delLog` (L13224-27) **hard-deletes** (`db.opLog = db.opLog.filter(...)`) — violating CLAUDE.md Rule 8 — and every downstream qty-done figure is a `SUM` over `op_log`. No endpoint exists. Verified rather than assumed: unlike TPI, there was no partial endpoint to trace.
- **ISSUE-043 verified NOT broken here** — rows and count share the same `where` object (service:41,74,83). The rows query adds an `innerJoin` on `items` the count omits, but `jobCards.itemId` is `.notNull()` (schema:708-710), so it cannot drop rows. **Counts are consistent.** Good example of checking rather than pattern-matching.
- **⚠️ Judgment call for you:** the port had a subtitle explaining the page is a read-only audit trail. It was **removed for fidelity** (legacy has none) — but it was the only user-facing explanation of **why `Del` is absent when legacy users had it.** Removing it is faithful; it also removes the answer to a question migrating users will ask. Say the word and it comes back.

## ISSUE-062 — Design Work Log: the Alerts tab cannot see the engineers it exists to find

- **Surfaced:** 2026-07-15 (REFACTOR-1, Design Work Log)
- **Severity:** **P2** — a feature that is structurally incapable of its own purpose
- **Status:** [ ] open — **blocked on an auth/roster gap; verified, not assumed**

**The Alerts tab flags engineers who have NOT logged hours. Our port derives its engineer list FROM THE LOGS THAT EXIST.** An engineer who logged nothing is therefore invisible and produces **zero** "Unlogged Days" rows. The tab can only see the people it is not looking for.

**Root cause (verified):** legacy's `_dpGetEngineers()` (L7539-44) returns **all users' names** from its in-memory `db`. Our only roster source is `GET /users`, which is **`requireAdminRole`** (`apps/api/src/modules/users/service.ts:37`) — it would **403 for every engineer and manager**, i.e. exactly the people who use this page. So the roster was never wired, and the port fell back to deriving names from work-log rows.

**Same root cause also kills:** the daily `⚠ No log:` banner (L8000), zero-hour red cards (L7997), and weekly rows for non-loggers (L8016). And an edge case: selecting an engineer then paging to a date they didn't log makes their `<option>` vanish from the select (legacy's roster is static).

**Fix:** put an engineer roster on the work-log payload, or add a non-admin roster endpoint. **Not wired** — a roster that 403s for its own users is worse than none.

**Also fixed on this page — a real defect:** the project dropdown passed `filter:'active'`, which resolves to `status = 'Design Active'` **only** (`design-projects/service.ts:102`). Legacy offers everything `status !== 'Released'` (L7954) — **Design Active + In Review + On Hold**. Engineers could not log time against In Review or On Hold projects at all.

**Also reported:**
- **`engineerText` is stored as an EMAIL** (`service.ts:135`: `user.email ?? user.id`); legacy stores the user's **name** (L7990). Every one of the 5 tabs shows email addresses where legacy showed names. Internally consistent, so nothing breaks — but it is visible everywhere.
- **Project Hours tab aggregates a client-capped array** — `useDesignWorkLogList({limit:2000})` then sums per project. Past 2000 rows the Grand Total silently goes wrong. Same shape in Weekly/Alerts (2000) and Daily (500), all truncating with no indication. The QC-Call-Register-froze-at-500 pattern; belongs in the service.
- **ISSUE-043, 5th module:** `design-work-log/service.ts:83-88` counts with only `companyId` + `deletedAt`, ignoring engineer/fromDate/toDate/designProjectId which the rows query applies. Latent — no tab renders `total`.
- **Weekly header:** legacy L8014 does `fmt(dt).replace(/\d{4}/,'')` to strip a year that `fmt` (L1484, `year:'2-digit'`) never emits — a legacy no-op, so legacy shows the full `15-Jul-26`. Ours shows `07-15`. Part of ISSUE-040.
- **Task field is now a `<select>` of the project's tasks** (legacy L7960) instead of free text. `useDesignProjectDetail` is auth-safe (`requireCompany` only). **The one change to revert if anyone relies on ad-hoc task text.**

## ISSUE-063 — Legacy's `var(--token)12` background bug — reproduced faithfully in two places, invented around in a third

- **Surfaced:** 2026-07-15 (REFACTOR-1 — found independently by Design Projects Detail and Design Work Log)
- **Severity:** P4 (documentation of a legacy bug + one port invention removed)
- **Status:** [x] resolved — both pages now match legacy's actual rendering

**Legacy writes `background:'+c+'12'`, producing `background: var(--blue)12`** — a token concatenated with digits, which is **invalid at computed-value time** and dropped by every browser. So **legacy's category chips and `_dpBadge` badges have no background at all.** It looks like an attempt at a 12/255 alpha hex suffix that only works on literal hex values, not tokens.

Two agents found this independently:
- **Design Projects Detail** — the port's `` `${color}12` `` template emits the **identical invalid string**, so it already matched legacy by accident. Left untouched.
- **Design Work Log** — the port had **invented a hardcoded `rgba(37,99,235,.10)` blue tint** to fill the gap, which rendered **blue on a purple "Review" chip**. Removed to match legacy's actual output.

**Flagging:** if you'd rather have a real per-category tint than legacy's accidental transparency, that's a deliberate improvement — say so and it's a small change. Right now both pages render what legacy renders.

## ISSUE-064 — Design Projects cannot be edited: a complete write path with zero call sites

- **Surfaced:** 2026-07-15 (REFACTOR-1, Design Projects Detail)
- **Severity:** P2 — a CRUD verb is simply missing from the app
- **Status:** [ ] open — needs the edit modal

Legacy `_dpRenderDetail` has an **✏ Edit** button (L7634) opening `_dpEditProject` (L7773). Our port has **no way to edit a design project** — yet the entire write path exists and is tested:

- `useUpdateDesignProject` — `design-projects/api.ts:83`
- `PATCH /design-projects/:id` — `routes.ts:46`
- `updateDesignProjectInputSchema` — covers **every field** legacy's edit modal touches

**Zero call sites repo-wide.** The agent correctly did not add a button without its modal (worse than neither).

**Also on the detail page:**
- **DCN table missing 4 legacy columns** — BOM Impact, Parts, Implemented By, Approved By (L8123-27). `designDcnSchema` has none of them. Backend-blocked, not faked.
- **DCR/DCN sort order inverted** — legacy sorts `createdAt` **DESC** (L8068-69); `service.ts:331,344` orders **ASC**. Server-owned; not compensated client-side.
- **Answered an open question from Design Issues:** the 5 "unused" payload fields (`partText`, `resolvedDate`, `description`, `discussions`, `raisedByText`) **are all consumed here** — in the issues table and view modal. **Not an unsurfaced-fields defect**; a list page correctly not showing detail-page data. (ISSUE-060's Design Issues entry should be read with this correction.)
- **A legacy bug NOT copied:** legacy computes `stColor`/`priColor` for DCR/DCN (L8098-99) and then **never uses them**, so every DCR/DCN badge renders grey. The port colours them. Kept per "never delete a working feature" — legacy's greyness is an oversight, not intent.

## ISSUE-065 — 🔴 **P1: night-shift records are silently misdated by one day (UTC vs IST)**

- **Surfaced:** 2026-07-15 (REFACTOR-1, Op Entry)
- **Severity:** **P1 — silent data corruption on live production records**
- **Status:** [ ] OPEN — **not fixed** (logic + 53 files; outside a UI-only pass). **Escalated to the user 2026-07-15.**

### The defect

`op-entry/components/op-entry-form.tsx:33-36`:
```ts
function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);   // ← UTC date
}
```
Legacy `today()` (L1485-1488) builds the **local** date from `getFullYear()/getMonth()/getDate()`.

**IST is UTC+5:30, so between 00:00 and 05:30 IST `toISOString()` returns YESTERDAY.** Proven:

```
Instant (IST) : 16/7/2026, 2:00:00 am
toISOString() : 2026-07-15   <-- what the form defaults to
IST date      : 2026-07-16   <-- correct
MISDATED BY   : ONE DAY
```

`todayIso()` seeds `logDate` (`op-entry-form.tsx:53`), which feeds the **submit payload**. **Every production log entered on the night shift between midnight and 05:30 IST is dated to the previous day** unless the operator notices and corrects the date field.

**Violates CLAUDE.md §6 rule 5** verbatim: *"All times stored as `timestamptz` in UTC, **displayed in IST**. Use `date-fns-tz` on the frontend with `Asia/Kolkata`."* **`date-fns-tz@^3.2.0` is already a dependency** (`apps/web/package.json:28`) and is not used here.

### ⚠️⚠️⚠️ MECHANISM 4 (batch 25) — **displaying a stored `timestamptz`. I told agents this one was SAFE. It is not.**

**My guidance was wrong and an agent caught it.** I briefed, repeatedly: *"`someDbDate.toISOString()` (formatting a stored value) is NOT the bug; `new Date().toISOString()` (computing today) IS."*

**That is true only for `date` columns**, where node-pg returns a Date at UTC midnight. **It is false for `timestamptz`** — `toISOString()` yields the **UTC date of the instant**, which is **yesterday** for anything touched between 00:00 and 05:30 IST. Proven:

```
stored instant      : 2026-07-15T20:30:00.000Z   <- a record updated at 02:00 IST on the 16th
toISOString().slice : 2026-07-15   <- what the page renders
correct IST date    : 2026-07-16
VERDICT             : SHOWS THE PREVIOUS DAY
```

`updated_at` / `created_at` are `timestamp(..., { withTimezone: true })` (`apps/api/src/db/schema.ts:129,172`) — instants, not dates.

**Confirmed sites (4, across 3 files):**
| Site | Field |
| --- | --- |
| `route-cards/routes/detail.tsx:135` | `detail.updatedAt` |
| `route-cards/routes/detail.tsx:298` | `rev.createdAt` |
| `route-cards/routes/list.tsx:186` | `rc.updatedAt` |
| `bom-master/routes/detail.tsx:246` | `rev.createdAt` |

**So "Last updated" on a Route Card edited at 2am IST reads as the previous day.** Same visible symptom as mechanism 1, entirely different cause — nothing is *computing* today; it is **rendering a stored instant in the wrong timezone**.

**⚠️ Agents were told to skip this pattern, so the 4 sites above are a floor, not a total.** Any page that renders a `timestamptz` via `toISOString()` is affected. The distinction to apply when re-sweeping:
- **`date` column** → `toISOString().slice(0,10)` is **SAFE** (no instant, no zone).
- **`timestamptz` column** → `toISOString().slice(0,10)` is **WRONG**. Use `formatInTimeZone(v,'Asia/Kolkata','yyyy-MM-dd')` — the same shared helper mechanisms 1 and 2 need.

**This is the 7th time an agent has disproved something I asserted** (after `.stat-card.blue`, `th.td-ctr`, the alerts/`calc-engine` claim, `printJwDc` being fixed-layout, `LIMIT 1000` vs 5000, and the `ClientNewPage` title). **The pattern is consistent: I generalise from a plausible grep instead of tracing the actual type or call path.**

### ⚠️⚠️ EXPANDED (batch 18) — **there is a THIRD mechanism, in SQL, and it has the best fix**

**I briefed an agent that alerts break via `calc-engine.ts:354`. That was WRONG** — it grepped and found **no alert definition imports `calc-engine`** (zero hits), and every `toISOString()` in `definitions/*` is `someDbDate.toISOString()`, i.e. the explicitly *not-a-bug* category. It then found the real mechanism, which I had missed entirely.

**Mechanism 3 — Postgres `CURRENT_DATE` on a session that is never set to IST.**

There is **no `SET TIME ZONE` anywhere in `apps/api/src/db/`** (`client.ts`, `with-user-context.ts` — both clean). Supabase defaults the session to **UTC**, so **`CURRENT_DATE` returns the UTC date** and every SQL date predicate is a day behind between 00:00–05:30 IST. Nothing to do with JavaScript.

**23 `CURRENT_DATE` sites across the API.** Not just alerts:

| Site | Broken 00:00–05:30 IST |
| --- | --- |
| `alerts/definitions/al-001` `po_date = CURRENT_DATE` | lists **yesterday's** POs; today's invisible |
| `al-002` `pr_date <= CURRENT_DATE - '2 days'` | a day's PRs under-reported |
| `al-004` `due_date BETWEEN CURRENT_DATE AND +'7 days'` | window shifted a day early |
| `al-005`, `al-012`, `al-014` `due_date < CURRENT_DATE` | **rows due yesterday are not flagged overdue** |
| `al-007` `grn_date = CURRENT_DATE` | shows **yesterday's** GRNs |
| `al-009` `nc_date >= CURRENT_DATE - '3 days'` | same shift (**I did not predict this one**) |
| `goods-receipt-notes/service.ts:305`, `qc-history/service.ts:125` | **"today" counts** are yesterday's |
| `incoming-qc:43,135` · `qc-dashboard:157,187` · `tpi/service.ts:33` | **wait-days / overdue-calls** off by one |
| `design-issues/service.ts:69` · `reports/design-issue-aging:43` · `jc-ageing:48` · `open-po-ageing:47` | **every aging report** off by one |

**Clean (no date-relative filter):** AL-003, AL-006, AL-008, AL-011, AL-013, AL-015, AL-018.

### THE FIX IS NOT ONLY `date-fns-tz` — there are three mechanisms and three fixes

| # | Mechanism | Where | Fix |
| --- | --- | --- | --- |
| 1 | `new Date().toISOString()` in the browser — **computing today** | **47 web files** | one shared `todayIst()` (`date-fns-tz`, installed + unused) |
| 2 | `new Date().toISOString()` on the server — **computing today** | **22 API files** — incl. `calc-engine.ts:354`, and writes to `store_transactions.txn_date` | same shared helper, server-side |
| 3 | **`CURRENT_DATE` on a UTC session** | **23 SQL sites** | **one `SET TIME ZONE 'Asia/Kolkata'` in `withUserContext`** — fixes all 23 at once **and every future `CURRENT_DATE`/`::date` cast** |
| 4 | **`<timestamptz>.toISOString()` — DISPLAYING a stored instant** | **4 confirmed sites, a FLOOR not a total** (agents were told to skip this pattern) | `formatInTimeZone(v,'Asia/Kolkata','yyyy-MM-dd')` — same shared helper as 1 & 2 |

**Mechanism 3's fix is the single highest-leverage change available** — one statement in the session setup. Alternative if a global session change is judged too broad: `(now() AT TIME ZONE 'Asia/Kolkata')::date` at each of the 23 sites (23× the work, 23× the chance of missing one).

**Safety note on `SET TIME ZONE`:** it does **not** change storage — `timestamptz` is always UTC internally, so CLAUDE.md §6 rule 5's "store UTC" is unaffected. `node-postgres` parses `timestamptz` into an absolute JS `Date`, so JSON output is unaffected too. What it *does* change is SQL-side date math and `::date` casts — **which is exactly the intent**. Still, it changes behaviour for every `date` comparison in the app: **test it, don't assume it.**

**The generalisable lesson (again):** I asserted a mechanism from a plausible-looking grep and briefed it as fact. The agent checked, disproved it, and found the real cause — which was **broader** than my guess and has a **better** fix. Same failure as `.stat-card.blue` and `th.td-ctr`. **Trace the actual call path before naming a cause.**

### EXPANDED 2026-07-15 (batch 16) — **the backend has it too. 69 files, not 53.**

The original entry scoped this to `apps/web`. **It is both halves of the stack.** Precise pattern — `new Date().toISOString().slice(0,10)`, i.e. *computing today* (distinct from `someDbDate.toISOString()`, which merely formats a stored value and is usually fine):

- **47 files in `apps/web/src`** — form date defaults (below).
- **22 files in `apps/api/src`** — and these fire **with nobody logged in**, from cascades and scheduled alerts:

| Site | Consequence between 00:00–05:30 IST |
| --- | --- |
| `lib/calc-engine.ts:354` | `today` for the **entire calc engine** — every overdue/aging computation runs against **yesterday**. An SO due today reads as not-yet-due. |
| `goods-receipt-notes/cascades.ts:191` | **writes `store_transactions.txn_date`** — stock ledger entries dated to yesterday |
| `store-inventory/service.ts:192` | **writes `store_transactions.txn_date`** — same |
| `design-projects/service.ts:632,765,827,874,919,1102` | writes `releasedDate` / `raisedDate` / `resolvedDate` |
| `design-tracker/service.ts:89,601` · `capa/service.ts:22` · `invoices/service.ts:42` · `assembly/service.ts:62` · `op-entry/osp-cascade.ts:321` | date helpers + writes |
| `plans/service.ts:582,661,724` · `qc-command:103` · `qc-dashboard:42` · `qc-history:53` · `pending-so-value:134` · `so-overview:68` · `nc-register/cascades.ts:103` · `party-grn:147` · `tool-issues:80` · `bom-master/cascade.ts:162` · `production-schedule/service.ts:43` · `reports/definitions/design-engineer-workload.ts:33` | overdue / aging / window predicates |

**`production-schedule` is the clearest illustration** (found batch 16): `todayIso()` drives the default 30-day window start, the `Today` button, AND the highlighted "today" column on the client — while `service.ts:43` feeds the same value into the `history`/`future` **SQL filter predicates** (L107-109). For 5.5 hours a day the whole Gantt shifts by one day and the server mis-classifies which ops are past vs future.

**Legacy was CORRECT.** `today()` (HTML L1485-1488) builds the date from `getFullYear()/getMonth()/getDate()` — local parts. **This is a port regression, not an inherited bug.**

**Note:** `addDays`/`daysBetween` helpers that do UTC arithmetic on an already-correct date string are **fine** — IST has no DST. Only the *derivation of today* is wrong.

### Blast radius — the web half (form defaults)

The same `new Date().toISOString().slice(0,10)` pattern seeds **form date defaults that feed writes**:

| File | Field | Writes |
| --- | --- | --- |
| `op-entry/components/op-entry-form.tsx:53` | `logDate` | **production logs** → `qty_done`, JC/SO cascade, Daily Production Report |
| `delivery-challans/routes/receive.tsx:38` | `receiptDate` | **receipt** → cascades into `jc_ops`, `store_transactions`, auto-NC |
| `delivery-challans/routes/create.tsx:43` | `dcDate` | DC issue |
| `customer-dispatches/routes/create.tsx:17` | dispatch date | dispatch register, invoicing |
| `capa/routes/list.tsx:348` | `capaDate` | CAPA record |
| `design-tracker/routes/list.tsx:707` | `logDate` | design work log |
| `design-projects/routes/list.tsx:322` | `startDate` | project start |
| `daily-report/routes/list.tsx:19` | report date | **read filter** — the night shift's own report opens on the wrong day |

Downstream, `log_date` keys the Daily Production Report, JC completion rollups and the JC→SO cascade — so misdated entries land in the wrong day's production figures.

**A manufacturing job-shop runs a night shift.** This is not theoretical.

### Fix

One shared helper, then replace the 53 sites (form defaults first — they're the ones that write):
```ts
import { formatInTimeZone } from 'date-fns-tz';
export function todayIst(): string {
  return formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}
```
`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)` also yields `YYYY-MM-DD` with no dependency.

**Do this together with ISSUE-040** (the display-format gap — legacy renders `15 Jul 26`, we render raw ISO, and there are already **four** divergent local `fmt()` copies). Both are the same root cause: **no shared IST-aware date utility**, despite CLAUDE.md mandating one and the dependency being installed.

### Why it went unnoticed

`toISOString().slice(0,10)` is the idiomatic-looking way to get "today" and reads as correct in every review. It is wrong only for 5.5 hours a day, only in a UTC+ timezone, and only for whoever is working then. **The same shape as every other defect this track has found: it typechecks, it lints, it reviews clean, and it is wrong.**

## ISSUE-066 — Op Entry: legacy's machine form is the SOURCE of ISSUE-001. Do not port it.

- **Surfaced:** 2026-07-15 (REFACTOR-1, Op Entry — Machines)
- **Severity:** P2 (a documented trap for future "parity" work)
- **Status:** [x] deliberate divergence — **recorded so nobody "fixes" it toward legacy**

Legacy `_machSubmitLog` (L5669-5696) has **no QC guard** — it unconditionally pushes `type:'complete'`. **That is exactly ISSUE-001**: the phantom complete-logs against QC ops that corrupt `v_jc_op_status`.

Our shared `OpEntryForm` diverts QC-bearing ops to the QC sub-form (T-040d / ADR-025), and `submitOpLog` carries a server-side `op.opType === 'qc'` throw. **Porting legacy's machine form verbatim would reintroduce the corruption.**

**Any future "machine form parity" ticket must treat this as an intentional divergence.** Related: legacy's Op Seq datalist (L5235) *excludes* QC and outsource ops entirely — legacy cannot select a QC op at all, which is why its form never needed a guard. Our QC sub-form is a deliberate improvement, not a gap.

**Also on these two pages, reported not built:**
- **`JcOpEnriched` lacks `itemCode`, `itemName`, and JC `orderQty`** (`packages/shared/src/schemas/op-entry.ts:48-76`; `service.ts:56-100`). Blocks legacy's pending-table **Item** column (L5635), the running **ITEM** tile (L5603), the **ORDER/DONE** tile (L5604), and the machine-card progress `completed/orderQty` (L5562). `completedQty` exists; `orderQty` does not. Not fabricated, no blank columns added.
- **Legacy's global Op Entry console is un-portable as-is:** all-JC datalists + a global ready table + a 15-row activity feed. `listJcOpsQuerySchema` (L202-211) and `listOpLogQuerySchema` (L213-224) both `refine`-require a JC/machine filter, and `OpLog` lacks `jcNo`/`opSeq`/`operation`/`machineId`. Our per-JC drill-down IA is a deliberate divergence.
- **`JcOpStatusBadge` cited line numbers (4333/5237/5395) that contain no colour table** — fabricated citations. Rebound to legacy `badge()` (L1959-70): `waiting` grey→**b-red**, `available` amber→**b-blue**, `po_created` amber→**b-blue**, `complete` green-600→**b-green**, `outsource` grey→**b-amber**.
- **`.b-yellow` and `.b-running` confirmed print-block-only again** (L10555-61) — legacy renders `In Progress`/`At Vendor`/`Running` as an unfilled `.badge` on screen.
- **A legacy bug documented so nobody restores it:** `submitStartOp` reads `#opOperatorText`, but `renderOpEntry` renders id `opOperator` (L5321) — legacy's own start path reads a non-existent element.
- **Machine-busy start guard:** legacy blocks starting an op if the machine already runs another (L5526-27). Our `blockedReason` has no such check. Needs server-side confirmation.

## ISSUE-067 — The port is a LIGHT theme; legacy was DARK. Never copy legacy's raw hex.

- **Surfaced:** 2026-07-15 (REFACTOR-1, Machine Loading — corroborated by QC Command and Op Entry Machines)
- **Severity:** P3 (a standing rule, not a bug — recorded because it inverts the track's default)
- **Status:** [x] rule established

Legacy hardcodes dark-theme hex: `#ef4444` / `#ffb020` / `#22c55e` (L5029), `#8B5CF6` (L18636), `color:#000` on amber buttons (L5637). **Our tokens are deliberately re-themed for a LIGHT theme** — `--red:#dc2626`, `--bg2:#ffffff`, `--amber:#c47a00`.

**So "match legacy's pixels" is sometimes exactly WRONG.** Copying legacy's literal hex fights the port's intentional re-theme: legacy's `color:#000` on amber assumed *its* bright amber, and on our darker `#c47a00` it is a contrast regression. **The token is the correct translation**, not a drift.

**This qualifies ISSUE-058** (QC Command's `#8B5CF6` vs our `--purple:#7c3aed`). That is legacy being internally inconsistent — its own token says `#7c3aed` — but the resolution is *not* automatically "copy legacy's hex". On a re-themed port, the token usually wins. Both pages currently mirror legacy's literal value; **that is worth a deliberate decision, not a per-page reflex.**

**Rule going forward:** legacy hex → map to the nearest token. Only mirror a literal when the token demonstrably produces the wrong *relationship* (e.g. contrast against a specific background), and say so.

## ISSUE-068 — Machine Loading's Job Queue hides every blocked job

- **Surfaced:** 2026-07-15 (REFACTOR-1, Machine Loading)
- **Severity:** **P2** — a shop-floor board that omits exactly the jobs needing attention
- **Status:** [ ] open — backend filter change

Legacy's queue shows every op where `status !== 'Complete'` (L5081). Our API filters `available > 0 OR in_progress` (`machine-loading/service.ts:115`).

**Consequence: `waiting`, `qc_pending` and `running` ops never appear in the queue.** On a live loading board, jobs that are blocked or held for QC are **invisible** — the opposite of what the board exists for. A supervisor scanning the queue cannot see what is stuck.

**Fix:** align the service filter to legacy's `status !== 'complete'`. Backend, out of a UI-only pass.

**Also fixed on this page:** the Load badge's `Clear` state fell through to **`b-grey`** instead of legacy's `b-green` (L1963), and the Op Status column rendered as **plain grey text** where legacy uses `badge()` (L5074).

**Two legacy bugs found and NOT copied (port is better; kept):**
- `renderLoading` L5031 emits `.mach-card.selected`, but legacy only defines `.mach-card.sel` (L223) → **legacy's selected machine card gets no highlight at all.** `renderJobQueue` L10371 inlines a workaround, proving the intent. Our highlight is kept.
- `.mach-val` / `.mach-lbl` are used 3x (L5036-38) and **defined 0x** — the CSS declares `.mach-num-val` / `.mach-num-lbl` (L228-29). **Legacy's machine-card numbers render unstyled.** Our styling is kept.

**Still missing (reported):** `.mach-id` (legacy L224, main block, used on 8 screens), `.op-node`/`.op-arrow` (L257-62) — all absent from our theme, so the queue's op-flow chain is unportable. Not used (would be inert); no CSS added.

## ISSUE-069 — Job Queue: `togglePriority` would destroy operations data if wired

- **Surfaced:** 2026-07-15 (REFACTOR-1, Job Queue)
- **Severity:** P2 (a disguised ISSUE-026 — the endpoint exists and would return 200)
- **Status:** [ ] open — needs a dedicated endpoint

Legacy's queue has a `togglePriority` control (L10424). We have none, and **it must not be wired through the available path.**

The only endpoint that writes JC priority is the job-cards update — which is a **full-model replace that deletes and re-upserts `jc_ops` rows** (`job-cards/service.ts:830-862`). Flipping one priority flag through it would rewrite every operation on the job card. It would look correct, return 200, and silently churn production data.

**Fix:** a narrow `PATCH /job-queue/:id/priority` (or equivalent) that writes only the flag.

**Also on this page — invented math:** the Load badge uses `>80h / >40h -> Overloaded / Busy / Clear`. Legacy uses `loadPct > 1 / > 0.7 -> Overloaded / High Load / Manageable / Clear` (L1711-14), which needs `dailyCap` — **absent from our API**. **"Busy" exists nowhere in legacy.** The thresholds and the label are fabricated. Left alone (logic); needs `dailyCap` on the payload.

**Also reported:** per-machine + header Print (L10439 / L10467) — `printMachineQueue` (L10661) is a print-document engine, not markup; Start (L10434) needs op-entry's search schema to carry a `mode` param; the `Part / SO / Flow` chain needs all ops per JC (`JobQueueRow` has none) — header deliberately **not** renamed to add "Flow" it cannot render.

**Mapping conflict resolved — the registry was RIGHT.** The Shop Floor agent claimed `renderJobQueue` (L10363) was `/machine-loading`'s counterpart. Two agents independently disproved it: legacy's router has **`loading:` (L2388) and `jobqueue:` (L2415) as distinct nav keys** with separate state vars (`_loadingFilter` vs `_jqFilter`); reorder controls exist only in `renderJobQueue`; the Capacity Summary + View toggle exist only in `renderLoading`. **The confusion is explainable:** `renderLoading` contains a section commented `// -- JOB QUEUE VIEW --` (L5077) and a "Job Queue View" toggle (L5168) — a *view mode inside* `/machine-loading`, not the `/job-queue` page.

## ISSUE-070 — Outsource Jobs: tiles bound to a capped array; selection tint was half-broken

- **Surfaced:** 2026-07-15 (REFACTOR-1, Outsource Jobs)
- **Severity:** P3
- **Status:** [~] tint fixed; tile capping [ ] open

**Tiles under-count past 100 rows.** `PAGE_SIZE=100` and all four tiles are computed in-browser from `data.items`. With >100 OSP PRs the tiles silently under-count **and rows truncate with no pagination and no total shown**. The sibling `purchase-requests/routes/list.tsx:54-56` already solves this with `limit:1` count queries reading the server `total` — copy that shape. **10th page** with a server-owned figure recomputed or truncated client-side.

**Fixed — a bug that was only half-visible:** the purple selection tint sat on the `<tr>`, but `.innovic-table tbody tr:nth-child(even) td` paints an **opaque `td` background** over it — so selection highlighted **odd rows only**. Legacy has no tint at all, so removing it fixes the bug *and* matches legacy.

**Chain verified clean — no refusal needed.** `createPurchaseOrderFromPrBatch` (`purchase-orders/service.ts:1148`) was traced line-by-line against legacy `_ospCreatePO` (L27166-27207): PO insert, per-PR line with rate override, PR stamp (`status='po_created'` + `poId` + `poCreatedAt` + vendor), activity log — all present, **and ours is a superset** (adds code-uniqueness, blocks already-converted/cancelled PRs). Legacy's handler never touches `jc_ops`. **Third agent to verify the outsource chain rather than reflexively refuse.**

**Search box was absent** (legacy L27104) — built, with the placeholder adapted: legacy advertises "Search PR, **SO**, item, vendor..." and this page has no SO data (`PurchaseRequestListItem` carries a bare `sourceSoLineId` uuid, no code join, and no plan field), so shipping it verbatim would be trap 1. Used "JC".

## ISSUE-071 — Orchestrator note: my `td-ctr` counts were a different metric than the agents'

- **Surfaced:** 2026-07-15 (REFACTOR-1, batch 14)
- **Severity:** P4 (process)
- **Status:** [x] understood — stop quoting counts in briefs

Six agents have now reported "N `td-ctr` uses, not the M you briefed". **Both numbers were right.** I was quoting `grep -c`, which counts **lines containing a match**; the agents count **occurrences**. A line with three `td-ctr` cells counts once for me and three times for them.

**Consequence:** every count I put in a brief was a lower bound for a reason I did not understand at the time. I logged it in ISSUE-020 as "the grep under-counts multi-line JSX" — **true, but not the whole story, and not the cause of these particular discrepancies.**

**Rule:** do not quote match counts in briefs. Tell the agent to grep the file *and* read every cell renderer, and let its number stand. A number that is authoritative-looking and subtly wrong is worse than no number — the same failure this track keeps finding in the code.

## ISSUE-072 — Stuck Dashboard: op classification is `op_type`-blind, so it reports the wrong stage at the wrong threshold

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stuck Dashboard)
- **Severity:** **P2** — false positives AND wrong stage headings on a board people act on
- **Status:** [ ] open — API-side

Legacy branches on `op.opType === 'QC'` (L18081). Ours (`stuck-dashboard/rules.ts:100-118`) branches on `qcPending > 0`. Two consequences:

- A **production** op awaiting QC is filed under **QC Pending (threshold 3 days)** instead of **Production Op (threshold 5 days)** — wrong stage heading, and an op idle 4 days is reported that legacy would not report at all.
- A **QC-type** op with `qcPending = 0, available > 0` is filed as a **Production Op**, which legacy never reports.

**`op_type` is already available** on both `jc_ops` and `v_jc_op_status` (`0006_phase3_views.sql:75`) — `stuck-dashboard/service.ts:43` simply never selects it. **Fix:** select `o.op_type` and branch on it.

**The headline risk was checked and is CLEAR.** Unlike ISSUE-062 (Design Work Log's Alerts tab derives its engineer list from the very logs it's testing for absence) and ISSUE-068 (Machine Loading's queue filters out `waiting`/`qc_pending`), this page's data source **can** contain everything legacy's predicate catches: `loadSoPhaseData` scans every non-deleted SO with **no LIMIT**, `loadOpCandidates` has **no LIMIT**, and the page renders all items — no pagination, no truncation, no capped denominator.

**And our predicate is strictly WIDER than legacy's.** Legacy gates ops on `available > 0 && completed < orderQty`, so **a fully-completed op awaiting QC (`available = 0, qcPending > 0`) is invisible in legacy** — the exact thing a stuck board should catch. Ours reports it. A legacy bug the port already fixes; do not "correct" toward legacy here.

## ISSUE-073 — Stuck Dashboard: stuck design rows lost the designer's name

- **Surfaced:** 2026-07-15 (REFACTOR-1, Stuck Dashboard)
- **Severity:** P2 — removes the actionable field from an action board
- **Status:** [ ] open — API-side

Legacy renders `'Designer: ' + dsn.designer + ' | Status: ' + dsn.status` (L18048). Ours (`stuck-dashboard/rules.ts:44`) renders the constant string `'Design in progress, not approved'`.

**This strips the one field that tells you whom to chase on a stuck design.** `design_tracker.designer` is `NOT NULL` — the data exists and is simply not carried through.

**Also on this page, flagged not built:**
- **Configure Thresholds (L18116)** — needs a thresholds store + endpoints + modal; thresholds are currently `DEFAULT_STUCK_THRESHOLDS` constants. **No dead button added** (trap 1); the tip already discloses the live values from the payload.
- **8th column Timeline (L18135/18147)** — `/so-timeline` **exists**, but `so-timeline/routes/index.tsx:22` holds the SO in local `useState` with **no URL search param**, so a Link cannot preselect it. **The SO link was deliberately NOT repointed** from `/sales-orders/$id` to `/so-timeline` — that would trade a working deep link for a blank picker. **Fix: add `validateSearch` `?so=` to the so-timeline route** and both affordances port cleanly.
- **`Since` renders raw ISO** vs legacy `fmt()` → `01 Apr 26`. No local formatter added (ISSUE-040, now at **12** copies).

**Legacy behaviour correctly not copied:** the `<tr>` red tint at `rgba(239,68,68,0.02)` (L18139) is 2% opacity — imperceptible — and `.innovic-table tbody tr:nth-child(even) td` sets a `td` background that beats a `tr` background anyway, so it would be invisible on half the rows in legacy too. Dark-theme literals (`#7f1d1d`/`#b91c1c`/`#ea580c`) were mapped to a `--red2`/`--red`/`--orange` token ramp preserving the escalation (ISSUE-067).

## ISSUE-074 — Production Dashboard: count froze at 100; and two tiles were removed for parity

- **Surfaced:** 2026-07-15 (REFACTOR-1, Production Dashboard)
- **Severity:** P3
- **Status:** [~] count fixed; truncation [ ] open; **tile removal needs a user ruling**

**FIXED — the 11th instance of the recurring defect.** The header bound `readyToProcess.length`, but `production-dashboard/service.ts:115` applies `LIMIT 100` while the server's true `counters.readyOps` sat **unused on the payload**. Past 100 ready ops the count silently froze. Now bound to `c.readyOps` — same predicate as the row query, so count-vs-rows parity holds.

**Still open — silent truncation.** `readyToProcess` is `LIMIT 100` (service.ts:115) and `openJobCards` is `LIMIT 60` (service.ts:82). The counts are now honest but the **rows are still capped with no "showing first N" affordance**. Legacy caps neither. Needs API work.

**⚠️ NEEDS A USER RULING — two working tiles were removed.** The brief said *"never delete a working feature to reach parity — flag instead."* The agent **removed the Outsource Ops and At Vendor tiles** to match legacy's 4-card grid (L3756-3777). Its reasoning is defensible — legacy computes both counters at L3665-3666 and then **never renders them**, and the `outsource-jobs` module is their real home — and both counters remain on the payload, so restoring is trivial. **But they showed real data users can see today, and parity was the justification.** Reversible on request.

Also dropped in the same pass: the `/op-entry/running` and `/machine-loading` tile links (`/job-cards` survives via `All JCs →`), and `doneOps/totalOps` on JC cards (legacy shows `%` only). The **No-Ops JC** tile was **merged, not lost** — legacy's card 1 carries it in the sub-line (`${totalJC} total · ${noOpsJC} no-ops`).

**Missing, correctly not computed:** `Machine-wise Pending Work` (L3780-88, needs `calc.machineLoad`), `Supply Chain Snapshot` (L3804-38, reads `db.items`/`purchaseOrders`/`grn`), `.op-chain` (L3719/3726, needs `jc.ops` + the absent `.op-node` class).

**Two traps caught:** legacy's inline `grid-template-columns:repeat(4,1fr)` (L3756) is a **no-op** — `.stat-grid` already declares it (legacy L96 = theme L292) — and copying it would have **killed our `@media(max-width:768px)` 2-col rule**. And `progBar` in a flex row (L3728): legacy drops a bare `.prog-wrap` into flex where it has no width and **collapses to zero** — a legacy rendering bug; the port applied legacy's *own* working idiom from L5133 (`flex:1`) instead.

## ISSUE-075 — Task Board: `.task-unread` / `.task-linked-ref` ported; legacy's Overdue filter is dead

- **Surfaced:** 2026-07-15 (REFACTOR-1, Task Board)
- **Severity:** P4
- **Status:** [x] classes ported + page wired 2026-07-15

**Ported verbatim from legacy L187-188 (main stylesheet)** into `innovic-theme.css`. Both depend on `--sig-critical`, `--sig-critical-bg`, `--sig-info`, `--sig-info-bg`, which **already exist in `tokens.css` (L99-110) byte-identical to legacy's** (L34/L37) — the token layer was ported faithfully; only these two rules were missed.

The page had **approximated both**: the unread dot with inline styles (losing legacy's `box-shadow` halo) and the linked ref as `badge b-cyan` — a **cyan pill** where legacy is a **blue mono square chip**. Both now use the real classes.

**Legacy's Overdue filter is completely dead — correctly NOT copied.** Clicking legacy's Overdue card sets `flt.status = 'Overdue'`, but no task ever *stores* that status — it is derived at L14272 — so `t.status !== flt.status` is always true and **legacy renders zero rows**. Our port filters on the derived `isOverdue` and shows the real rows. Copying legacy would have shipped a dead filter.

**Also fixed:** the 🔗 linked-nav button (legacy L14304) was missing entirely — built, and safe to wire because it is **read-only navigation, not a task write**, so the incomplete-endpoint rule doesn't apply. `navPage` was already on the payload and the 12 `AssignTaskButton` call sites store **real React route paths**, so no mapping had to be invented. Also applied `tbl-frozen` (legacy L14319).

**Legacy's inline `<tr>` zebra (L14294) correctly NOT copied** — trap 2: `tbody tr:nth-child(even) td` (legacy L114) paints the `<td>`, which covers the `<tr>` background, so it is **inert in legacy too**; our theme reproduces the identical zebra at L387.

## ISSUE-076 — Assemblies: the "Ready" state is unreachable — tile, filter and badge are permanently dead

- **Surfaced:** 2026-07-15 (REFACTOR-1, Assemblies)
- **Severity:** **P2** — an entire status that cannot occur; three UI affordances that can never fire
- **Status:** [ ] open — backend, one argument

`deriveStatus` (`apps/api/src/modules/assembly/service.ts:65-70`) returns `'ready'` **only** when `canAssemble > 0`. The list endpoint calls it with `canAssemble` **hardcoded to zero**:

```ts
status: deriveStatus(orderQty, assembledQty, 0),   // service.ts:365
```

**Consequences on `/assemblies`:** the **Ready tile is permanently 0**; the **Ready filter always renders "No results match your filter"**; the `b-green` / `ALL READY ✓` badge **can never render**. The list endpoint never computes component readiness — the *detail* endpoint does.

**Fix:** compute `canAssemble` in the list query (the detail endpoint already has the logic), or drop the Ready state from the list's vocabulary. **Do not "fix" it in the browser** — readiness is a per-BOM component rollup.

**Also on this page:**
- **List membership diverges from legacy — tiles are inflated.** Legacy's `equipSOs` = `type==='Equipment' && s.bomMasterId && s.status!=='Closed'` (L28675), and it further skips BOMs with no items (L28678). Ours filters on `type === 'equipment'` **only** — so **Closed** and **BOM-less** equipment SOs appear in the list and inflate **every** tile.
- **`partName` is hardcoded `null`** (`service.ts:359-360`, and the detail header at L235-236). The search haystack includes `it.partName`, so the **"item" leg of `🔍 Search SO, customer, item…` is dead** — search really matches soCode / customerName / bomCode. Legacy searched real `so.partName` + `bom.bomName`. Placeholder kept (it is legacy's own, and BOM code *is* searchable); flagged rather than reworded.
- **Export Excel correctly REFUSED.** Legacy `_atExportExcel` (L29059) is a 3-sheet SheetJS workbook needing `assembliesPossible`, `bottleneck`, per-child readiness and all units — **none on the payload**, and no export endpoint exists. Would need a new library + N detail fetches.
- **`BOM name` / `Rev` not renderable** — `bomName` is on the *detail* header schema but not `assemblyListItemSchema`; `revision` exists nowhere.
- **Clean:** no pagination/cap anywhere — `listAssemblies` has no `LIMIT` and `counts.all` is over the complete array. **No count-vs-rows divergence, no silent truncation.**
- **`toISOString()` at list.tsx:47 drives ONLY the Due-column red/bold** — cosmetic; no data written, no row filtered, no count affected. **But `assembly/service.ts:61-63` has the same bug and it *writes* default assembly/dispatch dates** (ISSUE-065).

## ISSUE-077 — `docs/PARITY/assytracker.md` asserted a class exists when it exists nowhere (fixed)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Assemblies)
- **Severity:** P4 — but it is the *documentation* version of ISSUE-024
- **Status:** [x] corrected 2026-07-15

`docs/PARITY/assytracker.md:32` read: *"Tile chrome: `.dash-stat-card` … **✅ class exists in theme**."*

**It exists in neither.** `grep -c "dash-stat-card"` → **0** in `innovic-theme.css`, **0** in legacy's stylesheet. Legacy *uses* it (L24013-16, L28750) and never defines it, so **it is inert in legacy too**; the tiles are styled entirely by legacy's inline attributes, which the port already mirrors. Adding a rule would **diverge** from legacy.

**Same failure as ISSUE-024** (the refactor skill prescribing 8 nonexistent classes) — a document telling the next reader to use something that does nothing. **Corrected in place** with the reasoning and a pointer to ISSUE-027's method.

**Worth a sweep:** `docs/PARITY/*` may contain other "✅ exists" claims that were never verified. Same rule as everywhere else on this track — **grep before trusting any document, including this project's own.**

**Also found:** **`--teal` is undefined in `tokens.css` AND in legacy.** Legacy's `var(--teal)` (L28749/28782/28786/28790) is a dead variable, so **legacy's Done tile is unstyled**. Our `var(--teal, #14b8a6)` fallback resolves to legacy's own Done literal (L28780/28790) and matches `.b-teal` (theme L547-553, which hardcodes the same hex and cites this exact function). Working; a real `--teal` token would let both stop hardcoding.

## ISSUE-078 — JW DC: `total` ignores every filter, on both tabs — and here it is USER-VISIBLE

- **Surfaced:** 2026-07-15 (REFACTOR-1, JW DC)
- **Severity:** **P2** — 6th module with ISSUE-043, and the first where users actually see it
- **Status:** [ ] open — backend

`apps/api/src/modules/jw-dc/service.ts`: the rows query applies `searchFrag` / `vendorFrag` / `poFrag` / `statusFrag` (L177-180); `total` counts only `companyId + deletedAt IS NULL` (L185-190). **Inward is identical** (L646-656).

**Unlike the other five ISSUE-043 instances — which are dormant because the page never renders `total` — this page shows it.** Search and you get **"Showing 1–3 of 412"** with **Next enabled onto empty pages.**

**Mapping confirmed distinct from `/delivery-challans`:** `renderJWDC` (L24434) reads `db.jwDCOutward`/`db.jwDCInward` via nav key `jwdc:` (L2412) and models multi-line DCs with separate inward *documents*; `_ospDCRegister` (L27419) reads `db.ospDC` and models a single-qty header with `returnedQty` written directly. Zero overlap in collections or handlers.

**A legacy data-loss bug deliberately NOT copied:** legacy's outward DC seeds `sendQty: 0` while the input **displays** `available` (L24569 vs L24581) — so **if an operator doesn't touch the quantity field, legacy saves zero**. Our port seeds `sendQty: l.available`. Kept.

**Theme-structure gap (not a page bug):** legacy styles bare `table`/`th`/`td` **globally** (L109-112); our theme scopes everything to `.innovic-table`. So any classless legacy `<table>` — e.g. both modal line-pickers here — renders unstyled, and the port compensates with inline padding. Structural difference between the two stylesheets; worth one decision.

## ISSUE-079 — Production JW List: the Due Date column has never shown data

- **Surfaced:** 2026-07-15 (REFACTOR-1, Production JW List)
- **Severity:** P2 — a column that is always empty on a production board
- **Status:** [ ] open — backend, ~2 lines

`apps/api/src/modules/prod-jw-list/service.ts:71` returns **`NULL AS "dueDate"`**, so `/prod-jw-list` renders `—` in Due Date for **every row, always**.

**This is not a schema gap.** `job_work_order_lines.due_date` **exists** (`schema.ts:1253`), and the service's own `line_done` CTE **already selects from that table**. The SO sibling does it correctly one file over: `prod-so-list/service.ts:76` → `MIN(ld.line_due_date) AS "dueDate"`. A copy-paste omission; the fix mirrors the sibling.

**Also fixed on both prod lists (a real bug, found on the SO sibling and confirmed here):** the progress track used **`--bg4`** — which **is the row-hover fill** (`innovic-theme.css:390`) — so **the progress bar vanished when you hovered the row**. Legacy uses `--bg5` (`tokens.css:27`). Both pages corrected. Both also had an empty state that **replaced the entire table including its headers**; legacy renders `<td colspan="N" class="empty-state">` inside `<tbody>`.

**Naming deliberately NOT reverted:** legacy says "JW", our port says **"JWSO"** — 70 occurrences across 12 files, the sidebar labels this exact route "JWSO List" (`sidebar.tsx:178`), and commit `9527725` deliberately moved toward JWSO. Reverting to legacy's wording would **desync the page from its own nav entry**.

## ISSUE-080 — 🔴 Trash: "Empty All" told you it would delete 3 items and deleted 50 (FIXED)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Trash)
- **Severity:** **P1-class UX on a destructive, irreversible action** — the confirmation understated its blast radius by up to 17x
- **Status:** [x] fixed 2026-07-15 (UI only — the deletion action itself was already correct and untouched)

`total` is the **type-filtered** server count. `POST /trash/empty` (`trash/service.ts:260`) loops **`ENTITIES` — all 17 tables** — and deletes every soft-deleted row, company-scoped, **ignoring any filter**.

So with the type filter on `Item (3)` and 50 rows in trash, the confirm read:

> *"PERMANENTLY DELETE 3 items"*

…and then deleted **50**. On an irreversible hard delete.

It also **hid the Empty All button whenever the filtered type was empty**, even with a full trash — so the control vanished based on an unrelated filter.

**Legacy is correct here** and uses the *unfiltered* `db.trash.length` for both the confirm count (L2191) and the button gate (L11335). Fixed by deriving `grandTotal = sum(byType)` — `byType` is server-computed across all types, so this is a **derivation of server-owned data, not browser math on a figure the server already exposes**. Legacy's 4 warning bullets (L2192-2197) were also restored; the port had reduced them to one line.

**Only the message and the button's visibility changed. The deletion is server-side and was not touched.**

## ISSUE-081 — Trash: restoring a Job Card brings it back with NO operations

- **Surfaced:** 2026-07-15 (REFACTOR-1, Trash)
- **Severity:** **P2** — silent data-fidelity loss on a "restore" action
- **Status:** [ ] open — backend

Legacy's restore **cascade-restores children** (L2147-2150): restoring a Job Card finds every trash entry of type `JC Ops` matching that `jcNo` and pushes its ops back into `db.jcOps`.

Our `trash/service.ts` has **no cascade** — grep for `jcOps` / `jc_ops` / `cascade` returns **nothing**. `restoreTrashItem` (`service.ts:181`) does a single `UPDATE … SET deleted_at = NULL` on the parent row only.

**Consequence: a restored Job Card comes back as a shell with no routing.** The user's mental model is "undo the delete"; what they get is a JC that has lost its operations. Nothing warns them.

**Fix:** cascade `deleted_at = NULL` to `jc_ops` (and audit any other parent/child pair in `ENTITIES` with the same shape) inside the existing transaction.

**All three deletion endpoints were traced against legacy and are otherwise sound — nothing was wired or unwired:**
- **Restore** → `service.ts:181`: `UPDATE … SET deleted_at = NULL WHERE id AND company_id AND deleted_at IS NOT NULL`. Matches legacy L2143, plus an admin gate, company scope and audit. **Kept.**
- **Delete** → `service.ts:220`: a real `DELETE`, but guarded `AND deleted_at IS NOT NULL`, so it can only destroy an already-soft-deleted row — the same blast radius as legacy L2176. Audit is emitted **before** the delete, in the same tx. **Kept.**
- **Empty All** → `service.ts:260`: loops all 17 entities, soft-deleted rows only, company-scoped, audited. Equals legacy's `db.trash=[]` (L2202). **Not** the full-model-replace trap. **Kept.**

**Two more, reported not fixed:**
- **Rule 8 tension — needs ratifying, not relitigating in a UI pass.** `perm-delete` and `empty` are hard deletes **from app code**, which CLAUDE.md Rule 8 forbids outside "documented admin scripts after a backup". `trash/service.ts:9-10` asserts this endpoint *is* that documented path. That is a pre-existing architectural decision by an earlier session, shipped and live. **Ratify it in `DECISIONS.md` or revoke it — but decide deliberately.**
- **`sql.raw` with interpolated `input.id` / `companyId`** (`service.ts`). **Not currently injectable** — `z.string().uuid()` (`schema.ts:57`), an enum-constrained table name, and a JWT-sourced `companyId`. But it is one schema-loosening away from an injection hole **on an endpoint that runs `DELETE FROM <table>`**. Worth parameterising while it is cheap.
- **`deletedBy` is derived from `updated_by`**, so a row edited *after* deletion misattributes who deleted it.

## ISSUE-082 — Activity Log: legacy's "Clear Log" hard-purges the audit trail. There is no endpoint, and there must not be.

- **Surfaced:** 2026-07-15 (REFACTOR-1, Activity Log)
- **Severity:** P3 (a documented deliberate omission)
- **Status:** [x] correctly NOT ported — recorded so nobody "completes" it

Legacy L11299 gives admins a **Clear Log** button that runs `db.activityLog = []; save()` — **a hard purge of the entire audit trail.** It violates CLAUDE.md Rule 8 and ADR-019.

`apps/api/src/modules/activity-log/routes.ts` exposes **only `GET /activity-log`**. The agent's framing is the right one: *"there is no endpoint and there must not be."* **On an audit log, the missing feature IS the feature.** Any future "parity" ticket must treat this as intentional.

**Real defects found on the page:**
- **Two dead colour-map keys.** `IMPORT` is never emitted by our API. `DISPATCH` is never emitted either — our API emits **`DISPATCHED`** — so dispatch rows render **grey** where legacy showed them cyan.
- **Users who no longer exist cannot be filtered.** `service.ts:87` returns `{id: null, name}` pairs for legacy/hard-deleted users, but the query filters by `userId` (uuid), so the page must drop those options. **Legacy filtered on the name**, so their activity *was* filterable. Their history is now unreachable through the filter. Needs a `userName` query param.
- **ISSUE-055 localised:** grep confirms **no `action: 'TPI'` anywhere in `apps/api`**. This page can display *any* action (both colour maps fall back gracefully; the dropdown is server-driven via `selectDistinct`), so the TPI vocabulary loss is **upstream in the service**, not a display gap here.
- **Count is honest:** `data.total` is a server `count()` over the same WHERE (`service.ts:76`); legacy's `log.length` is its full filtered set, so `total` is the exact equivalent. **No ISSUE-043 skew.**

## ISSUE-083 — Alerts dashboard: the row said "click me" and nothing was wired

- **Surfaced:** 2026-07-15 (REFACTOR-1, Alerts)
- **Severity:** P3 → fixed
- **Status:** [x] fixed 2026-07-15

The row carried `className={interactive ? 'cursor-pointer' : …}` **with no `onClick`** — while **both legacy's tip and the port's own tip** told users "Click any alert with records". Trap 1, shipped. Rows now navigate to `/alerts/$code` (target verified to resolve, `drill.tsx:24`); the arrow link and Email button `stopPropagation`.

**Also on this page:**
- **Dept-access filter never ported.** Legacy L22326 filters alerts through `_hasDeptAccess(r.dept)` (per-user `db.userAccess`); `GET /alerts` returns **every alert to every company member** (`service.ts:89` filters on `active` only). Backend/authz — reported.
- **No browser-math defect** — verified: no `LIMIT`/`slice` in any definition, `count = records.length` is the true count, and `total`/`byDept` sum the full payload. Denominators sound.
- **A legacy dead token, correctly not invented:** `color:var(--text1)` (L22341) — `--text1` is defined **nowhere** in legacy's `:root` (it has `--text`/`--text2`/`--text3`), so that cell inherits the default `td` colour in legacy. Reproduced by omitting the colour.
- **`Qc` deliberately not copied** — legacy's `charAt(0).toUpperCase()+slice(1)` (L22339) yields "Qc". Kept `QC` per the CLAUDE.md §13 glossary; `DEPT_LABEL` is shared with two sibling pages.

## ISSUE-084 — Alerts ignore department access; the filter function already exists and is used elsewhere

- **Surfaced:** 2026-07-15 (REFACTOR-1 — found **independently by the Alerts dashboard and Alerts config agents**)
- **Severity:** **P2** — a live authorization divergence
- **Status:** [ ] open — backend, and the fix is already written

Legacy filters alerts through `_hasDeptAccess(r.dept)` (L22326) — a user only sees alerts for departments they have access to.

**We have the exact mirror already:** `hasDept()` at `apps/api/src/modules/dashboard/access.ts:25` — a complete implementation handling admin/manager, `fullAccess`, and per-department grants. It is called by **five** files: `dashboard/config-service.ts`, `home-service.ts`, `widgets-service.ts`, `work-list-service.ts`, `access.ts`.

**`apps/api/src/modules/alerts/service.ts` calls it ZERO times.** `runAllAlerts` (L85) filters on `active` only, so **every company member sees every active alert regardless of department grants.**

So the Dashboard respects dept access, Alerts does not, and legacy does. The fix is a call to a proven function four files away.

**Neither agent copied legacy's tip clause "for users with department access"** — that would have been trap 1 verbatim (advertising a filter we don't apply). Correct.

**Also on `/alerts/config`:** 8 of 23 rules are absent (AL-010, 016, 017, 019-023) — a documented deferral (`registry.ts:13`, ADR-024), so the page lists 15 rows where legacy lists 23. Known, not new. And the gate differs: legacy is `isAdmin()`-only, ours allows `admin||manager` — **matching `alert_config_manager_write` RLS**, and writes are enforced server-side, so there is no privilege escape. Reported, not touched.

## ISSUE-085 — Access Control: a rejected role change stays on screen looking successful

- **Surfaced:** 2026-07-15 (REFACTOR-1, Access Control)
- **Severity:** **P2** — on the screen an admin uses to audit permissions
- **Status:** [ ] open — **legacy is SAFER here; this is a port regression**

Our inline role select (`access-control/routes/list.tsx:142-146`):
```ts
setRole(next);                      // optimistic local state
updateUser.mutate({ role: next });  // fire-and-forget
```
`useUpdateUser` (`users/api.ts:60-68`) has **no `onError`**, and invalidates only `usersKeys.lists()` + `usersKeys.detail(id)` — **zero references to `accessControlKeys`**.

**Consequences:** on failure there is **no rollback, no error surfaced** — the row keeps displaying a role the server **rejected**, until remount. On success, the access-control list's own derived data is never invalidated.

**Legacy does all four things we don't** (`_changeUserRole`, L13907):
```js
if(!isAdmin()){ toast('Only Admin can change user roles','err'); render(); return; }  // resets the select
logActivity('ROLE CHANGE','User', u.name+': '+oldRole+' → '+newRole, u.name);          // audits it
toast('✅ '+u.name+' role changed: '+oldRole+' → '+newRole);                            // confirms it
```

**This is a different shape from most findings on this track.** Usually the port is *missing* a legacy feature. Here the port **dropped a safety behaviour legacy had** — on authorization.

**Fix:** `onError` → revert `setRole`, surface the error; invalidate `accessControlKeys.list()` alongside `usersKeys.lists()`.

## ISSUE-086 — Access Control: `0/9` and `0/39` mean the OPPOSITE of legacy, in numbers rather than a badge

- **Surfaced:** 2026-07-15 (REFACTOR-1, Access Control)
- **Severity:** **P2** — ISSUE-023's inversion, one layer deeper
- **Status:** [ ] open — **needs a user ruling; no fix attempted (semantics, not markup)**

The Departments and Forms columns render `deptCount/totalDepts` and form counts **verbatim from legacy** (`list.tsx:171,175`).

- **Legacy:** `0/9` = **no access**.
- **Ours:** an unconfigured user hits `isUnconfigured()` (`packages/shared/src/schemas/access-control.ts:137-143` — note it **moved** from `apps/web/src/lib/`) → **allow-all**.

So the admin permission-audit screen shows **`0/9` next to users who hold full access to everything.**

**This is worse than the Users-list case (ISSUE-023), which the Users agent correctly refused.** There it was a grey "Not configured" *badge* — something an admin might question. Here it is a **fraction**, which reads as a measured fact.

**The page's port-added subtitle is currently the only on-screen disclosure of the inversion** — the agent kept it deliberately, and it should not be removed for parity.

**Zero changes were applied to this page** — every remaining delta is authorization-semantic, and the agent correctly acted on none of them.

**Also:** `isActive` is fetched, typed (`access-control.ts:62`) and **never rendered** — the API even sorts by it (`service.ts:132 desc(users.isActive)`). **Deactivated users render identically to active ones on the permission-audit screen.** Legacy has no such column, so adding one is both legacy-absent and authorization-semantic → reported, not built.

**Role vocabularies don't map:** legacy has `admin, manager, sr_engineer, engineer, jn_engineer, operator, viewer`; ours has `admin, manager, operator, qc, procurement, dispatch, design, viewer`. Five keys don't exist on either side. Kept ours; display labels for `qc`/`procurement`/`dispatch`/`design` were **not** invented.

## ISSUE-087 — Settings: legacy's Data Management panel must NEVER be ported (won't-fix, recorded deliberately)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Settings)
- **Severity:** P3 (a permanent do-not-build record)
- **Status:** [-] **WON'T-FIX — recorded so a future agent does not "restore parity" and build a wipe button**

Every control in legacy's Settings → Data Management was traced. Three must never exist here:

| Legacy control | What it actually does | Verdict |
| --- | --- | --- |
| `⬆ Import Data (JSON)` (L13414) | `importData` (L16708): **`db = data`** from an uploaded file, validated only by `if(!data.items \|\| !data.machines)` | **REFUSE** — wholesale DB replacement from an unvalidated upload; the full-model-replace pattern other agents refused |
| `⚠ Reset to Demo Data` (L13415) | `resetData` (L16726): **`db = seed()`** | **REFUSE** — wipe |
| `🔴 Factory Reset (Delete All)` (L13416) | `_factoryReset` (L16731): batch-deletes **every** collection **including users and the activity log** | **REFUSE** — hard purge; violates CLAUDE.md Rule 8; same class as the Activity Log `db.activityLog=[]` correctly skipped (ISSUE-082) |

**Legacy ships a button that destroys the entire tenant including its own audit trail.** "Parity" here would mean building that. **No endpoint exists for any of the three, and none should.**

- `⬇ Export Data (JSON)` (L13413) — **not a refusal**: `/backup/download` already exists (admin-gated, company-scoped) on its own `/backup` page, mirroring legacy's separate `renderBackup` (L21963). Duplicating it onto Settings adds no capability.

**Real gaps on this page, reported not built:** `👥 Manage Users` (L13361) — `/users` exists, so this is the only gap with a live destination and the cheapest parity win, but adding an `isAdmin()`-gated button is adding a role check. `🔑 Change Password` (L13362) — legacy uses Firebase `reauthenticateWithCredential`+`updatePassword`; we have only the `/reset-password` email flow. Needs a Supabase `updateUser` modal (a component port).

**Two structural refusals worth keeping:**
- **`max-width:600px` (L13354) NOT applied.** Legacy sized it for its own content (one readonly field, a textarea, four buttons). Our page carries a `.form-grid-3` company form and a 5-column OSP table legacy never had — clamping to 600px leaves ~175px per field on a live admin form. Cosmetic upside, real regression.
- **Integrity description wording kept.** Legacy L13424 advertises "QC, Dispatch" checks; our 8 checks (DI-001…008) include **neither**. Copying legacy verbatim would advertise checks we don't run — trap 1.

**`.mt-16` — a 9th missing class.** Real in legacy's main block (L268), **absent from our theme**, so `className="panel mt-16"` was inert in two Settings panels (now inline styles; same precedent as `machine-loading/routes/list.tsx:571`). **Do NOT port it:** both stylesheets already give `.panel` `margin-bottom:16px` and adjacent margins collapse, so `mt-16` is redundant **in legacy too**. Worth a grep sweep for other uses.

## ISSUE-088 — Approval Config: an admin who unticks every approver silently locks all non-admins out of PO approval

- **Surfaced:** 2026-07-15 (REFACTOR-1, Approval Config)
- **Severity:** **P2** — authorization; and it decides how ISSUE-028/030's button gate must be written
- **Status:** [ ] open — **needs a deliberate ruling, not a patch**

**Legacy contradicts itself on the empty-approver-list case, and the two readings are opposite:**

```js
_isPoApprover  (L21596):  if (approvers.length === 0) return isManager();                  // -> ALL managers may approve
_approvePO     (L21722):  isAdmin() || (approvers.length > 0 && approvers.indexOf(cuId) !== -1);  // -> ADMIN ONLY
```

**Our API follows `_approvePO`** — `purchase-orders/service.ts:942` `isApprover: approvers.includes(userId)`; `includes` on an empty array is always false. **So unticking everyone on this page silently makes PO approval admin-only.** Neither legacy's page nor ours warns.

**This is the gate the Purchase Orders agent could not wire** (ISSUE-028/030): legacy gates the Approve/Reject buttons on `_isPoApprover(tVal)` — approver-ness **plus a value ceiling** — and the PO list payload carries no value. **Whoever wires that button must pick one of these two readings on purpose.** Pick before building.

**Two more approval-semantic hazards on this page — flagged, acted on: NONE.**

- **A spending ceiling can display `0` while the server enforces `100000`.** Legacy `_saveApprovalCfg` (L21686) does `n(el2.value) || 100000` — typing 0 saves **100000**. Ours persists **0**. Downstream, legacy is *also* inconsistent: `_approvePO` (L21731) treats `0` as **unlimited**, while `_getUserApprovalLimit` (L21605) treats it as **100000**. Our API (`service.ts:940`) treats `0` as `DEFAULT_PO_APPROVAL_LIMIT = 100_000` — **the safer reading, and stricter than L21731**. No escalation, but the field shows a number that is not the enforced ceiling.
- **Per-user `approvalLimit` silently overrides the company limit and is invisible here.** `_isPoApprover` (L21599) and our `service.ts:937-940` both give `personalLimit` precedence. This page presents "Manager can approve PO up to (₹)" as *the* ceiling; any approver with a personal limit ignores it. **Legacy hides this too — so it is not a parity gap, it is a real UX hazard on an authorization screen.** Also note the ceiling applies to **every non-admin**, not just role `manager`, despite the label (L21731 + our `loadApprovalContext`).
- **Our footer tip** (page L479) has no legacy counterpart and was **kept** per the standing rule — but the `₹` trails the number (wrong for INR), and per the two points above the sentence is only true for approvers without a personal limit. **Approval-semantic text — not the agent's call to reword.**

## ISSUE-089 — Approval Config: deactivated users can be selected as PO approvers

- **Surfaced:** 2026-07-15 (REFACTOR-1, Approval Config)
- **Severity:** **P2** — a disabled account can hold approval authority over spending
- **Status:** [ ] open

**Legacy filters them out** (L21636):
```js
var users = (db.users||[]).filter(function(u){ return u.status !== 'Inactive'; });
```
**We do not.** `approval-config/routes/page.tsx:45` calls `useUsersList({ limit: 100, offset: 0 })` with no `isActive` filter, and `users/service.ts:49` only filters when passed one. **`isActive` is on the payload and never rendered** — the same unrendered-field smell as the Access Control page (ISSUE-086), but here the consequence is authorization rather than display.

**Fix:** pass `isActive: true` to the approver picker's query (and/or render the state so an admin can see it).

**Related, and safer than legacy:** legacy's save rebuilds `poApprovers` **from the DOM** (L21690-21694), so any approver not currently rendered would be **silently revoked**. Ours mutates a draft seeded from the server config, so approvers beyond the `limit: 100` page are **preserved**. Caveat: with >100 users, approvers past the first 100 are invisible on this page (but not revoked).

## ISSUE-090 — Alerts drill-down: 10 of 13 codes cannot render the columns legacy showed

- **Surfaced:** 2026-07-15 (REFACTOR-1, Alerts drill-down)
- **Severity:** **P2** — not cosmetic; the worst cases make the drill-down unusable for its purpose
- **Status:** [ ] open — backend (definitions' SQL + `columns`)

Legacy hard-codes per-code column sets (L22383-22416); we drive columns off the server's `columns` array. They disagree for **10 of 13** ported codes.

**The serious ones:**
- **AL-001 / AL-014** (POs approved today / POs overdue) lose **Item, Qty AND Rate** — our SQL is **PO-header-level with no line join**. A purchase user drilling "POs overdue" **cannot see what is on the PO**.
- **AL-007** (GRN today) loses **Item, Qty, QC Status** — same cause, GRN header with no lines.

**Single-column gaps:** SO link on AL-002/006/012/015; PO on AL-008; Reason on AL-009.

**Three are NOT real gaps:** Status on AL-004/005/018 — those alerts **filter on a constant status**, so legacy's badge was decorative.

**Two codes where our port is BETTER:** AL-011 has **no branch in legacy** and falls through to `JSON.stringify(r).slice(0,120)` (L22413-15); ours renders real columns. Legacy also caps rows (30 on AL-020, 20 on the else branch); ours renders all.

**Nothing was fabricated in the UI** (CLAUDE.md rule 1). Fix belongs in the definitions' SQL + `columns`.

**Also:** the alerts module is now **fully off shadcn** (all three pages). **`DEPT_TONE` (`lib/dept.ts:32`) is now orphaned repo-wide — zero consumers** — because legacy's drill header colours the dept with `--text3`, not a dept hue. Left in place (dept.ts was out of scope); deletion candidate.

**Inherited, as predicted:** AL-001/002/004/005/007/012/014 drill into `CURRENT_DATE` rule sets, so their row sets carry the ISSUE-065 pre-05:30 IST shift. AL-003/008/009/011/013/015/018 do not. ISSUE-084 also gates this page — any member can reach `/alerts/$code` for any code.

## ISSUE-091 — Backup: every destructive control traced and refused; and a card that would cry wolf

- **Surfaced:** 2026-07-15 (REFACTOR-1, Backup)
- **Severity:** P3 (a permanent do-not-build record + one real copy defect)
- **Status:** [-] destructive controls **won't-fix**; copy defect [ ] open

**`apps/api/src/modules/backup/service.ts:1-8` documents its own deliberate simplification** — restore, factory reset, hash-verified backups and auto-backup schedule are deferred because real backup discipline is Supabase auto + daily `pg_dump` → Backblaze B2 (RUNBOOK). **"Parity" on this page would mean building a tenant-wipe button.**

| Legacy control | Handler | What it actually does | Verdict |
| --- | --- | --- | --- |
| `📂 Import JSON Backup` | `_restoreFromJSON` L22160 | **L22207:** `Object.keys(data).forEach(k => db[k] = data[k])` — replaces every collection from an uploaded file | **REFUSED** — no endpoint exists, none should |
| `⚠ Factory Reset (Go-Live)` | `_factoryResetExecute` L21881 | **L21900:** `db[k] = []` across `_frClearCollections` — hard-deletes all transaction data | **REFUSED** — violates Rule 8 |

**These are NOT the same as Settings' `_factoryReset` (L16731)**, which batch-deletes *every* collection including users and `_settings`, then `localStorage.clear()`. `renderBackup`'s variant is the **scoped** go-live cleanup that preserves masters. Both are hard deletes; both refused; recorded as distinct (see ISSUE-087, ISSUE-082).

**A card correctly NOT built, for a subtle reason:** legacy's **LAST BACKUP** card reads `db._lastBackup`. Our `backup/service.ts:98` **hardcodes `lastBackupAt: null`** and nothing ever writes it. Porting the card would render a **permanent red "Never" seconds after a successful download**, while nightly B2 dumps run fine — **a false alarm on a live system**. The field is **a stub, not unrendered data**; that distinction matters.

**A real defect in our own copy:** `backup/routes/page.tsx:187` says *"contact the admin if you need a go-live cleanup"* — but the page is **admin-gated** (L78). **It tells the admin to contact the admin.** Reported rather than reworded; replacement copy is a product call.

**`/backup/download` verified against legacy `_doBackupDownload` (L22074):** legacy dumps all of `db` unbounded and unscoped; ours is admin-gated, company-scoped, `LIMIT 5000`/table over 30 curated tables. **Meets-or-exceeds on safety**; the truncation is the one regression and **the page already discloses it**. Correctly left wired.

**Unbuildable without backend (reported):** DATABASE SIZE + per-collection Size (legacy blobs the client-side `db`; ours needs `pg_total_relation_size`), hash-verified export, selected-collection export, CSV export, backup-file verification, audit checksum check, auto-backup schedule (legacy writes snapshots to **localStorage** — not a backup strategy).

## ISSUE-092 — Reports: 3 of 6 sidebar department links are dead; 12 of 20 reports unreachable by department

- **Surfaced:** 2026-07-15 (REFACTOR-1, Reports)
- **Severity:** **P2** — working reports that cannot be found from the nav
- **Status:** [ ] open — a naming decision spanning `sidebar.tsx` + the report registry

`components/shared/sidebar.tsx` (L105, 139, 179, 199, 260, 303) links to `?group=` values that **do not all exist**:

| Sidebar links to | Registry actually defines |
| --- | --- |
| Design ✓ · Production ✓ · Sales ✓ | Design (3) · Production (3) · Sales (2) |
| **Finance ✗ · Purchase ✗ · Store ✗** | Quality (4) · Operations (4) · Procurement (2) · Inventory (2) |

**Three sidebar links always render "No reports configured for this department."** Finance, Purchase and Store match no group that exists.

**And 12 of 20 reports are unreachable by department:** all 4 Quality, all 4 Operations, both Procurement (vendor-po-summary, open-po-ageing) and both Inventory (items-on-hand, stock-movement-log). They exist, they work, and no sidebar link points at their group. Only 8 are reachable that way.

**Fix:** decide one vocabulary. Either rename the registry groups to the sidebar's business words (Store/Purchase/Finance) or repoint the sidebar at the real groups (Inventory/Procurement/…) and add links for Quality + Operations. Spans `sidebar.tsx` and the definitions — **not a page-level fix**.

**Also on this page:**
- **Column-0 status cells rendered the WRONG colour (fixed).** Legacy builds one style string and **appends**, so a status keyword's `color` **overwrites** the column-0 cyan (L20090-20101). The port had it inverted: `color: ci === 0 ? 'var(--cyan)' : tintForCell(...)`. `_rptPR`'s summary is literally `[['Pending',3],…]` — **column 0 IS the status**. Only reading legacy's execution order catches this, not its output. Also restored `font-weight:600` on numeric cells, `700` on status cells, and the `text3` muting of a zero in column 0.
- **Silent row truncation.** Every definition caps at `LIMIT 1000` (`LIMIT 500` for vendor-po-summary + design-engineer-workload), and `reports/service.ts:43` sets `rowCount: result.rows.length` — so the header reads **"(1000 rows)" as if complete**. No flag exists to render a "first 1000" notice. Not browser math; the count is simply unknowably truncated.
- **ISSUE-065 mechanism 3 is surfaced HERE.** `/reports?group=Design` renders `design-issue-aging` (`definitions/design-issue-aging.ts:43`: `GREATEST(0, (CURRENT_DATE - di.raised_date))`) and `design-engineer-workload:33` inline. **Every aging figure is off by one between 00:00–05:30 IST.**
- **8 of 13 legacy reports have no port equivalent** (L20048-20062): PR Status, PO Status, JW DC Outward, JW DC Inward, Material at Vendor, PO vs GRN, Mfg Revenue, Issue & Tool Tracker. Backend registry work.
- **`tr.rpt-total` totals rows absent.** Legacy `_rptTbl` (L20107) emits a TOTAL row and defines `.rpt-total` in its **main** block (L350-351 — live, not print-only). No server report returns totals, and computing them client-side is the banned pattern. Reported, not built; `.rpt-total` is also unported in our theme.

**Architecture deliberately not copied:** legacy `/reports` is 13 hardcoded tabs rendering one report **inline**; our port is a 19-report registry index feeding `/reports/$slug` (filters + server-side xlsx export). Rendering inline would have **deleted the only route to the filter UI**. The chrome vocabulary was ported; navigation kept. Consequence: no chip is "selected", so all render in legacy's selected-tab style — grey unselected chips would drop legacy's per-report colour entirely.

## ISSUE-093 — Registry error #5: `/saved-reports` has no legacy counterpart (corrected)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Saved Reports — **the agent stopped without editing and reported**)
- **Severity:** P4 (registry accuracy)
- **Status:** [x] corrected 2026-07-15

`docs/page-registry.yaml` auto-assigned **`renderReportBuilder` (L17526) to ALL FOUR** `/saved-reports/*` routes. That renderer is the **drag-and-drop Excel builder** — Data Source chips (L17560), an Available Fields palette (L17565-70), three drop zones (L17574-94), and a Generate/Preview/Clear action bar (L17597-602). **It never enumerates saved reports.**

**It is already ported** — `saved-reports/components/builder.tsx`, imported by `routes/new.tsx:10` and `routes/edit.tsx:10`. So:
- `/saved-reports/new` + `/saved-reports/$id/edit` → `renderReportBuilder` is **correct**.
- **`/saved-reports` (list) → NO legacy counterpart.** `reportTemplates` appears at exactly **4 lines in 29k** — L17552 (`<select>` options), L17673 (`_rbSaveTemplate`), L17674 (`_rbLoadTemplate`), L21810 (collection list). **No renderer lists them.** Legacy exposes saved templates only as a dropdown.
- `/saved-reports/$id` (Run) → **unverified.** Legacy's builder has an inline Preview (L17601) but no separate run-a-saved-report screen. Verify before refactoring; it may be port-only too.

**Even under the most generous reading, the correct action was still to change nothing:** legacy has **strictly fewer** elements than our list — no description, no owner, no shared/private flag, no per-row Run/Edit/Delete, no empty state. Porting toward it would delete working features on a live system.

The agent **ruled out both plausible alternatives** rather than assuming: `renderReports` (L20047 — tabbed canned reports, a different page) and `renderReportMaster` (L23677 — CRUD over `db.reportTypes`, QC *document types*, a different domain despite the name).

**Root cause of registry errors, now visible across all five:** the auto-builder assigns **one legacy function to every route in a module**. That is right for genuinely single-screen modules and wrong wherever legacy multiplexes (tabs, globals, modals) or where our port split one legacy screen into several routes. Prior instances: `/delivery-challans` (`unknown` → `_ospDCRegister` L27419), `/design-projects/$id` (pointed at the LIST renderer; real target `_dpRenderDetail` L7623), 7 port-only pages, and a cross-agent claim about `renderJobQueue` that two agents disproved.

**Note:** our `/saved-reports` list is still on shadcn chrome — visually divergent from the rest of the app, but **there is no legacy markup to port it to**, so any chrome invented would be design, not porting. Left alone deliberately.

## ISSUE-094 — Print Templates: the SERVICE PO preview and Test Print render Delivery-Challan data

- **Surfaced:** 2026-07-15 (REFACTOR-1, Print Templates)
- **Severity:** P3 — an admin editing the SERVICE PO template sees the wrong document
- **Status:** [ ] open — `lib/test-print.ts`, outside a UI/JSX pass

`sampleDataFor()` (`apps/web/src/modules/print-templates/lib/test-print.ts:31`) checks `doc === 'PO'`, which **misses `'SERVICE PO'`** — so it falls through and returns the **Delivery Challan** bag. Service PO's allowed variables are `spoNo` / `spoDate` / `expenseHead` / `costCenter`, so both the on-page preview **and** the Test Print substitute those to blank and display `dcNo` instead.

**Fix:** add `'SERVICE PO'` to that branch with its own sample bag.

**The agent's call on the mock was right:** it renders a **blank** SPO No. rather than a bogus `DC No.: JWDC-99999` — *blanks are honest, wrong-doc data lies*.

**My brief was WRONG and the agent disproved it (4th time on this track).** I warned that `printJwDc`/`printOspDc` are fixed-layout, so claiming templates drive them would be trap 1. **Not true in our port:** `apps/web/src/lib/print/doc-print.ts:165` substitutes the blocks, and the PO / Service PO / OSP DC / JW DC detail pages all pass `templates.items` in. The page's "Changes apply to next print immediately" is **honest**. **Trace before asserting.**

**Mapping confirmed independently** via the legacy router (**L2441:** `printtemplates: ()=>renderPrintTemplates()`), so `routes/editor.tsx` is correctly named — it *is* an editor, not a list. Registry right this time.

**Write paths traced, none added:** `PUT /print-templates/:key` archives the old content to a revision then updates; `restore-default` archives then soft-deletes so the factory default applies. Both match legacy `_ptSaveContent` / `_ptRestoreDefault`, and both were already wired.

**Also:**
- **`revisionCount` is uncapped but the modal shows `REVISIONS_SHOWN = 5`** — a block can link "🕐 8 revisions" and open 5. Server-owned figure; no browser math added. ("Last 5 versions kept" is honest: the API keeps full history per Rule 8; only the list endpoint caps.)
- **`lastEditedAt` was an unrendered payload field** — now rendered (via date-fns; no local `fmt()` added, per ISSUE-040).
- **Legacy classes absent from our theme:** `.pt-vars-panel` / `.pt-var-chip` (L191-193) and `.pte-block` / `.pte-edit-icon` — the latter injected at runtime (L15102-08). **Not approximated with invented classes**; computed styles mirrored inline against tokens.
- **A smart scoping of ISSUE-067:** literal hex was **kept inside the paper mock**, because legacy does the same — that is simulated white paper, not app chrome, so the light-theme token rule doesn't apply there.
- **Legacy's hover-edit tip dropped** ("✎ Hover any block for the edit icon") — it needs legacy's runtime-injected hover CSS we don't have (trap 1); our working "✎ Edit" link, which legacy lacks, was kept.
- **A 4th doc type (SERVICE PO) kept** — legacy has only 3. Standing rule: legacy has fewer → keep ours.

## ISSUE-095 — **APP-WIDE:** capped results are presented as complete. Legacy disclosed truncation; we don't.

- **Surfaced:** 2026-07-15 (REFACTOR-1 — consolidating six independent findings across batches 11-22)
- **Severity:** **P2** — the port is **less truthful than the system it replaces**, in six places, one of which displays money
- **Status:** [ ] open — needs a server-side `truncated` flag + a UI convention, decided once

Legacy's report builder is **scrupulous** about this (L17626, L17633):
```js
'Data ('+filtered.length+' rows'+(filtered.length>50?' — showing 50':'')
'Excel will contain all '+filtered.length+' rows.'
```
It shows the **true** count **and** discloses that the view is a subset.

**Our port shows the capped count as if it were the total, in six places:**

| Page | Renders | Reality |
| --- | --- | --- |
| **SC Dashboard** | **"Grand Total: ₹X"** | reduces a `LIMIT 100` array (`sc-dashboard/service.ts:190`) — **a money figure that silently freezes** |
| Saved report run | "5000 rows" | `ROW_LIMIT = 5000` (`saved-reports/runner.ts:38`), `rowCount = result.rows.length` (`service.ts:301,325`), no indicator |
| Reports run | "(1000 rows)" | 12 definitions `LIMIT 1000`; `vendor-po-summary:69` + `design-engineer-workload:98` `LIMIT 500`; `reports/service.ts:43` sets `rowCount = result.rows.length` |
| Design Tracker | rows just stop | `PAGE_SIZE = 100`, `offset` hard-wired 0, no pagination, no notice |
| Prod SO / JW lists | rows just stop | `limit: 200`, `total` fetched and **discarded** |
| Outsource Jobs | four tiles | computed in-browser over a `PAGE_SIZE = 100` array |

Plus: saved-reports' **summary** silently caps at `SUMMARY_LIMIT = 200` (`runner.ts:39,267`) with no indicator, and legacy rendered **all** groups **plus a TOTAL row**.

**This is not a parity gap — it is a truthfulness regression.** A count that is capped and undisclosed is indistinguishable from a complete result, and users make decisions on it.

**Fix:** add a `truncated: boolean` (or a true `COUNT(*)`) to the response shapes, and adopt one UI convention — legacy's own is a good model: show the true count, disclose the subset. **A UI-only fix would be a guess**; every agent correctly refused to invent one.

**Related, already logged:** ISSUE-043 (count query omits the filters the rows apply — 6 modules; on JW DC it ships "Showing 1–3 of 412" with Next onto empty pages).

## ISSUE-096 — Registry error #6: `/saved-reports/$id` (Run) has no legacy counterpart (corrected)

- **Surfaced:** 2026-07-15 (REFACTOR-1 — **the agent settled it with 4 proofs and made zero edits**)
- **Severity:** P4 (registry accuracy)
- **Status:** [x] corrected 2026-07-15 — now `No Legacy Counterpart`

**Second error in this module from the same auto-assignment.** Four independent proofs:

1. **Legacy's router has exactly THREE report keys** — `reportmaster` (L2403), `reports` (L2447), `reportbuilder` (L2448). **There is no run-a-saved-report screen.**
2. **`_rbLoadTemplate` (L17674) — the only way to consume a saved template — navigates nowhere.** It repopulates builder state, then sets **`_rbPreview = ''`** and re-renders. Legacy drops you on the **builder with the preview explicitly cleared** — the exact opposite of our run page, which auto-runs and shows results.
3. **Preview is a sub-panel, not a screen.** `_rbDoPreview` (L17608-17636) assigns a string to `_rbPreview`, which `renderReportBuilder` splices into its own output at L17603. It belongs to `new.tsx`/`edit.tsx` (ported as `components/result-table.tsx`).
4. **`run.tsx`'s markup has zero legacy analogue** — back link, name/description/meta header, Edit button.

Alternatives ruled out with evidence: `renderReports` (L20047, hardcoded canned tabs) and `renderReportMaster` (L23677, CRUD over `db.reportTypes` = QC document types).

**2 of 4 `/saved-reports/*` routes are port-only.** `renderReportBuilder` correctly serves only `new` + `edit`.

**The agent also corrected me:** I briefed `LIMIT 1000`; this module's cap is **`ROW_LIMIT = 5000`** (`runner.ts:38`). The 1000 belongs to other report definitions. **5th correction to one of my assertions.**

## ISSUE-097 — Report Builder: column reorder has never worked, in either system

- **Surfaced:** 2026-07-15 (REFACTOR-1, Report Builder)
- **Severity:** P3 — the label says order matters and the mechanism does not exist
- **Status:** [ ] open — worth actually building

Legacy's zone is labelled **"Excel Columns (order = Excel order)"** (L17575) and renders `::` drag grips on every chip (L17536). But **`_rbDropCol` (L17513) rejects `COL:` payloads outright** — so the grips are inert **in legacy, everywhere**. Our chips carry the same inert `COL:<i>` payload.

**The grips were deliberately NOT ported** (trap 1 — they advertise a no-op). But since **order genuinely determines Excel column order**, this is worth implementing properly rather than matching legacy's broken state.

**Built on this page after tracing (legacy's primary action, previously missing):**
- **`📄 Generate Excel`** (L17599) — our port only exposed it *inside* preview results. Traced end-to-end: `onExcel(buildSpec())` → `apiDownload('/saved-reports/preview/export.xlsx')` → `saved-reports/routes.ts:88` → `previewAdHocSpec` → xlsx. Takes an **unsaved spec**, exactly as legacy's `_rbGenExcel` (L17638) builds from its globals. No save side-effect, no id required. **Wired.**
- **`All` / `Clear`** column buttons (L17576-77) — were missing.
- **`Select a data source to start.`** (L17561) — zones/actions now gated on a source, mirroring legacy's early return.

**Not built, correctly:**
- **`N records match` (L17602)** — legacy counts live from its in-memory `db`. We'd need a server count; `rowCount` only exists after a preview and **goes stale the moment the spec changes**. *A stale count is worse than none.* Needs `POST /saved-reports/preview/count`.
- **Preview stat tiles (L17612-16)** — legacy computes them with `filtered.reduce` in the browser. `RunAdHocResponse` carries no column totals; browser math on server-owned figures is banned. Needs `columnTotals` on `runAdHocResponseSchema`.
- **Load Template dropdown (L17558/L17674)** — it is legacy's *only* saved-report surface, and our `/saved-reports` list + `/$id/edit` supersede it. Building it would duplicate an existing screen.
- **`prompt('Template name:')`** (L17673) — our Report Details panel is better and removing it would break saving.

**Light-theme call (ISSUE-067):** legacy's Generate button is `btn-primary` + inline `background:var(--green); color:#0f172a` — **near-black text on green**, which assumed the dark theme. Used `.btn-success`.

**`Builder` props contract UNCHANGED** — `Props`/`BuilderInitial`/`SaveInput` byte-identical, so `routes/edit.tsx` compiles untouched and correctly inherits the same visual changes (same legacy screen) plus Generate/All/Clear, since it already passes `onExcel`.

## ISSUE-098 — Reports: the index and run pages now tint the same cell differently

- **Surfaced:** 2026-07-15 (REFACTOR-1 — **created by refactoring two pages of one module independently**)
- **Severity:** P3 — an internal inconsistency neither page had before
- **Status:** [ ] open — needs a ruling on which is canonical, then one shared helper

`/reports` (`list.tsx:317-350`) has a `statusColor` **superset** — ~14 keywords legacy never colours (`Open`→red, `Completed`, `Released`, `Resolved`, `In Progress`, `Critical`/`Major`/`Minor`/`Low`…). `/reports/$slug` (`run.tsx`) now transcribes **legacy's exactly**.

**So the same cell tints differently on the two pages.** `Open` is the sharp case: a live PO status that renders **red** on the index and **uncoloured** on the run page.

**This is a self-inflicted divergence** — the index agent kept the superset (correctly, per "never delete a working feature"); the run agent transcribed legacy (correctly, per "legacy is the spec"). **Both followed the rules; the rules disagreed at a module boundary.** Worth remembering when refactoring sibling pages independently.

**Fix:** decide which mapping is canonical, then extract one shared helper — `cellStyle`/`formatCell`/`statusColor` are now duplicated in both files.

**Also fixed on the run page — a real UX bug:** `useReportList()` had **no `isLoading` branch**, so **every cold load of `/reports/$slug` flashed "Report not found"** before the definition list arrived. Not-found now only renders once the list resolves.

**And a 9th invented class in the skill:** `.btn-outline` (prescribed at its Action-buttons example + report template) exists in **no** stylesheet. Real set: `.btn`, `.btn-sm`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-icon`. **Zero app usages** — contained, because agents grep first. Skill corrected, and it now carries a **grep-verified vocabulary section** listing the real classes and the confirmed-absent set.

## ISSUE-099 — Forms: create and edit modes have drifted apart from each other

- **Surfaced:** 2026-07-15 (REFACTOR-1, Item form + Client form — **found independently by both**)
- **Severity:** P3 — but it explains a whole class of form defects
- **Status:** [~] fixed on `items` + `clients`; **4 shared form files remain** (machines, operators, vendors, cost-centers)

**The structural insight:** legacy builds **one** form for both modes — `itemForm(itm)` (L11523-11559) serves `addItem` (L11598) and `editItem` (L11609); `clientForm(cl)` (L12996-13005) serves `addClient` (L13006) and `editClient` (L13018). Mode is just `itm.id` truthy ⇒ Code goes readonly (L11531). **Create and edit are field-identical by construction.**

Our port renders both modes from one component too — **but the modes had drifted apart:**

| Module | Drift found |
| --- | --- |
| **Clients** | Address was `<input>` in create and **`<textarea>`** in edit; all 3 placeholders **missing in edit only**; submit read `Create Client` vs `Save changes` (legacy: **`Save`** both); title read `Edit Client` where legacy has **`Edit Client — {name}`** (L13022) |
| **Items** | 6 legacy placeholders missing or create-only; **Drawing File was at position 5, half-width** — legacy has it **last** and `form-full` (L11551); invented copy *"Code cannot be changed after creation."* (legacy conveys readonly via styling alone) |

**Root cause on Clients:** the earlier uncommitted pass applied the Address `<textarea>`→`<input>` fix **to the create form only**. The edit was *correct*; it was **half-done** — the same "marked refactored while still divergent" pattern as the Purchase Orders pass.

**Systemic, and worth one sweep — legacy's `showModal` footer renders `Cancel` / `Save`** (L28026-27). **Ten of our forms** render `Create …` / `Save changes` instead: `clients`, `cost-centers`, `operators`, `machines`, `nc-register`, `plans`, `purchase-orders`, `purchase-requests`, `goods-receipt-notes`, `job-work-orders`. Fixed on `items` + `clients`.

**Check the remaining 4 shared form files for the same create/edit drift** — one file serves both routes, so the divergence is invisible unless you diff the two modes against each other.

## ISSUE-100 — Trap 1 generalises from features to LIMITS: a 5 MB cap nothing enforces

- **Surfaced:** 2026-07-15 (REFACTOR-1, Item form)
- **Severity:** P3
- **Status:** [ ] open — the label is honest now; the cap still isn't enforced

Legacy checks the upload size and rejects (L11568):
```js
if (f.size > 5*1024*1024) { toast('Max 5 MB','err'); return; }
```
and labels the field **"(Image/PDF, max 5MB)"**.

**Neither `items/components/drawing-upload-field.tsx` nor `apps/web/src/lib/storage.ts` `uploadFile()` checks size at all.**

**The agent deliberately did NOT port legacy's label text** — shipping "(max 5MB)" when nothing enforces 5MB is **the same trap as a ★ on a schema-optional field** (the Design Projects precedent). It shipped **"(Image/PDF)"** — the part `accept="image/*,.pdf"` actually enforces.

**This generalises the trap-1 rule:** *never ship text describing a constraint the system doesn't enforce* — not just features it doesn't have. Complete the label to legacy's exact wording **once the size check lands**, not before.

**Also on this page, reported not rewired:** legacy's upload registers the file (`_fsUploadAndRegister`, L11569: `category:'drawing'`, `docType:'Item Drawing'`, `itemCode`, `itemName`) and falls back to a local data URL on failure (L11583-95); ours does neither. And legacy `addItem` (L11603) pre-checks duplicate codes **client-side** — ours relies on the API, which is **correct per CLAUDE.md rule 1**; not "fixed".

## ISSUE-101 — Our red ★ is a port invention: legacy has NO `.req` class, and its stars are grey

- **Surfaced:** 2026-07-15 (REFACTOR-1, Item form)
- **Severity:** P4 — app-wide convention vs legacy; needs a ruling, not a page-level flip
- **Status:** [ ] open

**Verified:** `grep -c 'class="req"'` on the legacy file returns **0**. Legacy has **57 literal `★`** characters written directly into `.form-label` text, inheriting **`--text2` (grey)**.

Our `.form-label .req { color: var(--red) }` is a **theme-level addition**, now used in **35 files**. So **every required marker in the app is red where legacy's is grey.**

Same family as the purged `form-label-required` (ISSUE-024) — except this one is real, works, and is the established convention across the app. **Correctly NOT flipped on one page**: it's a cross-page decision.

**Related:** legacy sometimes writes `★` as literal label text and sometimes our port uses `.req` — check which, per form, before "fixing" either.

## ISSUE-102 — Orchestrator: my briefs cite theme line numbers that I invalidated myself

- **Surfaced:** 2026-07-15 (REFACTOR-1, Item form — agent's "skill drift #10")
- **Severity:** P4 (process)
- **Status:** [x] understood — stop citing theme line numbers

I have been briefing agents that `.req` lives at `innovic-theme.css:566`. **It is at 639.**

**I moved it.** Porting `.tbl-frozen` (L119-122 equivalent), `.tag`, `.task-unread` and `.task-linked-ref` inserted ~73 lines **above** it. Every theme line number I quoted before those ports is now stale, and I kept re-quoting the old ones from memory.

**This is the same failure as ISSUE-071** (quoting `grep -c` — a line count — as an occurrence count): **I asserted a derived number instead of having the agent derive it.** Agents caught both.

**Rule:** in briefs, name the class, not the line. If a line reference is genuinely needed, re-grep it at brief time — never carry it forward from an earlier batch, especially in a file this track has been editing.

**Known stale-workaround consequence of the same mid-track ports:** pages refactored **before** a class was ported may still carry a workaround for its absence. Confirmed: `items/routes/list.tsx:13-14` has a comment claiming *"legacy's `.tag` class has no port … and inventing one is not allowed"* and uses `.badge.b-grey` for the UOM cell — but **`.tag` was ported in batch 5**, and legacy L11492 uses `.tag` there. `route-cards/routes/list.tsx` (Rev cell, legacy L10107) is the other known case. **Both need a small follow-up sweep.**

## ISSUE-103 — Item detail: the first page to fix truncation honestly; and legacy's Balance column is unportable

- **Surfaced:** 2026-07-15 (REFACTOR-1, Item detail)
- **Severity:** P3 → fixed
- **Status:** [x] fixed 2026-07-15

**ISSUE-095 fixed correctly here** — the first page to do so. The stock ledger requested `limit: 20` and presented it as the complete history. Now renders **"Showing latest 20 of N"**, shown *only when actually capped*, using the server's no-LIMIT `total`. **No browser math** — `total` is server-owned.

**And the refusal that follows from it:** legacy's ledger has a **Balance** column (L11821) computed as a **running total in the browser**, accumulating from the start. **On a capped, newest-first list that number would be flat wrong** — plausible-looking and meaningless. Correctly **not ported**.

**A trap in legacy's data model, logged before anyone hits it:** legacy's ledger does `isIn = t.type === 'IN'` (L11823) — **binary**. Our schema has a **third** type, `adjust`, which that expression would silently classify as an **outward move**. **Any future port of legacy's IN/OUT split must handle `adjust` first.**

**Also fixed:** `r.remarks` was in the schema and **rendered nowhere** (legacy shows it at L11831); column order → legacy's sequence (L11833); panel title `Stock History` → **`Stock Ledger`**; Ref No. → purple (token, not legacy's literal).

**Registry wrong a 7th time — proven, not assumed:** `renderItems` (L11481) is the **list**; its own row `onclick` (L11485) and View button (L11495) both call **`viewItemDetail` (L11743)**, which ends in `showModalLg('Item: …')` (L11810). Same auto-builder failure mode.

## ISSUE-104 — 🔴 **Legacy's `<select>` options are NARROWER than our schemas. Porting them faithfully silently overwrites live data.**

- **Surfaced:** 2026-07-15 (REFACTOR-1 — found **independently by the Vendors and Machines form agents**)
- **Severity:** **P2** — a silent-write vector, introduced *by* correct parity work
- **Status:** [ ] open — **needs a one-off DB audit BEFORE these ship**

**A defect class nobody anticipated.** Legacy's dropdowns encode its own narrower assumptions. Our schemas are looser, and our previous controls (free-text inputs, number inputs) accepted values legacy's selects cannot represent. **Replacing an input with legacy's select is faithful — and it makes any out-of-range stored value unrepresentable, so it renders as the fallback and gets rewritten on the next save.**

| Page | Legacy control | Our schema | The silent write |
| --- | --- | --- | --- |
| **Vendors form** | Rating `<select>` **A/B/C** (L27853-54) | `rating: z.string().max(8)` — free text | Legacy's own scorecard (L27824) defines **`D = below 40`**. A stored `"D"` now renders **`— None —`** and **is overwritten on save**. |
| **Machines form** | Shifts/Day `<select>` **1/2/3** (L13119-20) | any positive int; the old **number input accepted 4+** | A row with `shiftsPerDay > 3` now renders **"1" selected** and **any save rewrites it**. |

**Legacy behaves identically in both cases** — so the port is *correct*. That is exactly what makes this dangerous: the parity work is right and the consequence is data loss.

**Required before shipping:** query `vendors.rating NOT IN ('A','B','C','')` and `machines.shifts_per_day > 3`. If either returns rows, decide per case — widen the select, or accept the rewrite knowingly.

**A third instance was correctly REFUSED for the same reason:** the Vendors agent declined to change Address from `<textarea>` → `<input>` (legacy L27849 uses an input), because the browser would **silently strip newlines from any multi-line address entered since the port went live**. Same shape: faithful change, silent data loss.

**⚠️ AND THE TWO AGENTS DISAGREED — this needs ONE ruling applied to both.** The **Clients** agent made the **opposite** call: it changed Address `<textarea>` → `<input>` in edit mode to match legacy *and* its own create mode. Both agents reasoned carefully; both followed the rules; they reached opposite conclusions on the same question. **The Clients change carries the newline-flattening risk the Vendors agent refused.** Decide once: are `addressLine1` fields single-line (favouring `<input>`, matching the field name and legacy) or multi-line (favouring `<textarea>`)? Then apply it to both.

**A related trap correctly avoided:** legacy's Rating select has **no empty option**, so it **auto-selects "A"** — a new vendor silently gets a rating nobody chose. Our schema marks rating optional. The agent added `— None —` rather than port the bare select, because a bare select would have **invented data**. (`— None —` precedent: `capa/routes/list.tsx:417`, `design-projects/routes/detail.tsx:1028`.)

## ISSUE-105 — Create/edit form drift: 4-for-4, and the mechanism is duplicated JSX

- **Surfaced:** 2026-07-15 (REFACTOR-1, batches 23-24)
- **Severity:** P3
- **Status:** [x] fixed on clients, items, operators, machines, vendors — **the structural cause remains**

**Confirmed on every shared form file checked: 4-for-4.** Legacy builds **one** form for both modes (`itemForm` L11523, `clientForm` L12996, `machineForm` L13113, `operatorForm` L13726, `vendorForm` L27834) — mode only flips things like Code→readonly. **Create and edit are field-identical by construction.** Ours had drifted:

| Module | Drift (all **edit-only** unless noted) |
| --- | --- |
| Clients | Address `<input>` in create vs **`<textarea>`** in edit; 3 placeholders missing |
| Items | 6 placeholders missing/create-only; Drawing File at position 5 half-width vs legacy's **last + `form-full`** |
| Operators | Name + Linked User placeholders missing |
| Machines | **all 3 placeholders missing AND the ★ dropped** on Machine ID |
| Vendors | only `autoFocus` live — but see below |

**The drift is invisible against legacy alone.** Each mode matched legacy on nearly everything; the divergence only appears when you **diff the two modes against each other**. Every agent that found it did so that way — the Operators agent put it best: *"both missing placeholders were edit-only — invisible against the legacy alone, visible only mode-vs-mode."*

**ROOT CAUSE (ISSUE-104's sibling) — `vendor-form.tsx` has NO shared field block.** `CreateVendorForm` and `EditVendorForm` are **two fully duplicated JSX bodies**. That is the mechanism that produced the drift everywhere else. The agent verified them byte-identical **by script, not by eye**, and correctly did **not** extract a shared component (structural change, not markup). **Recommend ruling on extraction — it is the only fix that stops this recurring.**

**Cause on Clients specifically:** the earlier uncommitted pass made the *right* fix (`<textarea>`→`<input>`) and applied it **to the create form only**. Not wrong — **half-done**. Same shape as the Purchase Orders pass marked "Refactored" while carrying the defect it was meant to fix.

**Systemic footer fix — legacy's `showModal` renders `Cancel` / `Save`** (L28026-27). Ten of our forms rendered `Create …` / `Save changes`. **Fixed on items, clients, operators, machines, vendors.** Remaining: `cost-centers`, `nc-register`, `plans`, `purchase-orders`, `purchase-requests`, `goods-receipt-notes`, `job-work-orders`.

**Invented copy removed** (legacy has zero help text on these forms): *"Code cannot be changed after creation."* (items, machines), *"Used by SO Costing to value machine time."* (machines). `.innovic-input[readonly]` already carries the readonly affordance — it is the ported equivalent of legacy's inline `background:var(--bg4);color:var(--text3)`.

## ISSUE-106 — Machines: the maintenance schedule doesn't exist in our data model

- **Surfaced:** 2026-07-15 (REFACTOR-1, Machine form)
- **Severity:** P3 — a whole legacy subsystem with no port
- **Status:** [ ] open — spans schema + API + UI

Legacy's `machineForm` collects **`maintCycleDays`** and **`lastMaintDate`** (L13130-31), persists them (L13142/L13150), derives the **🔧 Maint column** on the machine list (L13074-83), and maintains a **`maintLog`** via `_logMaint` (L13163).

**Neither field exists** in `packages/shared/src/schemas/machine.ts` or the database. Not a form fix — schema + API + UI. (This is why the Machines *list* agent reported the 🔧 Maint column as unbuildable back in batch 2.)

**Also on this page, reported not applied:**
- **Capacity/Shift default `8`** (L13118) — changing a default changes what gets written. **Your call.**
- **Status vocabulary mismatch.** Legacy: `Running` / `Idle` / `Under Maintenance` (L13124). Ours: `Idle` / `Running` / `Down` / `Maintenance`. **Kept ours** — `Down`/`Idle` are read by **alert AL-013** and rendered by the list and detail pages. The column is free-text `varchar(32)` with no DB enum, so both vocabularies can coexist.
- **Hour Rate's green 2px border + bold input** (inline, L13122) — no class exists for a green-bordered bold input; **not approximated, not invented**. Only the *label* colour ported, via the real `.green` — an exact token match for legacy's `color:var(--green)`.

**Operators — two refusals, both correct, both needing your ruling:**
- **`Operator ID ★` not added** (legacy L13730). `code` is `.optional()` in the create schema and **`.omit()`-ed entirely** from the update schema — the server generates `OP-###`. Legacy stars it because *there* it is user-typed. Starring ours advertises a constraint nothing enforces (Design Projects precedent).
- **Operator ID not made editable on create** (legacy L13731 lets you type one and client-checks duplicates with a toast, L13752). Ours is `readOnly` + server-generated with no client check — flipping it would **push users into an unguided server conflict**.
- Legacy's placeholder is the **computed next ID** (`nextId()`, L13728); we can't produce that client-side without browser math over the full operator list, so `"Auto-generated on save"` stands.

**Vendors — same shape:** legacy stars Vendor Code (L27837) and lets users type/override it; ours is `optional()` + server-generated `VND-###` + readOnly. ★ correctly not added.

## ISSUE-107 — ISSUE-104's third shape: a select with no empty option, over a nullable free-text column

- **Surfaced:** 2026-07-15 (REFACTOR-1, Cost Center form)
- **Severity:** P2 — silent overwrite; **pre-existing, present in legacy AND our port**
- **Status:** [ ] open — not introduced by this track, not fixed by it

`costCenterSchema` types `department` and `type` as **`z.string().nullable()`** (max 64) — and the schema file *comments the intent*: stored as text, **not enums**, "so adding a department doesn't need a migration."

Both our selects offer only legacy's **9 departments / 3 types**, with **no empty option**. So:

- `department: null` → renders **`Production`**, and **any save writes it**
- `type: null` → renders **`Manufacturing`**, same
- an out-of-list value inserted via API or import (e.g. `"Finance"`) → same silent rewrite

`DEFAULTS` + `detailToFormValues` **already coerce null → 'Production'/'Manufacturing'**, so this predates the refactor. **Legacy has the identical flaw.**

**Why this is a distinct shape from ISSUE-104's other four:** those were *narrowing* — legacy's option list is a strict subset of our schema's range. This one is a **column that was deliberately left open-ended** being rendered through a closed control with no escape value. The fix (`— None —`) is a control legacy lacks, so it cannot come from parity work — it needs a ruling.

**Required audit, alongside ISSUE-104's two:**
```sql
SELECT id, code, department, type FROM cost_centers
 WHERE department IS NULL OR type IS NULL
    OR department NOT IN ('Production','Quality','Maintenance','Stores','Design','Sales','Admin','Purchase','Dispatch')
    OR type NOT IN ('Manufacturing','Service','Overhead');
```
(Confirm the exact option lists against `_addCostCenter` L17191 before running.)

**Legacy-side asymmetry recorded — a first for this track.** Every other master builds ONE form for both modes (ISSUE-099), making them field-identical by construction. Cost Centers has **two separate builders ~20 lines apart**, and they genuinely differ:

| | `_addCostCenter` L17191 | `_editCostCenter` L17213 |
| --- | --- | --- |
| Code | **★ + `font-weight:700`** | no ★, muted readonly |
| Name placeholder | `e.g. Machine Shop Floor` | **none** |
| Desc placeholder | `Brief description…` | **none** |
| Status field | **ABSENT** (hardcodes `'Active'`) | **present, LAST** |

So **part of our create/edit drift here was inherited, not introduced.** Ported per-mode rather than unified. **Our port had also drifted independently** — `form-grid-3` where legacy is 2-col, an invented `CC-001` placeholder legacy has in neither mode, Status 3rd instead of last, and invented `form-help`.

**Kept against legacy (per "never delete a working feature"):** Status stays in create mode — `createCostCenterInputSchema` accepts `isActive`, so legacy's hardcode would remove a working field. Appended **after** the 5 legacy fields so legacy's order is untouched.

**Footer swept:** `Add Cost Center` / `Save changes` → **`Save`** (legacy `showModal`, L28026-27). Cost-centers is now off the ten-forms list. Remaining: `nc-register`, `plans`, `purchase-orders`, `purchase-requests`, `goods-receipt-notes`, `job-work-orders`.

## ISSUE-108 — Route Card edit: RC No. can be cleared, and the schema guarantees a 400

- **Surfaced:** 2026-07-15 (REFACTOR-1, Route Card form)
- **Severity:** P3 — an unguided server error reachable by clearing one field
- **Status:** [ ] open — needs a ruling; correctly NOT fixed in the refactor

`updateRouteCardInputSchema.code` is **`.min(1)`**, but the form has no guard and submits `header.code.trim()`. **Create allows blank** (the server auto-generates). One control, two requirednesses, no client signal — clear the field in edit mode and you get a **guaranteed 400** with nothing explaining it.

**The agent correctly did neither available "fix":** no `★` (legacy has **no RC No. field at all** — starring it would invent a legacy affordance), and no client-side validation (that's logic, and CLAUDE.md rule 1 puts it server-side). **This needs a design ruling**, not a markup change.

**Same family as the Operators refusal** (ISSUE-106): a server-generated code that's optional on create and constrained on update, rendered through one control.

## ISSUE-109 — Route Card: QC Operation is free text where legacy is a bound select that auto-fills cycle time

- **Surfaced:** 2026-07-15 (REFACTOR-1, Route Card form)
- **Severity:** P3 — a missing binding, not a missing label
- **Status:** [ ] open — needs a qcProcesses fetch; not built

Legacy L10215 renders QC operations via **`_selQCProcesses` (L23516)** — a green-bordered `<select>` over **active `db.qcProcesses`** — and selecting one **auto-fills the op's cycle time from `defaultCycleTime`**. Ours is a **plain text input**: any typo becomes a new "process", and cycle time is always hand-entered.

**Sibling gap on the same form:** OSP process auto-fill is absent too — legacy's `_rcAutoFillOspVendor` (L6962) plus the `dlRcOspP_` datalist populate **vendor and lead-days** from `db.ospProcessConfig`.

Both need API calls this page doesn't make. Not built — correct: inventing a client-side process list would fabricate master data.

**Also confirmed here:** `qcRequired` is fetched and **rendered by no control anywhere** in Route Cards — on this form it's derived from `opType` alone. (The Route Card detail agent flagged the same field independently.)

## ISSUE-110 — `.blue` does not exist in the theme, so legacy's blue Program header is unshippable

- **Surfaced:** 2026-07-15 (REFACTOR-1, Route Card form)
- **Severity:** P4 — a one-token gap in an otherwise complete colour vocabulary
- **Status:** [ ] open — needs a theme ruling, not a page fix

The theme ships bare `.cyan` / `.amber` / `.green` / `.red` as text-colour utilities. **There is no `.blue`** — even though **`--blue: #2563eb` is defined**. Legacy's `Program` column header (L10262) is blue, and there is no way to render it without either adding a rule or inlining a literal.

**The agent did neither** — correct, and the discipline that ISSUE-063's `.stat-card.blue` episode taught (where *I* added a rule legacy doesn't define). But this case is the **inverse**: legacy genuinely defines and applies the colour; **our theme is the one that's incomplete.** Adding `.blue { color: var(--blue) }` is a one-line, zero-risk completion of an existing pattern — but it's a theme change, so it needs a ruling rather than a drive-by.

**Related token debt, same module:** `#7c3aed` survives as a literal in **`lib/print-route-card.ts:46`** and **`routes/list.tsx:264`** — the latter despite list.tsx being refactored this session. **`--purple` is exactly `#7c3aed`**, so both are lossless swaps. Neither file belonged to this agent.

### Route Card form — legacy behaviour deliberately NOT copied (all correct)

- **`saveRouteCardForItem` (L6918) is LOSSY.** Its `clean` map (L6921-24) keeps only `machineId, operation, cycleTime, program, toolNo, toolDetails` and **silently discards `opType`, `isOSP`, `ospVendorCode`, `ospVendor`, `ospLeadDays`, `qcRequired`**. **Legacy's own edit UI builds OSP/QC ops that its own save handler then throws away.** Ours persists them. Reported, not rewired. **Add to the do-not-copy list.**
- **QC/OSP colspan rows not ported.** L10217 collapses Program/Tool No./Tool Details into `colspan=3 "— QC Inspection step"`; L10229-31 steals the Cycle column for lead-days. Porting would **delete editable fields our schema stores** (cycle time on OSP ops, program/tooling on QC ops) on a live system.
- **ISSUE-104 hit, inverted (2nd instance):** legacy's OSP lead-days input is **`min="1"`** (L10229); our `ospLeadDays` is `z.number().int().nonnegative()` — **`0` is valid and storable**, so porting the floor would make stored zeros fail validation. Same shape as the BOM qty case. *(Cycle time was safe: legacy's `step="0.01" min="0"` already matches `z.number().nonnegative()`.)*
- **`_rcCheckExisting` (L6981) resets `_rcEditOps` on every item change** — destroys typed ops. Not copied.
- **Type column kept** (ours only): legacy sets op type solely by which `+ Add` button you press, with **no way to convert an op afterwards**.
- **Dead code in legacy noted:** `editRouteCard` L10173-10184 builds an `opsHtml`/`body` pair via `jcModalOpsHtml()` that the L10186 template literal **overwrites**. Ignored, correctly.

**Real defect fixed (ours had it too):** `emptyProcessOp()` seeded `cycleTimeMin: '0'`, so every fresh op row showed a literal `0` the user had to clear. Legacy renders `${op.cycleTime||''}`. Now `''`; submitted value unchanged (`Number('') || 0` → `0`). Also fixed edit-mode mapping so a stored `0` blanks — create/edit parity.

## ISSUE-111 — On-hand stock has no home in the Item read shape, and it blocks three legacy features

- **Surfaced:** 2026-07-15 (REFACTOR-1 — **confirmed independently by the BOM form and BOM detail agents**)
- **Severity:** P2 — a missing field, not a missing label; spans schema + API + UI
- **Status:** [ ] open

Legacy's BOM renderers show each child item's **on-hand quantity**, green when `>0` (L8464/8477). **We have nowhere to read it from:**

- `packages/shared/src/schemas/item.ts` — **no `stockQty`**
- `apps/api/src/db/schema.ts:218` — the `items` table has only **`min_stock_qty`**, which is a **low-stock threshold, not on-hand**. Easy to mistake for the field; it isn't.
- `apps/api/src/db/schema.ts:2911` — the real **`stock_qty` is on `party_materials`**, a different entity entirely.

On-hand would have to be derived from the stock ledger. **Doing that in the browser is CLAUDE.md rule 1** — both agents refused, correctly, and neither invented a column.

**Three surfaces blocked by this one field:**
1. BOM detail — legacy's `Stock` column (L8464/8477)
2. BOM form — same column, reported by the form agent in the previous batch
3. **`_explodeBOMMaster` (L8833-8845)** — legacy's **shortfall** logic, an **entirely unported feature** that needs the same field. *This is the one that matters:* it's the reason the column exists.

**Fix shape:** a server-computed `stockQty` on the Item read shape (or a dedicated on-hand endpoint), never a browser rollup. Sequence it before any attempt at BOM explosion/shortfall.

## ISSUE-112 — BOM revision model: ours snapshots every revision, legacy doesn't — `Current` is unreachable

- **Surfaced:** 2026-07-15 (REFACTOR-1, BOM detail)
- **Severity:** P4 — a semantic drift where **ours is better**; recorded so nobody "fixes" it toward legacy
- **Status:** [ ] open — no change proposed

Legacy's newest revision-log entry has **no snapshot**, so its row renders the literal **`Current`** (L8488). Ours snapshots **every** revision (`bom-master/service.ts:422,542`), so the newest row always has one and **the `Current` branch is unreachable** — it shows `👁 View (N)` of the current line list instead.

Both branches were ported faithfully; the dead branch guards a `(0)` render.

**Ours is the better model** — legacy cannot recover rev 1, because the snapshot only ever gets written when a *later* revision supersedes it. **Do not "correct" this toward legacy.** Logged only so the unreachable branch isn't later mistaken for dead code and deleted.

### BOM detail — mapping verdict (registry error #10)

**Real renderer, NOT port-only — and wrong in the OPPOSITE direction from the five master-detail pages.**

| | Evidence |
| --- | --- |
| **Not port-only** | `renderBOMMaster` **L8460-8493** renders **two full tables** with their own `<thead>`s, section captions, and a branch on `revisionLog.length` — ~34 lines of dedicated markup, the same substance as `viewItemDetail`/`viewRouteCard`. Packaged as a `<tr><td colspan="8">` rather than a screen: **our route architecture, not a spec divergence.** |
| **Plus a second-level screen** | **`_bomViewSnapshot` L8812-8830** is a genuine standalone viewer, reached only from inside that expand row — **the registry never attributed it to anything.** |
| **Contrast** | clients/vendors/machines/operators/cost-centers have **no legacy renderer at all**. BOM has line-for-line comparable markup. |

**Registry corrected:** `L8438` (the list wrapper) → **`renderBOMMaster` L8460-8493 expand row + `_bomViewSnapshot` L8812**. Right function, wrong sub-renderer — a **new failure mode** for the auto-builder, distinct from the "one fn assigned to every route in a module" pattern behind the other nine.

**Trap caught:** our page's long type labels (`Manufacture`/`Purchase`/`Outsource`) are legacy's **form `<select>`** labels (L8537-39) — right words, **wrong renderer**. The expand row uses `🏭 Mfg` / `🛒 Buy` / `🏭 Outsrc` (L8469).

**Ported:** `👁 View (N)` snapshot modal — including legacy's odd **`Cancel` + `✓ Close`** footer pair, which is what `showModalLg(…, fn, 'Close')` actually emits (L28042-45); both merely close. Uses already-fetched data — **no new API call**.

**Deliberately not copied:** the snapshot modal's date caption ("Archived items from Rev N **(date)**", L8817). The only date available is `createdAt` — **timestamptz**. Rendering it would have manufactured a **new ISSUE-065 mechanism-4 instance**, so the caption shipped **without** the date. Add it with the shared IST helper.

**ISSUE-065 mechanism 4 confirmed and left in place** (as briefed): `detail.tsx:246` `new Date(rev.createdAt).toISOString().slice(0,10)`; `bom_master_revisions.created_at` is **timestamptz** (schema.ts:2154) → off-by-one for 00:00-05:29 IST. **No other timestamptz is rendered this way here** — `detail.revisionDate` is a **`date`** column (schema.ts:2057), safe.

**ISSUE-095 does NOT apply** — the detail service applies **no LIMIT** to lines or revisions. Both counts are truthful. First page checked that came back clean.

## ISSUE-113 — ISSUE-043's fabricated justification is now DISPROVEN, not just doubted

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO detail agent — while refactoring a *different* file)
- **Severity:** P2 — the SO list presents an inflated count as exact
- **Status:** [ ] open — the comment should be deleted whether or not the count is fixed

`apps/api/src/modules/sales-orders/service.ts:283-285` carries this justification:

> *"total is approximate when search is active (acceptable — UI shows "X+ results")"*

**The UI does no such thing.** `sales-orders/routes/list.tsx:423` renders:
```
Showing ${…}–${…} of ${total}
```
**No `+`. Anywhere.** I flagged this as "fabricated" in ISSUE-043 on suspicion; it is now **verified against the render site**.

So with a search active, the count query omits the search filter and the list **presents an inflated total as exact**. The comment doesn't describe a tolerable approximation — it describes a UI affordance **that does not exist**, and it has been standing in for a fix.

**Two separable actions:** (1) delete the false comment — it is worse than no comment, because it reads as a considered decision; (2) fix the count to apply the same filters as the rows (the ISSUE-043 body covers all 6 modules).

## ISSUE-114 — ISSUE-065 mechanism 1, caught driving a business rule: overdue arrives a day late

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO detail agent)
- **Severity:** P2 — a **user-visible wrong answer**, not a formatting slip
- **Status:** [ ] open — part of the ISSUE-065 sweep

`sales-orders/routes/list.tsx:263`:
```js
const today = new Date().toISOString().slice(0, 10)   // ← today in UTC
```
…and this drives the **overdue** check.

**Consequence:** from **00:00–05:29 IST** the app believes it is still *yesterday*. An SO due today is **not flagged overdue**, and the ⚠ arrives **a day late** — every single night, on the shift that most needs it.

**Why this one matters more than the other 46 sites:** most mechanism-1 instances default a form field to today (annoying, correctable by the user). **This one silently changes a business verdict nobody is prompted to check.** It is the clearest argument yet for the shared `todayIst()` helper.

**Also on this page and CLEAN — verified, not assumed** (recording so it isn't re-audited): every date `detail.tsx` renders is a **`date`** column — `so_date` (schema.ts:1011), `sales_order_lines.due_date` (:1078), `so_milestones.due_date` (:1145) — so `toISOString()` is safe there. `createdAt` **is** timestamptz (:1022) but is rendered via a local `fmtIstDateTime` using `toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})` — **behaviourally correct**, an ISSUE-040 consolidation candidate only. **ISSUE-095 also clean on the detail:** `getById`'s lines and milestones queries (service.ts:364-372) have **no LIMIT**, so both "(N)" counts are truthful.

### `/sales-orders/$id` — mapping verdict: PORT-ONLY, and a THIRD category (registry error #11)

**A real renderer exists, is already ported, and is not this page.** `renderSOmaster` L11839 hides a detail view exactly as BOM Master does — the expand block **L11879-11957**, `<tr><td colspan="12">`, in two variants: **Equipment** (L11881-11927, own BOM-items table + `<thead>` L11902-11923) and **Component** (L11929-11955, line-items table L11931-11955).

**But it is already ported into `routes/list.tsx`** — `SoExpandedPanel` (L437), `EquipmentSoExpand` (L444), `EquipmentBomItems` (L476), `ComponentSoExpand` (L516) — near line-for-line. **Correctly placed:** in legacy it *is* an inline row of the list, not a page. Applying it to `detail.tsx` would **duplicate** it.

**Reachability proof** — `_editFullSO` L12531-12535:
```js
function _editFullSO(soNo){
  if(!canEdit()){ _soExpanded[soNo]=!_soExpanded[soNo]; render(); return; }  // read-only → expand
  ... showModalLg('Edit SO — '+soNo+...)                                      // editors → EDIT modal
```
`_soExpanded` is written **nowhere else** (decl L11838, read L11851, write L12534). So the expand row is legacy's **read-only SO detail**; for editors the same click opens the Edit modal → `edit.tsx`/`sales-order-form.tsx`.

**Every legacy SO detail surface is accounted for; none is a standalone desktop page:**

| Legacy surface | Owner |
| --- | --- |
| Expand row L11879-11957 | `list.tsx` — **already ported** |
| `_editFullSO` modal L12549 | `edit.tsx` / `sales-order-form.tsx` |
| `renderSOStatus` (router key `sostatus`, L2418) | `/sales-orders/$id/status` — `detail.tsx` already links it |
| `_mobSODetail` | mobile shell — **not a spec source, see below** |

**THREE distinct port-only categories now:**
1. **No renderer at all** — clients, vendors, machines, operators, cost-centers
2. **Renderer hidden in the list, NOT yet ported** — BOM Master (→ refactor it)
3. **Renderer hidden in the list, ALREADY ported** — Sales Orders (→ zero edits)

**`_mobSODetail` ruled out with proof, not preference:**
- **Different shell:** L28228 `var pages={…sodetail:_mobSODetail…}` is keyed on `_mobPage` and renders into `getElementById('mobBody')` (L28224). The desktop `render()` router **never reaches it**.
- **Untranslatable vocabulary:** built entirely from `mob-back`, `mob-card`, `mob-card-hdr`, `mob-card-title`, `mob-badge`, `mob-detail-row`, `mob-detail-label`, `mob-detail-value`, `mob-section` — **0 occurrences** in `apps/web/src/styles/`. Porting needs ~9 invented classes.
- **It is a strict SUBSET:** Customer/CPO/Due + a per-line card. Drops rate, material, drawing, dispatched, billed, milestones, GST, cost center, remarks. Porting it to desktop would **delete working features**.

**Legacy behaviour deliberately not copied:** legacy gates the expand behind `!canEdit()` — read-only users get the detail, editors get the Edit modal *instead*. Ours gives **everyone** both the expand and a full detail page. Keeping our superset is correct; copying the gate would remove a working feature from editors.

## ISSUE-111 — AMENDED 2026-07-15: on-hand IS server-available. The gap is DTO exposure, not structure.

**My original framing was WRONG and this correction supersedes it.** I wrote that on-hand stock "has no home" and that we "structurally cannot" render it. **The Customer Dispatch agent disproved that by tracing the service layer:**

- **`apps/api/src/modules/customer-dispatches/service.ts:57-63`** reads **`public.v_item_stock.on_hand_qty`** — an existing view.
- **`:65-77`** writes `stockBefore` / `stockAfter` into `store_transactions` — a faithful match for legacy L11728-29.

**So on-hand exists, is server-owned, and is already in production use.** It is absent only from the **Item read shape** and from specific form DTOs.

**What this changes:**
- The BOM `Stock` column (L8464/8477) and **`_explodeBOMMaster`'s shortfall logic (L8833-8845)** are **not** blocked on a schema change. They need **one server-computed field on the relevant response shape** — a normal, small API change.
- **What remains true and non-negotiable:** never derive on-hand in the browser (CLAUDE.md rule 1), and **never substitute `items.min_stock_qty`** (schema.ts:218 — the column comment itself confirms it is a *low-stock alert threshold*, not on-hand). Both refusals on BOM stand.

**Why this matters beyond one field:** the original wording would have had future agents **refuse work that is actually a one-field API change**. That is the exact cost of my asserting a conclusion from a grep instead of tracing the call path — the 8th time an agent has corrected me this way.

**Customer Dispatch is the counter-example, not an instance:** its availability figure is a *different, sound, server-owned* number — `availableQty` (`service.ts:137`), re-validated on save (`:402-404`), mirroring legacy's own re-check at L11718. It is `readyQty − dispatchedQty` (production + QC-derived, per SO line), **not** inventory on-hand. ISSUE-111 does not bite this page at all.

## ISSUE-115 — `/customer-dispatches/new`: legacy never had this route (registry error #12, a new failure mode)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Customer Dispatch create — **zero edits**)
- **Severity:** P4 (registry accuracy)
- **Status:** [x] corrected 2026-07-15 — now `No Legacy Counterpart`

**Not a mis-assigned function — a route legacy does not have.** Distinct from the "one fn per module" failure behind errors #1-9 and the "right fn, wrong sub-renderer" of #10.

**Legacy names its own create path, in its own empty state** (L10783):
> `No dispatches recorded yet — use 📦 Dispatch button in Item Master`

and `renderDispatchRegister()`'s header (L10751-54) holds only `searchBox` + `printDispatchRegister()` — **no New button**.

**`dispatchItem(id)` L11679 is item-first** (`db.items.find(i=>i.id===id)`, L11681). **Our Items master has no dispatch UI at all** (`grep -rin dispatch apps/web/src/modules/items/` → **0 hits**). So `dispatchItem` is an **unported legacy flow**, not a mismapping — and `/customer-dispatches/new` is **our own design**.

**Three independent axes differ — this is a model divergence, not a layout one:**

| Axis | Legacy | Ours |
| --- | --- | --- |
| **Entry** | item-first | SO-first |
| **Grain** | a `dispatchLog` row **IS** the dispatch (1 item, 1 qty, **no header**) | a **document**: `customer_dispatches` header (code/status/cancel) + `customer_dispatch_lines` (N lines) |
| **Availability** | `item.stockQty` (inventory on-hand) | `readyQty − dispatchedQty` (production + QC-derived, per SO line) |

**Forcing the port would have destroyed live data AND shipped dead controls:**
- Legacy has **no Transport / Vehicle No.** fields — it folds them into a Remarks *placeholder*. Both are **real nullable columns** (`schema.ts:3881-3882`). Deleting them = **data loss on a live system**.
- `createCustomerDispatchInputSchema` (`customer-dispatch.ts:30-44`) accepts **none** of legacy's Linked JC / Dispatched By / Customer-Ref → porting them is **Trap 1**.

**A third dispatch writer exists and is also not our model:** `_atDispatchUnit` L28991 — assembly-unit-first with `qty:1` **hardcoded**.

**ISSUE-104 checked, no violation:** our qty input is `min={0}` vs legacy's `min="1"`; schema is `z.coerce.number().int().positive()` and the client filters `qty > 0` before submit, so `0` never reaches the API. **`min={0}` is the safer direction** — legacy's `min="1"` would be the narrowing one. All qtys `.int()` both sides; no decimal inversion; no closed selects over open columns.

**ISSUE-065 mech 1 confirmed here too:** `create.tsx:16-18` `todayStr()`. `dispatch_date` is a **`date`** column (schema.ts:3875) so *rendering* is safe — but *computing today* in UTC is not: at 00:00-05:29 IST a dispatch defaults to **yesterday**, feeding a wrong register date and a wrong invoicing gate. **Legacy's `today()` L1486-87 uses local components and is CORRECT — we regressed it.**

**Two convention nits, deliberately left (out of a port-only scope):** `create.tsx:79` puts `innovic-input` on a `<select>` (160 sites use `innovic-select`; both share one identical rule block — **zero visual difference**); and `create.tsx:77` writes `Sales Order ★` as **inline label text** rather than `<span className="req">` — a divergence from our own convention, not legacy's.

## ISSUE-117 — 🔴 Editing an SO silently EATS attached files

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form)
- **Severity:** **P1** — silent data loss on the primary sales document
- **Status:** [ ] open — needs an API wiring decision (rule 7), correctly NOT fixed in a UI pass

`sales-order-form.tsx` renders **`📤 Upload PO Doc`** and **`📧 Attach Email Ref`** in **both** modes. **`routes/edit.tsx` never passes `onPoFileChange` / `onEmailFileChange`.**

**So in edit mode a user can attach a file, see the filename chip appear, click Save — and the file is silently discarded.** Every affordance says it worked.

**Legacy wires it in BOTH modes** — `_cpoUploadIfNeeded` L12522 (create) and L12617 (edit). **This is a port regression, not a parity gap.**

The fix needs upload API calls added to `edit.tsx` (**CLAUDE.md rule 7** — out of scope for a UI refactor). **Interim option worth considering: hide the controls in edit mode** — a missing control is honest; a control that eats your file is not.

## ISSUE-118 — 🔴 Editing an SO collapses every line's Due Date to the earliest one

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form)
- **Severity:** **P1** — silent, irreversible data loss on every multi-line SO edit
- **Status:** [ ] open — the fix is coupled to the save mapping (logic), so a UI-only fix is impossible

`detailToFormValues` sets `header.dueDate` = the **earliest** line due date. Save then writes `dueDate: soDue` to **every** line.

**Concretely:** an SO with lines due **30-Mar** and **15-Apr** → open edit → save → **both lines now due 30-Mar.** No warning, no diff, nothing to undo it.

**Legacy captures Due Date PER LINE** — it is a column in the line table (L12164 header, L12006 cell).

**Why the agent correctly did NOT restore the column:** the fix is coupled to the save mapping, and a **half-restore would wipe ALL due dates** — strictly worse than the current bug. Same "half-done fix is worse than none" shape as the Clients textarea case (ISSUE-099) and the Purchase Orders pass marked Refactored while still carrying its defect. **Restore the column and the save mapping together, or not at all.**

## ISSUE-119 — ISSUE-104: `with_material` sales orders are silently rewritten on edit

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form)
- **Severity:** P2 — silent overwrite of a document's fundamental type
- **Status:** [ ] open — needs a DB audit before shipping

`SELECTABLE_SO_TYPES` **excludes `with_material`** — but it is a **valid stored value**, and the code's own comment concedes such SOs "still load". The Type select cannot represent it, so it **falls back to option 1** and the SO is **silently saved as `component_manufacturing`**.

**Audit before shipping:**
```sql
SELECT id, so_no, type FROM sales_orders WHERE type = 'with_material' AND deleted_at IS NULL;
```

Joins the ISSUE-104 family (vendor rating, machine shifts, user roles, cost-center dept/type). **This one is the most consequential yet** — it does not corrupt an attribute, it changes *what kind of document the record is*.

## ISSUE-120 — ISSUE-104: an SO's BOM link is silently cleared on edit — and LEGACY GUARDS AGAINST THIS

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form)
- **Severity:** P2 — silent overwrite, **with a legacy safeguard we failed to port**
- **Status:** [ ] open

The BOM select is fed **`useBomMastersList({ status: 'active' })`**. An equipment SO linked to a **now-inactive** BOM has **no matching option** → resolves to the empty option → on save **`bomMasterId` is cleared** and `bomStatus` flips to **`BOM Pending`**.

**Legacy explicitly prevents exactly this** (L12482):
```js
if(!isAdmin() || !_bv2) bomMasterId = origBomId;   // preserve the original
```
It uses an **open datalist** and **preserves the original link** unless an admin deliberately changes it.

**So this is not a parity gap — it is a port regression against a safeguard legacy shipped.** It also sharpens the ISSUE-104 pattern: **a filtered option list is the same defect shape as a narrow one.**

**Related legacy logic absent from our port:** the **BOM admin-lock** (L12273) — largely covered because our edit route is admin-only — and the **design-approval gate** (L12486), which blocks BOM linking unless Design is Approved. **The design gate is genuinely missing business logic**, not a styling gap.

## ISSUE-121 — ISSUE-104: a stored GST % outside the preset list is overwritten

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form)
- **Severity:** P3 — narrow but real; money-adjacent
- **Status:** [ ] open

Schema allows **0..99.99**; the select offers only **0 / 5 / 12 / 18 / 28**. A stored **3%** renders as **0%** and is overwritten on save.

```sql
SELECT id, so_no, gst_pct FROM sales_orders
 WHERE gst_pct IS NOT NULL AND gst_pct NOT IN (0,5,12,18,28) AND deleted_at IS NULL;
```

## ISSUE-122 — The shipped SO line template can never populate Part Name

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO form — in a file the agent correctly did not edit)
- **Severity:** P3
- **Status:** [ ] open

In `sales-orders/lib/import-export.ts`: `downloadSoLineTemplate`'s **`LINE_COLUMNS` omits `Part Name`**, yet **`parseSoLineFile` reads `r['Part Name']`**. So the template we hand users **cannot** populate a field the importer expects.

**Legacy's template has all 8 columns including Part Name** (L12048), **plus a Notes sheet we do not have**.

Same file carries a **local `fmtIst()`** (L9-22) — an **ISSUE-040** consolidation candidate.

### SO form — the delegation chain, VERIFIED (my trace was wrong; correction #9)

| Mode | Entry | Renders via | Body builder |
| --- | --- | --- | --- |
| create | `addSO(existingSoNo)` **L12413** | `showModalLg('New SO / WO', …)` L12427 | `soHeaderForm` **L12183** |
| edit | **`_editFullSO(soNo)` L12531** | `showModalLg('Edit SO — X (N lines)', …)` L12549 | `soHeaderForm` **L12183** |

**I briefed `editSO` L12528 → `editSOLine` L12465 as the edit counterpart. Wrong.** `editSOLine` edits **ONE LINE** (legacy stores one row per SO line); it is the `Edit` button on an individual line (L11893/L11950), **a route our port does not have**. Our `/sales-orders/$id/edit` loads the whole SO → **`_editFullSO` L12531**, reached from the SO row click at L11858. *(The SO detail agent independently landed on the same function via its `canEdit()` gate — two agents, same conclusion, different routes to it.)*

**Both my delegate traces were RIGHT** (`editSO`→`editSOLine`; `soForm`→`soHeaderForm`) — **the error was assuming a correct delegate meant a correct counterpart.** A one-line delegate tells you where control goes, not whether that destination matches our route's grain.

**`isEquip` is NOT a mode branch** — legacy derives it from the record (`s.type==='Equipment'` L12186) and re-toggles live via `_onSoTypeChangeFull` (L12175). Our `watch('header.type')` already models it correctly.

**FOOTER — my heuristic would have been WRONG here.** All three entry points call **`showModalLg` with NO explicit `saveLabel`**, so the **L28034 fallback derives it from the title** → **`✓ Save SO`** on **`.btn-success`** — *not* `Save` on `.btn-primary`. **That is a FOURTH footer shape**, alongside `showModal`'s Cancel/Save, `showModalLg`'s explicit label, and Route Cards' hand-rolled footer. **Stop applying the footer rule by helper name — derive it from the call site.**

**ISSUE-099 → 7 for 7, and legacy is symmetric BY CONSTRUCTION here** (both modes are literally the same function — not the Cost-Centers counter-case). Ours had drifted **six** ways: SO No. readOnly in edit only; a `★` on Client PO No. in create only (and `clientPoNo` is `.optional()` — a false-constraint star, removed); PO/Email upload wired in create only (**→ ISSUE-117**); PO-or-Email requirement enforced in create only; "Save as draft" create-only; submit label `Create SO` vs `Save changes`.

**Deliberately kept against legacy (all correct):** Status (Open/Closed) and Cost Center stay removed — porting Status would be **textbook ISSUE-104 narrowing** (5 stored values → 2). Free-text `fCust` not restored (schema mandates `clientId`). **Stars KEPT on Date / Part No. / Description / Order Qty though legacy stars none** — our schema genuinely requires them, and removing a star while keeping the validation **hides a real constraint: the inverse of Trap 1.** UOM column, textarea Remarks, editable Lot #, and milestone `min={0}` (legacy's `min="1"` would reject a stored 0 — inverted ISSUE-104) all kept.

**Legacy bug not copied:** its line-table empty state uses `colspan="10"` for an **11-column** table (L12163). Ours keeps `colSpan={11}`.

**Browser math legitimate here, verified:** the totals preview **unsaved form input**, and no server-owned SO total exists (`salesOrderListItemSchema` has no value field). Now uses the shared **`inrFormat`** (`en-IN` — matches legacy exactly), replacing `toFixed(2)`. No local `fmt()`.

## ISSUE-123 — 🔴 Soft-deleted PO lines still charge money to SO Costing

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Costing)
- **Severity:** **P2** — a rupee figure that counts deleted records; **direct CLAUDE.md rule 8 violation**
- **Status:** [ ] open — server-side (`apps/api/src/modules/so-costing/service.ts`)

All four costing queries filter `po.deleted_at`, `jc.deleted_at` and `o.deleted_at` — **but never `pol.deleted_at`**, which exists (`schema.ts:1470`).

**So a soft-deleted purchase-order line keeps contributing to Material, Outsource and Total Cost.** Delete the line; the money stays.

CLAUDE.md rule 8 is "no hard deletes — only soft deletes", and its whole premise is that `deleted_at IS NULL` is applied **everywhere** the row is read. A filter applied to three of four tables in the same query is the failure mode the rule exists to prevent.

## ISSUE-124 — 🔴 SO Costing double-bills outsource POs, because legacy's vocabulary was narrower than ours

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Costing)
- **Severity:** **P2** — money counted twice
- **Status:** [ ] open — server-side

The `material` CTE selects `po.po_type <> 'job_work'`. **Our `PO_TYPES` are `['standard','job_work','outsource','service']`.**

So a PO line of type **`outsource`** or **`service`** with `source_so_line_id` set lands in **Material**. If that same line is also referenced by `jc_ops.outsource_po_line_id`, it is counted **again** in **Outsource** — and `totalCost = mat + os + mt` **bills it twice**.

**Root cause — the ISSUE-104 hazard, inverted and moved server-side.** Legacy's `poType !== 'Job Work'` was **correct against a TWO-value vocabulary**. Ours has **four**. The predicate was ported faithfully and became wrong, because the *domain* widened underneath it.

**This generalises the ISSUE-104 lesson beyond form controls:** *any `<>` / `!==` predicate ported from legacy assumes legacy's value set is complete.* Check the enum before trusting a negative filter — a `<>` over a widened vocabulary silently admits the new members.

## ISSUE-125 — SO Costing counts deleted SO lines inconsistently

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Costing)
- **Severity:** P3 — internally contradictory totals
- **Status:** [ ] open — server-side

The `material` and `outsrc` CTEs join `sales_order_lines` **without** `sol.deleted_at IS NULL`, while `line_count`, `total_qty` and `so_value` **do** filter it.

**So a deleted SO line's COST shows, but its QTY and VALUE do not.** The same screen disagrees with itself about whether the line exists — the worst kind of wrong, because neither number looks obviously broken.

Same family as ISSUE-123: a soft-delete filter applied to some readers of a row but not all.

## ISSUE-126 — `--teal` is undefined and silently falls back to a hardcoded hex

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Costing)
- **Severity:** P4 — an untokenised literal in a light theme
- **Status:** [ ] open — no action taken (correctly)

`var(--teal, #0d9488)` — **`--teal` is defined in NEITHER `tokens.css` NOR legacy** (grep count 0 in both). The fallback hex is what actually renders.

**Kept as-is, correctly:** it renders identically to legacy, so changing it would be a divergence, not a fix. Logged because a hardcoded teal in a **light** theme (ISSUE-067) is a latent inconsistency, and because `--teal` is on the confirmed-absent list precisely so nobody "fixes" it by inventing the token.

### SO Costing — the rule-1 violation FIXED, and what was correctly refused

**Fixed (in-scope, my file):** `detail.tsx` rendered **`op.outsourceCost + op.machineTimeCost`** — a **browser-summed money figure** — where legacy (L17364-67) prints the two as **separate coloured spans** (amber + cyan). The addition is gone; both figures are now server-owned as rendered. *The sum was both a CLAUDE.md rule-1 violation AND a parity divergence — the rare case where the two agree.*

**Refused, correctly:**
- **Export Excel (L17384)** — `_soCostExport` **re-derives the entire costing in the browser** via `calcEngine()`. Porting it needs a server-side export endpoint. Reported, not invented.
- **`₹<rate>/h` in the op Type chip (L17362)** — legacy derives it as `machTimeCost/(cycleTime*qty||1)`: **browser division on money**. `SoCostingOpRow` exposes no `hourRate`. Omitted, not computed.
- **Legacy's list tip text** — it names "Material = PO (With Material)", a **PO type our enum does not have**, and omits Machine Time although the column exists. Restoring it verbatim would **advertise a non-existent constraint (trap 1)** and hide a live column. Port's wording kept.
- **Detail `thead` `background:var(--bg4)` (L17394)** — **inert in our port**: `.innovic-table th` sets its own `background: var(--bg3)`, and a `th` background paints over a `tr` one. Not added.
- **`.rpt-total`** — absent from our theme, but legacy's costing **doesn't use it** (no total row on either screen). Nothing lost; no CSS added.

**A legacy inconsistency deliberately NOT copied:** legacy's list uses **`toFixed(0)`** and its detail uses **`toFixed(2)`** — **legacy's own two screens disagree on the same rupee.** Both now use the shared `inrFormat`. Consistency chosen over copying the inconsistency.

**Money alignment — a "fix" correctly NOT made:** legacy centres its money columns (`td-ctr mono`), not `td-right`. Kept centred. Right-aligning would have been an improvement, not parity.

**Verified clean, recorded so it isn't re-audited:**
- **ISSUE-095: does not apply.** Both queries are **`LIMIT`-free** and return complete sets; the list's `totalCost` and the detail's four grand totals are **SQL-side**. Nothing is capped, so no disclosure is needed.
- **ISSUE-065: does not apply.** Neither page renders or computes a date; **no `new Date` in either file**.

## ISSUE-127 — 🔴 SO Overview's "Issued" column is a hardcoded 0, styled like real data

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** **P1** — a fabricated figure presented as a measurement
- **Status:** [ ] open — server-side (`apps/api/src/modules/so-overview/service.ts:863`)

```ts
issuedQty: 0,   // store_transactions integration deferred
```

**The drill's Issued column renders `0` for EVERY row, amber-styled exactly like live data.** It is indistinguishable from a truthful "nothing issued yet". **Legacy computes this figure.**

**Why this is the worst shape in the whole log:** ISSUE-095's capped counts are at least *real numbers that stop early*. This is a **constant wearing the costume of a measurement**. A user reconciling issued-vs-required has no signal that the column is switched off.

**Two honest options, both better than today:** compute it from `store_transactions`, or **render `—` and drop the amber styling** until it exists. A deferred integration must not render as a confident zero.

**Same family, already logged:** ISSUE-129 below (a column labelled from the wrong source), and the Design Work Log Alerts tab (ISSUE-062) — features whose *output shape* is right and whose *content* is meaningless.

## ISSUE-128 — 🔴 ISSUE-114's mechanism is SERVER-SIDE here, and it under-reports delays for everyone

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** **P1** — supersedes ISSUE-114 in blast radius
- **Status:** [ ] open — part of the ISSUE-065 sweep

**ISSUE-065 mechanism 1 in THREE places on this page**, but the important one is server-side:

| Site | Drives |
| --- | --- |
| `so-overview/routes/list.tsx:329` + `DrillBody` | overdue red on the Due Date cell |
| **`so-overview/service.ts:67-69` `todayIso()`** | **`delayedLines`, `deriveOverallSoStatus` (delayed vs on_track), the DELAYED stat tile, and the filter pills** |

**So from 00:00–05:29 IST the entire page under-reports delays — server-side, for every user at once.** Not a formatting slip: a wrong business verdict on the screen managers use to find slipping orders, every night, on the night shift.

**This is strictly worse than ISSUE-114** (client-side overdue on the SO list): a server-computed `todayIso()` poisons a stat tile and a filter, so the *set of rows you can even see* is wrong — not just their colour.

**Legacy's `today()` L1486-87 uses LOCAL date components and is CORRECT on an IST box. Port regression.**

**Rendering here is SAFE and I verified it rather than assuming** (mechanism 4 does not bite): `so_date` (schema.ts:1011) and `due_date` (:713, :1078) are **`date`** columns, not timestamptz.

**Reported, not fixed** — needs the one shared IST helper (`date-fns-tz@^3.2.0` installed, unused); ISSUE-040 forbids another local `fmt()`.

## ISSUE-129 — SO Overview's "Items" column measures a different thing than legacy's

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** P2 — needs a server-side `itemCount`
- **Status:** [ ] open

Legacy's **Items** column is **`childRows.length`** — the **BOM child count** for Equipment SOs (L9112 region). Our `lineCount` is the **SO line count**.

**These differ precisely for Equipment SOs — the ones this page exists to track.**

**The agent kept the honest `Lines` label** rather than adopt legacy's `Items` heading over a number that doesn't mean items. **Correct:** matching the label without matching the measurement would be the worst outcome — the same shape as trap 1, but applied to a column heading instead of help text.

**Fix:** a server-side `itemCount`. Do not derive BOM child counts in the browser (rule 1).

## ISSUE-130 — SO Overview search is narrower than legacy's, and the placeholder correctly doesn't claim otherwise

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** P2
- **Status:** [ ] open

Legacy's search covers **equipment name AND child item code/name** (L9116). Ours ILIKEs only `code` / `customerName` / `clientPoNo` (`so-overview/service.ts:100-104`).

**The agent kept our accurate placeholder rather than porting legacy's wider claim — trap 1, applied correctly.** Searching by item code silently returns nothing today; a placeholder promising it would turn a gap into a lie.

**Fix is server-side** (widen the ILIKE to the child rows), not a placeholder change. **Port the label only once the search actually covers it.**

## ISSUE-131 — SO Overview: both Excel exports are absent

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** P2
- **Status:** [ ] open — not built (correctly)

**Export All** (L9138) and the drill's **Export Excel** (L9183) have no port. Both need new XLSX logic; not a UI change.

**Consistent with the SO Costing verdict:** `_soCostExport` (L17402) was likewise not ported because it **re-derives its data in the browser** via `calcEngine()`. Any legacy export that computes its own dataset needs a **server-side export endpoint**, not a React reimplementation.

## ISSUE-132 — SO Overview drill: legacy's per-column filter row is absent

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** P3
- **Status:** [ ] open — not built

`_soOvColFilter` (L9188-9197) renders a per-column filter row inside the drill. Ours has none. Needs new state + components — beyond a markup pass.

## ISSUE-133 — SO Overview: the "Hold / Blocked" stage and 🚫 alert are dead on the drill path

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Overview)
- **Severity:** P3 — a shipped control that can never fire
- **Status:** [ ] open — server-side

`so-overview/service.ts:837` passes **`{ hold: false }` hardcoded**. So the **Hold / Blocked** stage and the **🚫** alert are **dead** on the drill path — they render, and they can never be true.

**Same family as ISSUE-127:** a UI element whose shape is honest and whose input is a constant. Trap 1 in its purest form — an affordance advertising a state the system cannot reach.

### SO Overview — mapping confirmed, and the `_mob*` rule independently upheld

**Spec: `renderSOOverview()` L9112** + `_deriveSOSummaries()` **L9064** + `_soOvShowSODetail()` **L9146**. Router-confirmed at **L2385** (`sooverview:()=>renderSOOverview()`); sidebar `nav('sooverview')` L403.

**`_mobSOOverview` rejected — a SECOND agent reached this independently.** It appears only in the `_mobPage` map at **L28228**, dispatched into `mobBody`, **never reachable from the desktop `render()` router**. The SO detail agent's verdict holds. **The `_mob*` exclusion is now a settled rule, confirmed twice from different pages.**

**Real defect fixed: the SO Date column was FETCHED AND RENDERED NOWHERE** — `soDate` is on the schema (L54) and the service (L330). Added. *(This is the "fields on the payload, never rendered" class — now 12+ pages.)*

**Kept against legacy, correctly:** all **7** server-owned stat tiles (legacy has 4 — every one of ours is a direct server field, so trimming to 4 would delete working features); the **Activity → `/sales-orders/$id/status`** link column (ours); the drill empty state; and our **3-value** Type column — **legacy's 2-type vocabulary is exactly the ISSUE-119 trap** (`with_material` is a real stored value).

**Legacy behaviour deliberately not copied:** row zebra via inline `i%2` background (`.innovic-table` already handles it — an inline style would *fight* the class); the drill `<thead>`'s `<tr style="background:var(--bg4)">` (the class already styles it); and `stat-grid`'s inline `repeat(4,1fr)` (a **no-op restating the class default**).

**ISSUE-095 checked at the render site, not via comments:** `getSoOverview` has **no LIMIT** (`service.ts:107-111`). Nothing capped, no disclosure needed.

## ISSUE-134 — ISSUE-065 mech 1 on SO Status: the JC/SO due-date flag misses on the night shift

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Status)
- **Severity:** P2 — twin of ISSUE-114/128
- **Status:** [ ] open — part of the ISSUE-065 sweep

`so-status/components/so-status-detail.tsx:45` — `todayStr()` = `new Date().toISOString().slice(0,10)` → **today in UTC**. Drives `dueOverdue` (L79) and the JC due-date colour. From **00:00-05:29 IST** an SO/JC due today is **not flagged red**.

**Legacy's `today()` L1486-87 uses local components and is CORRECT. Port regression.**

**Good judgement worth recording:** the agent **reused the existing broken helper** for the new JC-due call site rather than add a second implementation — so **one helper swap fixes both sites**. Adding a correct local helper next to a broken one would have made the ISSUE-040 consolidation *harder*, not easier. **When a page already has a broken shared helper, extend it — don't route around it.**

**Mechanism 4 verified ABSENT here, not assumed:** `so_date` / `due_date` are **`date`** columns (schema.ts:1011, 1078) → rendering is zone-safe.

## ISSUE-135 — SO Status: three legacy alert rows have no server field

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Status)
- **Severity:** P2
- **Status:** [ ] open — needs server fields; correctly NOT computed in React

Legacy renders three alert rows we cannot:
- `⏳ QC Pending: N pcs (material received, awaiting inspection)` (L4432)
- `⚠ GRN QC Rejected: N pcs` (L4433)
- `⚠ Production QC Rejected: N pcs` (L4434)

`soStatusOutsourceAlertSchema` exposes **no `grnRejected`** and **no line-level `qcRejected`**. Needs server fields — **not browser math** (CLAUDE.md rule 1).

## ISSUE-136 — 🔴 ISSUE-113 class: SO Status export claims to mirror legacy, cites the wrong line, and doesn't mirror it

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Status)
- **Severity:** P2 — a false comment standing in for a real divergence
- **Status:** [ ] open

`so-status/lib/export.ts:1-2` claims:
> *"Mirror of legacy `_soStatusExportExcel` (**L4555**)"*

**Three things wrong in one comment:**
1. **The line is wrong.** `_soStatusExportExcel` is at **L9262**. L4555 is only the *button*.
2. **It is not a mirror.** Legacy emits **ONE** sheet — `SO Status {soNo}`, **22 columns, op-level**, filename `SO_Status_{soNo}_{today()}.xlsx`. Ours emits **TWO** — `Lines` + `Job Cards`, filename `so-status-{code}.xlsx`.
3. **All 22 legacy columns are reachable server-side EXCEPT `Material`** (`soStatusLineSchema` has no `material`) — so the gap is one field, not a redesign.

**Same shape as ISSUE-113** (`sales-orders/service.ts:283-285`'s fabricated "UI shows X+ results"): **a comment asserting a property nobody verified, which then reads as a considered decision and blocks the fix.**

**And I propagated the bad line number into the agent's brief** — I wrote "around L4555" from the same wrong source. **This is the ISSUE-102 failure again in a new place: I cited a line I had not re-derived.** The agent caught it by reading both sites.

**Rule reinforced:** a comment claiming parity with legacy is worth **nothing** unless it names a line that has been re-checked. Prefer no comment to a stale one.

## ISSUE-137 — SO Status renders raw ISO dates where legacy renders en-IN

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Status)
- **Severity:** P3
- **Status:** [ ] open — blocked on the shared helper

Dates render as `2026-04-29`; legacy's `fmt()` (L1484) renders **`29 Apr 26`**.

**Correctly not fixed:** ISSUE-040 forbids adding another local `fmt()` (the repo already has ~12 divergent copies). Lands with the shared IST helper.

## ISSUE-138 — SO Status: "📦 Plan BOM Items" is ungated where legacy gates it

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Status)
- **Severity:** P3 — permissions
- **Status:** [ ] open

Legacy gates the action behind **`canEntry()`** (L4303). Ours is **ungated**.

Permissions are logic (CLAUDE.md rule 1 — the frontend hides UI, services enforce). **Reported, not changed** — but worth confirming the *service* enforces it, since a frontend-only gate was never the protection anyway.

### SO Status — mapping verdict (registry error #13) + a real semantic bug fixed

**`/so-status` → `renderSOStatus` L4255-4561.** Router-confirmed L2418 (`sostatus: ()=>renderSOStatus(calcEngine())`), sidebar L404. The whole two-pane shell (L4543-4560) is this one route.

**`/sales-orders/$id/status` → NO LEGACY COUNTERPART — category 4 ("a route legacy never had"), and the proof is CONCLUSIVE, not merely absent:**
- **`_soSel` (L4253) is the only selection state, written at exactly ONE site** — L4526, the left-pane card's `onclick="_soSel='...';render()"`. **No other writer in 29k lines.**
- **Every entry is a bare `nav('sostatus')`** — sidebar L404, mobile dept menu L28240. **The router takes no id** (L2418).
- **`renderSOStatus` has no per-SO branch or expand row** — it always renders left pane + right pane together.
→ **Legacy structurally cannot deep-link to one SO's status.** Ours can. **A live feature — kept, untouched.**

**`components/so-status-detail.tsx` → the right pane (L4276-4559)**, imported by BOTH routes → the refactor lands once and benefits both. *(Confirming the batch-22 `builder.tsx` lesson: one agent must own a shared component.)*

**🔴 REAL SEMANTIC BUG FIXED — same glyph, opposite meaning.** Our op chips rendered **`✓` to mean "complete"**. **In legacy, `✓` marks QC-REQUIRED (`op.qcReq`)** (L4340). Only a line-by-line read catches this — the markup was "correct" and the meaning was inverted. Also dropped an invented `🔧`; 🏭 = outsource per legacy.

**Other real gaps closed:** the JC table was **missing its 10th View column** entirely; `▶N running` (L4349) and the overdue due-date colour (L4355) were absent; priority rendered as plain text where legacy uses `badge()` (L1964: High=`b-amber`, Normal=`b-grey`).

**Kept against legacy, all correct:**
- **"+ Plan N pcs" NOT relabelled "Create Job Card"** — traced `_soStatusCreateJC` (L4565-69): legacy's button **only** sets `_planPreSelectLine` and `nav('planning')`. **It doesn't create a JC either.** Relabelling would advertise something it doesn't do (**trap 1**). Ours reaches the same destination *plus* inline plan modals.
- **"Edit in SO Master" → `/sales-orders/$id` kept.** Traced L4555: legacy does `nav('somaster')` — **the bare list, no id**, because legacy has no per-SO route. Retargeting to the list would be a **pure downgrade of a working feature**.
- Supersets kept: header PROGRESS fact + bar, the search-vs-empty distinction, `delayed`/`blocked` dot colours, sticky search header, richer op tooltip, detail.tsx's back-link.

**Trap confirmed again:** legacy's `badge('In Progress')` → **`b-yellow`, defined NOWHERE → inert in legacy**. Our `b-blue` kept; **no `b-yellow` rule added.** *(This is the `.stat-card.blue` lesson holding — the one I got wrong myself.)*

**Colour mapping (ISSUE-067), and one honest collapse reported:** legacy's dark-theme chip hex (`#06b6d4/#8b5cf6/#3b82f6/#22c55e/#059669/#f59e0b`) → `--cyan/--purple/--blue/--green/--green2/--amber`. Legacy's `color+'08'`/`'30'` alpha washes → `rgba()` of the **light-theme** token at the same alpha (`var(--x)08` is **invalid CSS** — ISSUE-063). **Reported collapse:** legacy distinguishes Produced `#059669` from QC Accepted `#22c55e`; the port uses `--green2`/`--green`, the closest real tokens.

**`.card` does not exist in the theme** → mapped to `.panel` per established precedent. No class invented, no CSS added.

## ISSUE-139 — ISSUE-065 mech 1 on the Invoice date default — and here it moves MONEY

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice create)
- **Severity:** P2 — part of the ISSUE-065 sweep, but with a financial consequence
- **Status:** [ ] open

`invoices/routes/create.tsx:22` — `todayStr()` = `new Date().toISOString().slice(0,10)` → **today in UTC**. From **00:00-05:29 IST the invoice date defaults to YESTERDAY.**

**Why this one is worse than the other 46 mechanism-1 sites:** the server computes **`dueDate = invoiceDate + termsDays`**. So a wrong default **shifts the due date AND the overdue flag by a full day** — on a financial document, silently, and the user has no reason to look.

**Mechanism 4 verified ABSENT, not assumed:** `invoices.invoice_date` is a **`date`** column (schema.ts:3709), not timestamptz → *rendering* is zone-safe. **Only the default is the bug.**

**Legacy's `today()` L1486-87 uses local components and is CORRECT. Port regression.**

**Reported, not fixed** — needs the one shared IST helper. The agent added **no second implementation and no new call sites**, keeping the eventual one-line swap intact.

## ISSUE-140 — ISSUE-104 on Invoice GST — real, but CREATE-ONLY, and that distinction matters

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice create)
- **Severity:** P3 — **not** P2, and the reason is the useful part
- **Status:** [ ] open — kept as legacy has it

`createInvoiceInputSchema.gstPercent` is **`.nonnegative().max(100)`** — continuous 0-100, DB `numeric(5,2)`. The control offers only **0 / 5 / 12 / 18 / 28**. Same shape as ISSUE-121 (SO GST).

**But this is a CREATE form. There is no stored value to overwrite.** ISSUE-104's danger is specifically the **edit** path: a closed control renders a stored out-of-range value as the fallback and **rewrites it on save**. On create, the same narrow control merely limits what can be *entered* — and **legacy has the identical 5 options**, so it is faithful.

**The refined rule:** *a narrow control on CREATE is a parity question; the same control on EDIT is a data-loss question.* Triage accordingly — don't auto-escalate every narrow select to P2.

**Separate, and legacy does it too:** the form **hardcodes 18** rather than inheriting `sales_orders.gst_percent` (schema.ts:1017), so an SO taxed at **12** produces an invoice defaulting to **18**. Worth a ruling — inheriting the SO's rate is obviously more correct, but it is a behaviour change, not a parity fix.

## ISSUE-141 — 🔴 A `<>` filter blocks invoicing goods the customer already holds

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice create)
- **Severity:** **P2** — money that cannot be billed
- **Status:** [ ] open — server-side (`customer-dispatches/service.ts:170`)

`listFinanceSoOptions` filters **`status <> 'cancelled'`**. **Legacy (L21157) filters NOTHING.**

**Consequence: a cancelled-but-already-dispatched SO cannot be invoiced — for goods the customer physically has.** The revenue is unbillable through the UI.

**This is the THIRD instance of the same server-side shape**, and it is now a pattern worth naming:

| Where | Predicate | Why it's wrong |
| --- | --- | --- |
| SO Costing (ISSUE-124) | `po.po_type <> 'job_work'` | legacy's vocabulary had **2** values, ours has **4** → `outsource`/`service` fall through into Material and get **double-billed** |
| Invoice create (this) | `status <> 'cancelled'` | legacy filtered **nothing**; the filter was **added by the port** and silently removes a legitimate case |
| SO form BOM select (ISSUE-120) | `status: 'active'` | a **filtered option list** silently clears an SO's link to a now-inactive BOM — **legacy explicitly guards against this** at L12482 |

**The generalisation — this is ISSUE-104's real shape, and it is NOT about form controls:**
> **Any predicate that EXCLUDES rows — `<>`, `!==`, or an option-list filter — encodes an assumption about the full value set. Ported from legacy, it assumes legacy's vocabulary was complete. Invented by the port, it assumes the excluded case can't matter. Both assumptions have now been wrong three times, twice on money.**

**Check every negative filter against (a) the current enum and (b) what legacy actually filtered — which is sometimes nothing.**

### Invoice create — mapping verified (registry error #14) and the money verdict NAMED

**Every point of my trace confirmed by direct read** — a first; usually I'm the one corrected:

| Claim | Evidence |
| --- | --- |
| `_createInvoice()` L21152 = `/invoices/new` | body is the same 6-field `.form-grid` + lines table our page renders |
| `_invLoadLines()` L21209 + `invoicedMap` rollup | `var invoicedMap={}` L21216; `invoicedMap[l.itemCode]=(…)+n(l.qty)` L21218; `available=max(0,dispQty-invoiced)` L21224 |
| L21173 client dup-check | `db.invoices.find(…invoiceNo===invNo)` → `toast('Invoice No already exists')` |
| L20922 next-no derivation | `_nextInvNo()` L20919-24: `db.invoices.forEach` → max → `'INV-'+yr+'-'+padStart(3,'0')` |
| **`renderInvoices()` L21096 is the LIST** | **L2457 `invoices: ()=>renderInvoices()` is the ONLY invoice router key.** `_createInvoice` is reached solely from the list button **L21136**; `_viewInvoice` L21273 likewise. **Both are modals.** |

**FOOTER — derived from the CALL SITE, exactly as the four-shape rule requires:** L21170 calls `showModalLg('📄 Create Invoice', body, fn, 'Create Invoice')` — an **explicit `saveLabel`**, so the L28034 title-fallback **never runs**. L28042-44 renders `Cancel` (`.btn-ghost`) + **`✓ Create Invoice` on `.btn-success`**. Ours had `.btn-primary`, no `✓`.

**MONEY VERDICT — the browser sum is the LEGITIMATE exception, and the case is named rather than assumed:**
- `useInvoiceableSo` returns per-line `rate`/qtys and **no totals**.
- `subtotal` / `gstAmount` / `grandTotal` **do not exist until POST**, where the **server computes them itself** (`invoices/service.ts:305-307`) from a payload carrying **only** `{salesOrderLineId, qty, rate}`.
- **No client total is ever transmitted.**
→ This is the **SO-form case** (totals over unsaved form input, no server figure to contradict), **not** the **SO-Costing case** (a browser sum shadowing server-owned figures). Kept, reformatted via `inrFormat`, commented as preview-only.

**Deliberately NOT copied (all correct):**
- **Client dup-check (L21173) + `_nextInvNo()` (L20922)** — the server owns the code (`nextInvoiceCode`, service.ts:249-254, **same max-derivation, correct side of the wire**). Not "restored" (rule 1; the `addItem` precedent).
- **The "Invoice No." field itself** — server-generated with **no value before save**. Rendering an empty readonly box would be **fabrication**. And therefore **no `★`** — legacy stars it only because *there* it's user-typed. Consistent with the Operators / Vendors / Design-Projects refusals.
- **The totals row** — legacy's modal has **none**; **kept** per "never delete a working feature", reported not removed.
- **Legacy's own inconsistency not reproduced:** its list `inr()` (L21110) rounds to **0** decimals while `_viewInvoice`/`_addPayment` show **2** on the same rupee. Chose `inrFormat` (2dp, en-IN) — correct here regardless, since rates are `step="0.01"`.

**Fetched and rendered nowhere** (reported, not added — legacy renders none of them either): `InvoiceableSoResponse.clientGst`, `.customer`, `.soCode`, and `invoiceableLineSchema.lineNo`. **No ISSUE-095 cap** — neither endpoint limits rows.

**Note on `.req`:** the agent grepped it at **innovic-theme.css:639** — confirming ISSUE-102 (I had been briefing **566**, which I invalidated myself by porting classes above it). It exists **only** as `.form-label .req`, so it must nest inside the label. It does.

## ISSUE-142 — 🔴🔴 SO Timeline throws a TypeError (500) for essentially every real SO. VERIFIED END-TO-END.

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** **P1 — the most severe finding on this track.** A dead page in production, not a divergence.
- **Status:** [ ] open — server-side (`apps/api/src/modules/so-timeline/service.ts`); the agent correctly did not touch it (rule 7)
- **Orchestrator note: I VERIFIED every link of this chain myself rather than logging it on trust. All six confirmed.**

**The chain:**

| # | Fact | Evidence |
| --- | --- | --- |
| 1 | `jc_date`, `pr_date`, `po_date`, `grn_date` are **`date`** columns → **OID 1082** | `schema.ts:707, 1306, 1382, 1513` — `date('jc_date')` etc. |
| 2 | The driver is **postgres.js** | `db/client.ts:1-2` — `drizzle-orm/postgres-js` + `import postgres from 'postgres'` |
| 3 | postgres.js **parses OID 1082 into a `Date` object** | `postgres@3.4.9/src/types.js:29-32` — `from: [1082, 1114, 1184]`, `parse: x => new Date(x)` |
| 4 | `so-timeline/service.ts` selects all four via raw `tx.execute` **WITHOUT `::text`** | `service.ts:129, 173, 206, 239` |
| 5 | **The cast LIES to the compiler** | `service.ts:140, 183, 217, 247` — `as unknown as Array<{ jc_date: string }>`. **Typecheck passes because the code asserts a falsehood.** |
| 6 | The sort calls a string method on a `Date` | `service.ts:267` — `events.sort((a, b) => a.date.localeCompare(b.date))` → **`Date.prototype.localeCompare` is not a function → TypeError** |

**Blast radius: `/so-timeline` 500s for any SO with a Job Card, PR, PO or GRN — i.e. essentially every real sales order.** (`sort` invokes the comparator once there are ≥2 events, and any Date-typed value landing in the `a` slot throws.) `so_date` is safe (drizzle select → string); `created_at`/`closed_at` go through `tsLike`. **Only these four raw selects are affected.**

**The codebase already knows the fix — this module just didn't apply it:**
```sql
-- customer-dispatches/service.ts:287
h.dispatch_date::text AS dispatch_date
-- job-work-orders/service.ts:218
agg.earliest_due::text AS "earliestDueDate"
```
Add `::text` to the four selects. **Secondary effect if it ever survived the sort:** a spurious `00:00` on every JC/PR/PO/GRN row.

**The lesson that generalises beyond this page — and it is the important part:**
> **`as unknown as X` is not a type annotation, it is an assertion that the compiler must believe.** Here it asserted `string` over a value the driver guarantees is a `Date`. **Typecheck passing was not evidence of correctness — it was evidence that we told it not to look.** Every `as unknown as` over a raw `tx.execute` result in this codebase is an unchecked claim about driver type-parsing. **Audit them.**

**Why nothing caught it:** see ISSUE-146 — this module has **no tests at all**, violating CLAUDE.md §9. A single integration test hitting an SO with one JC would have failed on day one. *This is the first finding on the track where the missing-tests gap has a proven, specific cost — worth citing when §9 next comes up for negotiation.*

## ISSUE-143 — ISSUE-113 class: "sources not yet ported" is FALSE — all 22 event sources exist

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** P2 — a false comment standing in for unbuilt work
- **Status:** [ ] open

`so-timeline/service.ts:15-17` claims the missing timeline events come from *"sources not yet ported to this codebase"*.

**False. Every one exists in `schema.ts`:** `designTracker`, `bomMasters`, `partyGrn`, `jwDcOutward`/`jwDcInward`, `storeIssues`, `opLog`, `jcOps`, `toolIssues`, `ncRegister`, `assemblyUnits`/`assemblyTracking`, `invoices`, `customerDispatches`.

**And the joins are already available:**
- `designTracker`, `invoices`, `customerDispatches`, `assemblyUnits` carry a **direct `salesOrderId` FK**
- `storeIssues`, `toolIssues` have **`refNo`** — the same key legacy itself uses
- `ncRegister` reaches the SO via `jobCardId`

**The 22 events are UNBUILT, not UNBUILDABLE.** The distinction matters: the comment reads as a blocked dependency and closes the question. It is actually a to-do.

**Third instance of this exact shape** — alongside ISSUE-113 (`sales-orders/service.ts:283-285`'s fabricated "UI shows X+ results") and ISSUE-136 (`so-status/lib/export.ts` citing the wrong line **and** claiming a "mirror" it isn't). **A comment asserting why something can't be done is worth nothing unless re-verified.**

**Coverage: only 7 of 29 legacy event families are ported.** Present: SO Created (L17688), Plan Created (L17708), JC Created (L17713), JC Completed (L17714), PR Raised (L17745), PO Created (L17751), GRN Received (L17758). **Missing (22):** Design Assigned/Review/Approved/Revision (L17692-95), BOM Linked (L17702), Party Material Received/Returned (L17719/17724), JW DC Outward/Inward (L17732/17740), Material Issued (L17763), QC Started/Passed (L17786-90), Op Started/Completed (L17794-98), Tool Issued/Returned (L17805-08), NC Raised (L17814), Assembly Override/Started/Progress (L17819-26), Dispatched (L17832), Invoice Created (L17837).

## ISSUE-144 — ISSUE-065 mech 4 on SO Timeline: events land in the WRONG DAY and can reorder

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** P2 — on a timeline this is not cosmetic
- **Status:** [ ] open — part of the ISSUE-065 sweep

`so-timeline/routes/index.tsx:171-172` — `d.toISOString().slice(0,10)` + `.slice(11,16)` on **`plans.created_at`** and **`job_cards.closed_at`**, both **`timestamptz`** (schema.ts:735, :734).

**A plan created at 02:00 IST renders as the PREVIOUS DAY at 20:30.** On a timeline that doesn't just mislabel — it puts the event in the **wrong bucket** and can **reorder it** against same-day events.

**Compounded by ISSUE-142's sort:** the server mixes date-only strings with UTC ISO strings, so even a working sort would bucket wrongly.

**Good discipline:** the agent kept the local `formatTimelineDate` as the **single call site** (ISSUE-040) so the eventual `formatInTimeZone(v,'Asia/Kolkata',…)` swap stays **one line**. **Also ISSUE-137:** renders `2026-07-15` where legacy's `fmt()` (L1484) renders `15 Jul 26`.

## ISSUE-145 — SO Timeline detail strings are thinner than legacy's

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** P3 — server-side
- **Status:** [ ] open

- **SO Created** drops `partName × orderQty`
- **PO Created** drops the item code and uses **`vendor_code_text`** rather than the vendor name
- **GRN Received** drops `itemCode × receivedQty (QC: status)` and substitutes the PO code

Server-owned strings — correctly not reconstructed in React (rule 1).

## ISSUE-146 — SO Timeline has NO tests, and ISSUE-142 is the proof of what that costs

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** P3 — a CLAUDE.md §9 violation with a now-demonstrated cost
- **Status:** [ ] open

No `service.test.ts` or `routes.test.ts` under `apps/api/src/modules/so-timeline/`. **CLAUDE.md §9 requires a unit test per public service fn and at least one happy-path + one error-path integration test per route.**

**This is why ISSUE-142 — a guaranteed 500 on essentially every real SO — reached the working tree undetected.** One integration test against an SO with a single Job Card would have caught it immediately.

**Cite this when §9 is next treated as negotiable.** The rule didn't fail here; its absence did.

## ISSUE-147 — SO Timeline's SO picker sorts by the wrong field

- **Surfaced:** 2026-07-15 (REFACTOR-1, SO Timeline)
- **Severity:** P3
- **Status:** [ ] open

Our picker sorts **`soDate` desc**; legacy (L19976) sorts **`soNo` desc**.

### SO Timeline — mapping confirmed, and the markup work

**`renderSOTimeline()` L19971** → router key `sotimeline` **L2449** → delegates to **`_soTimeline(soNo)` L17679-17864**. **Registry mapping CORRECT as auto-built** (rare — but verified, not assumed).

**No `_mobSOTimeline` exists** (grep: only the 4 desktop hits) — the `_mob*` rule never fired here.

**`.op-node`/`.op-arrow` trap did NOT apply** — legacy's timeline uses **pure inline styles**, not those classes. *(Worth noting: I flagged them as the thing to watch, and the agent checked and correctly found them irrelevant rather than forcing the concern.)*

**Real work done:** the flat `.panel` list became legacy's **vertical rail** (L17847-62) — absolute 2px `--border` line at `left:13px`, a 20px colour dot per event holding the icon, card `--bg2`/`--border`/radius 10/`border-left:3px solid ev.color`; label coloured `ev.color` at 12px; icon moved out of the label into the dot, per legacy.

**Invented UI removed:** a summary panel (soCode/customer/type/"N events") legacy doesn't have → legacy's single line `📅 SO Timeline — {soCode}` (L17844). **No data lost** — customer still renders inside the SO Created event detail. Also removed an invented `📅 .empty-icon`; legacy's no-events case is a bare centred div, for which `.empty-state` is an exact match.

**Deliberately not copied:** legacy's outer `padding:20px` (the app shell provides it); its `<div style="padding:20px">` empty case (used the sanctioned `.empty-state`, padding 40 — a class over a literal, no new CSS). Loading/error branches have **no legacy counterpart** (legacy is synchronous in-memory) — kept.

**Correctly refused:** client-computing any of the 22 missing events (rule 1); and re-mapping the server's hex `evt.color` to light-theme tokens — **those hexes are API payload, not markup literals.** *(A good call: ISSUE-067 governs markup, not data.)*

**No ISSUE-095 instance** — `routes.ts` has no LIMIT; the SO list query is uncapped (only `.limit(1)` single-row lookups). Nothing to disclose, so no count was added.

## ISSUE-148 — 🔴 ISSUE-128's clone in Invoices: overdue is wrong for everyone before 05:30 IST

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice detail)
- **Severity:** **P1** — money + correctness, server-side
- **Status:** [ ] open — part of the ISSUE-065 sweep

`invoices/service.ts:41-42` — `todayStr()` = `new Date().toISOString().slice(0,10)` drives **`isOverdue()` (L45-47)**, which produces the **`overdue` flag**, **`overdueAmount`** and **`overdueCount`**.

**The server runs UTC. So from 00:00–05:29 IST, every invoice due yesterday is silently NOT overdue** — for every user at once, including the tiles on the Invoices list.

**Third confirmed SERVER-SIDE instance of mechanism 1**, and the pattern is now unmistakable:

| Module | Site | Wrong output |
| --- | --- | --- |
| SO Overview (ISSUE-128) | `service.ts:67-69` `todayIso()` | `delayedLines`, `deriveOverallSoStatus`, **the DELAYED tile**, the filter pills |
| Invoices (this) | `service.ts:41-42` `todayStr()` | **`overdue`, `overdueAmount`, `overdueCount`** |
| calc-engine (ISSUE-065) | `lib/calc-engine.ts:354` | **every** overdue/ageing figure in the engine |

**Client-side instances mislead one user; SERVER-side instances poison a shared figure and a filter — so the SET OF ROWS YOU CAN SEE is wrong, not just their colour.** Prioritise the server sites in the ISSUE-065 sweep.

**Legacy's `today()` L1486-87 uses local components and is CORRECT. Port regression.**

## ISSUE-149 — ISSUE-065 mech 1: the payment date defaults to yesterday before 05:30 IST

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice detail)
- **Severity:** P2
- **Status:** [ ] open

`invoices/routes/detail.tsx:21` `todayStr()` — defaults the **payment date** to **yesterday** before 05:30 IST. Annotated, not fixed, **not duplicated** (no second helper added — the eventual swap stays one line).

**Mechanism 4 verified ABSENT, not assumed:** `invoice_date`, `due_date` and `payment_date` are **all `date` columns** — rendering is zone-safe.

## ISSUE-150 — 🔴 The tax invoice omits the client's ADDRESS

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice detail)
- **Severity:** **P1 — compliance, not cosmetics**
- **Status:** [ ] open — needs `shared` + `api`

**Legacy prints the client's address on the invoice (L21355). We do not.** `InvoiceDetail` carries `clientCode` and **no address field at all**.

**This is a GST tax invoice going to a customer without the buyer's address on it.** Not a parity gap — a defect in a legal document. It needs a schema/DTO field, so it could not be fixed in a markup pass.

**Related, same document (ISSUE-151):** legacy also prints **`PAN: AQKPM4121A`** and **`E. & O.E.`** (L21371). The `companies` table has **no `pan` column**, and our `doc-print.ts` **hardcodes** the PAN. The agent **deliberately did not hardcode it again** — correct: a hardcoded PAN is right for exactly one company and silently wrong for any other, which is precisely the kind of thing that survives a migration unnoticed.

## ISSUE-151 — Invoice print omits PAN / E. & O.E.; `companies` has no `pan` column

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice detail)
- **Severity:** P3 — but see the note on hardcoding
- **Status:** [ ] open

Legacy prints `PAN: AQKPM4121A` and `E. & O.E.` (L21371). **`companies` has no `pan` column**; `lib/doc-print.ts` **hardcodes the value**.

**Correctly NOT hardcoded a second time.** Add a `pan` column and read it. A hardcoded PAN is a multi-tenancy bug waiting to happen — this system has a `company_id` on every table (CLAUDE.md §6 rule 3) precisely because more than one company is expected.

## ISSUE-152 — Payment amount rejected paise (FIXED)

- **Surfaced:** 2026-07-15 (REFACTOR-1, Invoice detail)
- **Severity:** P3 → **fixed**
- **Status:** [x] fixed 2026-07-15

`type="number"` with **no `step`** → the browser default `step=1` **rejected ₹1234.56**. Legacy had **`step="0.01"`** (L21253). Markup-only, so fixed in place. Also added `min="0"`.

**A real ISSUE-104-family bug in the INVERTED direction, and worth noting for the pattern:** the constraint wasn't ported *at all*, and its absence meant the browser supplied a **narrower** default than the schema allows. **A missing constraint is not neutral — the platform fills the gap with its own.**

### Invoice detail — mapping verified (registry error #15) and what was cleared

**All three of my trace points confirmed by direct read:**
- **`renderInvoices()` L21096 is the LIST** — `invoices: ()=>renderInvoices()` at **L2457** is the **only** invoice router key in the file. **Nothing routes to `_viewInvoice`.**
- **`_viewInvoice(invId)` L21273** — verified exact. A **modal** (`showModalLg(…,'Close')` L21311), reached only from the list's code cell (L21117) and 👁 button (L21127). Correct counterpart for `/invoices/$id`.
- **`_printInvoice(invId)` L21314** — verified exact → `lib/print.ts`.

**A false "mirror" comment, caught again — but note the difference from ISSUE-136:** print.ts's **line reference L21314 was RIGHT**; the *claim* was wrong. "Mirror of legacy `_printInvoice`" is false — the client address is dropped, the PAN block is dropped, and dates/qty are formatted differently. **So a correct line number is not evidence of a correct claim either.** Comment replaced with verified deltas.

**Real gaps closed:** legacy's payment **Notes** field (`fPayNotes` L21256, `form-full`) was **missing entirely** — restored and wired. `Mode` → `Payment Mode`. Stats: one panel → **five `.panel` cards** per legacy (L21295-311), restoring its 16/16/18/18/18 sizing. `📄 Invoice {code}` → `📄 Invoice — {code}`; `·` → `|`.

**Money alignment mirrored, not "improved":** legacy's payment Amount is `class="mono fw-700"` — **left-aligned**. Ours had `td-ctr`. **Dropped it to match legacy**, and removed the inert `<th className="td-ctr">`. *(Same discipline as SO Costing, where legacy centres money and right-aligning would have been an improvement rather than parity.)*

**Ours kept because it is BETTER:** legacy computes `bal = grandTotal − totalPaid` **client-side**; our `inv.balance` is **server-owned** (`service.ts:64`). Kept.

**Cleared — checked at the query AND the render site, not assumed:**
- **No browser math on money.** Nothing summed client-side.
- **ISSUE-095 does not apply** — the payments query (`service.ts:136-140`) has **no `.limit()`**.
- **ISSUE-123/124/125-class gaps: NONE.** `isNull(deletedAt)` is present on `invoices`, `invoiceLines` **and** `invoicePayments`. **No negative `<>` filters.** *(A clean result worth recording — it shows the SO-Costing defects are module-specific, not systemic.)*
- **Legacy's client-side `amt > bal` check (L21262) is ALREADY server-side** (`service.ts:399` → `ConflictError`). Correctly not re-implemented (rule 1).

**Deliberately not copied — one call flagged for a ruling:** legacy's plain lines table (L21303) vs our **A4 preview**. Kept ours: no column is lost (Sl/Description/Qty/UOM/Rate/Amount) and the "user direction 2026-06-06" comment is **corroborated, not self-attested** — `lib/print/letterhead.ts` carries the **same date** and explicitly names Invoice. **Available if you want the table added back alongside.**

**A visible seam reported honestly, not papered over:** dates stay raw ISO here (legacy `fmt()` = `15 Jul 26`; shared `fmtDate()` = `15-07-2026` — **neither matches**, so the agent followed the `items/detail.tsx` precedent rather than adding a 13th `fmt()` copy). **Consequence: the sibling `list.tsx` has its own correct `fmt()` copy, so the list shows `15 Jul 26` and the detail shows `2026-07-15` for the SAME `dueDate`.** This is ISSUE-098's shape again — two pages of one module, each locally correct, disagreeing at the boundary. **It closes when ISSUE-040 lands, not before.**

**Tests: `pnpm --filter web test --run` PASS (18/18, 3 files) — but NO test covers `invoiceDocHtml`/`printInvoice`.** The print changes are **uncovered**, on a **legal document**. Worth a fixture test (see ISSUE-146 — SO Timeline's missing tests let a guaranteed 500 through).

## ISSUE-153 — ISSUE-065 mech 1 on the PR date default

- **Surfaced:** 2026-07-15 (REFACTOR-1, PR form)
- **Severity:** P2 — part of the ISSUE-065 sweep
- **Status:** [ ] open

`purchase-request-form.tsx:34` — `prDate: new Date().toISOString().slice(0,10)` → **today in UTC**, so before 05:30 IST a PR defaults to **yesterday**. Legacy's `today()` (L1485-87) uses local getters and is **correct**. Port regression.

**Mech 4 verified ABSENT:** `pr_date` is `date('pr_date')` (schema.ts:1306), not timestamptz → serializing an existing value is safe. **Only the default is wrong.**

**A new data point for ISSUE-040's scope:** there is **no shared helper to reuse here** — **9 local `todayStr`/`todayIso` copies** exist across modules, and this form doesn't even name one, it **inlines the expression**. So the sweep has three shapes to fix, not two: named-but-local helpers, inlined expressions, and the server-side copies. **Fixing needs one shared helper, not a 10th copy.**

## ISSUE-154 — 🔴 A PAGINATED option list silently drops the vendor link on PR edit

- **Surfaced:** 2026-07-15 (REFACTOR-1, PR form)
- **Severity:** **P1** — silent data loss on an edit path
- **Status:** [ ] open — fix is in the query/hook (rule 7)

`purchase-request-form.tsx:67` — `useVendorsList({ limit: 200, offset: 0 })`. **`listPurchaseRequestsQuerySchema` caps limit at 200, so 200 is the CEILING, not a choice.**

**If a PR's vendor is beyond the first 200:** the select has **no matching `<option>`** → the browser falls back to `selectedIndex=0`, which is `""` (*"— Free-text vendor below —"*) → `onValid` emits **neither `vendorId` nor `vendorCodeText`** → **the vendor link is silently dropped on save.**

**Legacy sidesteps it entirely** — an **open datalist over the full vendor set**.

**This is a NEW SUB-SHAPE of the ISSUE-104 filter pattern, and I did not anticipate it.** The pattern so far was *narrow select*, *`min`/`step`*, *`<>`/`!==`*, *filtered option list*. **This is a PAGINATED option list — the values aren't excluded by a predicate at all, just by a page boundary.** The failure mode is identical, and it is arguably harder to see: nothing in the code says "exclude", and the list looks complete.

**Updated statement of the rule:**
> **Any option list that is not guaranteed to contain every stored value will silently rewrite out-of-list values on save. It doesn't matter whether they're excluded by a `<>`, a status filter, a narrow enum, or a `limit`. On an EDIT path this is data loss.**

**Check every `useXList({ limit: N })` feeding a `<select>` on an edit form.**

## ISSUE-155 — PR vendor: our create REQUIRES it, legacy calls it "(optional)", and neither control is starred

- **Surfaced:** 2026-07-15 (REFACTOR-1, PR form)
- **Severity:** P2 — needs a schema-or-UX ruling
- **Status:** [ ] open

`createPurchaseRequestInputSchema` refines **`vendorId || vendorCodeText`** — a vendor is **required**. Legacy L6535 labels it **"Vendor (optional)"** and L6502 happily writes `vendorCode:''`.

**So a user who picks no vendor gets a SERVER-side rejection surfaced through `submitError`, with no `★` anywhere to warn them.**

**Both available "fixes" would be wrong, and the agent correctly did neither:**
- **Adding a `★`** — the requirement is a **one-of pair across two controls**. Starring either alone is false; starring both is also false.
- **Relabelling to legacy's "(optional)"** — would ship text saying *optional* while our server **rejects** it. **Trap 1, inverted.**

**This needs a decision above a refactor's remit:** either relax the schema to match legacy, or design an honest one-of affordance.

## ISSUE-156 — PR edit shows a blank Item Code for cascade-created PRs

- **Surfaced:** 2026-07-15 (REFACTOR-1, PR form)
- **Severity:** P2
- **Status:** [ ] open — needs the detail endpoint to join `itemCode`

`detailToFormValues` fills `itemCodeText` from `detail.itemCodeText` **only**. `purchaseRequestSchema` (the **detail** shape) has **no resolved `itemCode`** — only `purchaseRequestListItemSchema` joins it.

**So a PR created via the JC-outsource cascade (`itemId` set, `itemCodeText` null) renders an EMPTY Item Code box on edit.**

**No data loss** — the value survives submit (`onValid` falls through to `values.itemId`) — but the user sees a **blank, required-looking field** on a record that is actually fine. **The list and detail shapes disagree about what a PR is**, which is the underlying defect.

### PR form — mapping verdict (registry error #16) and the refusal made PREDICTIVELY

**`/purchase-requests/$id/edit` → NO LEGACY COUNTERPART, category 4.** `editPR|_editPR|prForm|_prForm|editPurchaseRequest` → **zero hits in 29k lines.**

**Corroborated, not merely absent** — the list's row actions (L6255-6270) are **exhaustively**: `approvePR` (Pending), `cancelPR` (Pending), `createPOFromPR` (Approved), an inline `viewPO` link (PO Created), `_assignTaskFromContext` (Admin/Manager). **No edit affordance on ANY status.** Legacy's only PR write paths are `_addDirectPR` (create), `approvePR`, `cancelPR`, plus cascades that *originate* PRs from Plans/JC-ops. **A PR is create-then-approve-or-cancel; legacy never re-opens one for field editing.**

**`/purchase-requests/new` → `_addDirectPR` L6475** (`showModalLg('📝 New Purchase Request — '+prNo)` L6480), body **`_dprFormHtml` L6515**.

**🔴 THE REFUSAL WORTH RECORDING — the ISSUE-104 pattern used PREDICTIVELY, to avoid CREATING a defect:**
The agent declined to convert our free-text `operation` into legacy's 7-option **Category** select. Reason: **`operation` holds a UNION of legacy's category vocabulary AND real operation names** — L6502 defaults it to `'Direct'`, and JC-sourced PRs store **actual op names** (legacy's own list column L6280 renders `pr.operation` raw; our placeholder `COATING / TURN / …` reflects this). **A 7-option closed select over a nullable free-text column would silently rewrite those on edit — manufacturing the exact cost-center `department`/`type` trap on purpose.**
*This is the first time the pattern has been used to predict a defect a "faithful" port would have introduced, rather than to diagnose one. That is the pattern earning its keep.*

**Legacy inconsistency found and correctly NOT ported:** `_dprCatCCMap` (L6567) maps `'Packaging':'Dispatch'` — but **`'Packaging'` is not an option in the Category select** (L6534). **A dead map entry in legacy.** Add nothing.

**Real drift fixed (both `★`s, aligned to actual per-mode constraints):** `★` **added** to Item Code in **create** (legacy stars it at L6555 *and* our create schema refines `itemId||itemCodeText`); `★` **removed** from PR No. in **edit** only (`code` is `.omit()`ed from the update schema, `required:false`, readOnly, never in the payload — **the star denoted nothing**), kept in create. Also `.form-grid-3` → **`.form-grid`** (legacy L6530 is plain `.form-grid`; **both systems define it as `1fr 1fr`** — legacy L196, port L613 — so our 3-col was invented), and field order → legacy's sequence.

**A subtle mapping catch:** legacy's slot-3 **Category** select **is literally the source of `operation`** — evidence at L6502, `operation: category||'Direct'`. Our Operation field belongs in that slot; it had been buried between Item Name and Qty.

**FOOTER, derived from the call site:** `showModalLg(…, 'Create PR')` → **`✓ Create PR` on `.btn-success`** (ours had `Create PR`/`.btn-primary`). Edit's `Save changes` → **`✓ Save PR`/`.btn-success`** for create/edit agreement — **there is no legacy spec for edit, so the two modes must at least agree with each other.** Note L28044 renders `&#10003; ${_saveLabel}` — **the `✓` prefixes the label even when `saveLabel` is passed explicitly.**

**Deliberately NOT copied (all correct, all needing API/schema work):**
- **Multi-line PR entry** (`_dprLines`, `+ Add Line`, the 7-col line table, and the **`prNo-1`/`prNo-2` fan-out at L6499 that pushes ONE PR ROW PER LINE**). Our model is single-row by **ADR-015 #2** and the API accepts one PR per POST. Legacy's line fields already live on our header — **the correct single-row flattening.**
- **Cost Center + `_dprCatCCMap` auto-fill + `_dprSOChanged` SO→costCenter auto-fill** — **`purchase_requests` has no `cost_center` column** (`cost_centers` exists at schema.ts:509; `sales_orders.cost_center` at 1020; `service_pos.cost_center` at 4892 — **but not PRs**). Nowhere to bind.
- **The conditional Raw-Material SO panel + its "SO No. is required for Raw Material" rule** (L6543-47, L6492) — our schema has **`sourceSoLineId`** (FK to SO **lines**), legacy has `soNo`/`soRefId` (SO **header**). **Not the same grain.** Shipping the panel without the server-side rule would be Trap 1.
- **PR No. auto-generation (`_nextPRNo()`)** — our create API **requires** a client-supplied `code`; making the field readOnly would make the form **unsubmittable**.
- **Status control kept** (legacy hardcodes `status:'Pending'` and has no control) — per "legacy has fewer fields → KEEP ours", reordered after legacy's header block.
- Left untouched: the `submitError` banner's inline styles + `#fca5a5` literal and `style={{marginTop:16}}` — **pre-existing, no class exists** (`.mt-16` confirmed absent), and legacy uses `toast(…,'err')` here rather than a banner. **Not a "while I'm here" cleanup.**

**No money math on this form** — `estCost` is a plain bound input; no client total is computed or transmitted, so neither rule 1 nor `inrFormat` arises.

## ISSUE-157 — ISSUE-065 mech 1 on a PRINTED PO: the document shows yesterday's date

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO detail)
- **Severity:** P2 — on a document that goes to a vendor
- **Status:** [ ] open

`purchase-orders/lib/print-po.ts:64` — `date: fmtDate(new Date().toISOString())`. `fmtDate` **regexes the string** (`doc-print.ts:34-38`), so it takes the **UTC** Y-M-D → the `{date}` template variable on a **printed PO** shows **yesterday** between 00:00-05:29 IST.

**Legacy L25969 is `fmt(today())` — local components, CORRECT. Port regression.**

**Mech 4 verified ABSENT, not assumed:** `po_date`/`due_date` are **`date`** columns (schema.ts:1382, 1387, 1454) → safe.

**Why this one is worse than a screen instance:** a printed PO is **sent to a vendor** and filed. A wrong date on screen is corrected by the next render; a wrong date on a despatched document is a durable artefact.

## ISSUE-158 — Every printed PO says "NOS" regardless of the item's real UOM

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO detail)
- **Severity:** P2 — a constant in the costume of a measurement, on a vendor-facing document
- **Status:** [ ] open

`purchase-orders/lib/print-po.ts:104` — **`uom: 'NOS'` is HARDCODED** for every line.

**Legacy L25937 reads `it.uom||'NOS'`** — the item's real UOM, defaulting **only when absent**.

**So a PO for 500 KG of bar stock prints "500 NOS".** To a vendor.

**Same shape as ISSUE-127** (`issuedQty: 0` styled like real data) and **ISSUE-133** (`{hold:false}` hardcoded): **a constant rendered where a measurement belongs.** The port turned legacy's *fallback* into a *value* — which is now a recurring mechanism worth naming:
> **Legacy writes `x || 'default'`. The port drops the `x` and keeps the `'default'`.** Three instances now (this, ISSUE-159's two terms). **Grep for suspiciously round hardcoded strings in print/export paths.**

## ISSUE-159 — The printed PO fabricates its Payment and Delivery terms

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO detail)
- **Severity:** P3 — needs schema, not a UI patch
- **Status:** [ ] open

`print-po.ts:68-69`:
- **`paymentTerms: 'As per agreement'`** — hardcoded. **Legacy L25973 is `first.paymentTerms||'As per agreement'`** — a **fallback**, not a constant.
- **`deliveryTerms`** — **invented** as `` `By ${dueDate}` ``. **Legacy L25974 is `first.deliveryTerms||''`.**

**Root cause: `purchaseOrderSchema` has NO `paymentTerms` / `deliveryTerms` columns — so the fallback BECAME the value.** Every PO ships identical commercial terms, and one of them is fiction.

Same mechanism as ISSUE-158. **Needs schema columns, not a markup fix.**

## ISSUE-160 — PO detail cannot show totals or GRN receipts

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO detail)
- **Severity:** P2 — server-side
- **Status:** [ ] open

Three legacy blocks have no data to bind:
- **Grand Total tile (L26394) + totals box (L26405-26429)** — the API returns **no totals**, and deriving tax in React is **frontend business logic** (rule 1). **A read-only detail page has no preview exception** — that exemption belongs only to forms previewing unsaved input.
- **GRN RECEIPTS table (L26430-26437)** — the payload carries no GRNs.
- **Per-line Status (L26347)** — `purchaseOrderLineSchema` has no status field.

Correctly not invented.

## ISSUE-161 — 🔴 ISSUE-124's TWIN in the UI: `outsource` POs get a "Receive GRN" button and no DC

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO detail)
- **Severity:** **P2** — the wrong workflow offered on a real PO type
- **Status:** [ ] open — logic, correctly not fixed here

`purchase-orders/routes/detail.tsx` gates on:
- `poType === 'job_work'` → **Issue DC**
- `poType !== 'job_work'` → **Receive (new GRN)**

**`PO_TYPES = ['standard', 'job_work', 'outsource', 'service']`.**

**So an `outsource` PO — material sent OUT to a vendor — is offered "Receive GRN" and denied a DC.** The user is pushed into the wrong half of the workflow.

**Identical root cause to ISSUE-124** (SO Costing double-bills via `po.po_type <> 'job_work'`): **legacy's `poType !== 'Job Work'` was correct over a TWO-value vocabulary; ours has FOUR.**

**This is the finding that settles the fix's shape.** One instance looked like a query bug. **Two instances, in different layers (a SQL CTE and a React branch), from the same widened enum, means the fix is an ENUM-WIDE AUDIT — not a one-line patch.**

> **Grep every `job_work` / `'Job Work'` comparison across api + web. Each one was written against a 2-value world.**

### PO detail — mapping verdict (registry error #17): a REAL renderer, found past a DECOY

**`viewPO(id)` L26299-26438.** The chain matters because the obvious answer was wrong:

1. **`renderPurchaseOrders()` L25209 is the LIST** — it builds the stat-filter row, the `poTable` `<thead>` (L25350-55) and the "No purchase orders yet" empty state. `routes/list.tsx:1` already declares itself its port.
2. **It DOES contain an expand row** (`window._poExpanded`, `<tr><td colspan="11">` L25276-25303) — **the BOM-Master shape, so the obvious call was "detail hidden in the list".** But that block is a **PO-lines sub-table**, and **`list.tsx:20-22` already declares it deliberately unported** ("the list payload has no lines"). **A decoy.**
3. **The real detail is one hop further:** L25259 `items=[{label:'View', onclick:"viewPO('"+esc(first.id)+"')"}]` → **`viewPO(id)` L26299**, a `showModalLg` (L26357) with vendor/details boxes, 5 summary tiles, a PO-line table with its own `<thead>`, a totals box and a GRN table. **`list.tsx:23-24` independently corroborates:** *"No Approve/Reject/Print row actions… Both live on the detail page, one click away via View."*

**Category (2) — a real renderer, refactored.** *Lesson: an expand row matching the BOM shape is not proof; check whether it's the SAME CONTENT as the detail, and whether the list already claims it.*

**Print source VERIFIED, and the comment is TRUE — a clean result worth recording.** `printPO(poNo)` **L25913-26131**. `lib/print-po.ts:5-6` claims *"Mirrors legacy printPO (L25913): subtotal → IGST or SGST+CGST per taxType → grand → words"* — **the line is right AND the narrow claim holds** (L25920→L25926→L25927→L25952). **After three fabricated comments (ISSUE-113, 136, 143), this one survived scrutiny.** *Comments aren't worthless — unverified ones are.*

**And the PO print does NOT have the Invoice's compliance omission:** `doc-print.ts:244` emits both **`Company's PAN`** and **`E. & O.E.`**, matching legacy L26122. **So ISSUE-150/151 are Invoice-specific, not systemic.** (The hardcoded PAN remains — untouched, per ISSUE-151.)

**Real gaps closed:** the **Vendor | PO Details** boxes (L26364-76) were missing entirely — `useVendor` was **already fetched** and its `addressLine1`/`city`/`state`/`gstNumber`/`contactPerson` **rendered nowhere** (print-only). The **summary tiles** (L26377-99) were missing. The line table went from **8 columns to legacy's 11** (`#|Item Code|Item Name|Source|Qty|Rate|Amount|Received|Pending|Due|Remarks`) — and **`lineRemarks` was fetched but rendered nowhere** (legacy shows it at L26346).

**Tiles NOT built with `.stat-card`** — legacy hand-rolls them inline with `.mono .fw-700` and does **not** use the class. **Correctly not misappropriated.**

**Money format — parity beat consistency, correctly:** kept **`toFixed(2)`** over `inrFormat`, because **legacy's DETAIL uses `.toFixed(2)`** (L26392/L26409) and only `printPO` uses `inr()`. *(Contrast SO Costing, where legacy's own two screens disagreed and consistency was the right call. Here legacy is internally consistent — so follow it.)*

**Alignment mirrored, not improved:** `td-right` → **`td-ctr`** on money/qty — **legacy centres them** (L26341-45).

**Nothing deleted:** the panel-hdr `qty X/Y · value ₹Z` span was **relocated, not removed** — those figures are now the tiles, which is legacy's home for them.

**Deliberately NOT copied:**
- **The `Job Work PO` / `With Material PO` badge (L26306-07)** — labelling an `outsource`/`service` PO **"With Material PO"** is **ISSUE-161 rendered in markup**. Shows the real enum value instead.
- **Legacy's `fmt()` date format** — `list.tsx:154` renders `poDate` raw too, so formatting **only** the detail would open **an ISSUE-098-shaped seam inside one module**. Closes module-wide with ISSUE-040, not before. *(Same reasoning as the Invoices list↔detail seam — the agent chose a visible-but-consistent gap over an invisible inconsistency.)*
- **Cancelled → green "Closed"** (L25239 folds `Cancelled` into `allClosed`) — **a legacy bug.**

**Open question for a ruling:** `po-status-badge.tsx` maps `cancelled → b-grey`, but legacy's generic `badge()` L1963 says **`'Cancelled':'b-red'`**. Left alone — the badge is **shared with `list.tsx`** (out of scope) and the header status badge has **no `viewPO` counterpart**, so **there is no single legacy authority to defer to.**

## ISSUE-162 — 🔴 The PO over-ordering cap does not exist in the port

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form)
- **Severity:** **P2** — a real procurement control, silently absent
- **Status:** [ ] open — needs schema + API, not markup

Legacy's PO form binds a PO to an SO/JW (**"Against SO / JW"**) and enforces a **cumulative 105%-of-SO-qty over-ordering cap** (`addPO` **L25743-73**, `editPO` **L25808-35**).

**Our PO header schema has no `soRefId` at all.** Lost with it:
- the **105% cumulative cap** — the control itself
- the **SO-line-restricted item select**
- **per-line `max=remainQty`**
- **`_poFromSO` auto-populate**
- the restriction banner

**This is not a styling gap.** Legacy stops a buyer ordering 300 units against a 100-unit SO. **We accept it silently.** Unportable without schema + API work, so correctly reported rather than approximated.

**Related and also absent — ISSUE-163.**

## ISSUE-163 — PO revision tracking does not exist in the port

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form)
- **Severity:** P2
- **Status:** [ ] open

`editPO` **L25856-96** diffs old vs new **qty + rate**, bumps **`poRevision`**, writes a **`poRevisionLog`** entry (rev / date / changedBy / notes / snapshot) and toasts *"Rev N"*.

**Our update path has no equivalent.** A PO's commercial terms can change with no record of what changed, when, or by whom — on a document that goes to a vendor.

**Contrast BOM Master (ISSUE-112), where we do this BETTER than legacy** (we snapshot every revision; legacy can't recover rev 1). **So the capability exists in this codebase — it just wasn't built here.**

## ISSUE-164 — Print PO / Print Challan missing on PO edit

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form)
- **Severity:** P2
- **Status:** [ ] open — deliberately not wired (file ownership)

Legacy renders **Print PO / Print Challan** on the edit modal (**L25636-39**; Challan further gated on `poType === 'Job Work'`). Ours has neither.

**`lib/print-po.ts` exists and works** — the PO detail agent verified its parity comment is accurate. **Not wired here only because another agent owned that file this batch.** A straightforward follow-up.

**Note the gate is an ISSUE-161 site:** `poType === 'Job Work'` is a **two-value** test in a **four-value** world.

## ISSUE-165 — ISSUE-065 mech 1 on the PO date default

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form)
- **Severity:** P2
- **Status:** [ ] open

`HEADER_DEFAULTS.poDate = new Date().toISOString().slice(0,10)` → **today in UTC** → **yesterday between 00:00-05:29 IST**. Legacy's `today()` L1485-87 uses local components and is **correct**. Port regression.

**Mech 4 verified ABSENT:** `poDate` is `date('po_date')` (schema.ts:1382), **not** timestamptz.

**No local helper existed to reuse** — so this is another *inlined expression*, not a named copy. **Third shape confirmed for the ISSUE-040 sweep** (named-local helpers · inlined expressions · server-side copies).

## ISSUE-166 — Stale tax percentages persist after a tax-type switch

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form)
- **Severity:** P3 — money-adjacent
- **Status:** [ ] open — logic

Legacy `_getPoBaseData` **L25722-24** **zeroes the non-applicable percentages** and defaults blanks to **9 / 9 / 18**. Our `onValid` submits **all three raw**, defaulting to **0**.

**So switching SGST/CGST → IGST leaves the old percentages on the record.** Reported, not rewired.

## ISSUE-167 — 🔴 The paginated-option-list defect, found INDEPENDENTLY in a second module

- **Surfaced:** 2026-07-15 (REFACTOR-1, PO form — **discovered independently of ISSUE-154**)
- **Severity:** **P1** — silent data loss on an edit path
- **Status:** [ ] open — the cap is in a hook call

The PO form's vendor `<select>` is fed **`useVendorsList({ limit: 200 })`**. **A `<select>` can only hold a value that is an option.** With >200 vendors, **editing a PO whose vendor falls outside the first 200 silently drops `vendorId`.**

**Legacy sidesteps it with a DATALIST — free text survives.**

**⚠️ THIS IS THE SAME DEFECT AS ISSUE-154 (PR form), FOUND BY A DIFFERENT AGENT, IN A DIFFERENT MODULE, WITH NO KNOWLEDGE OF THE OTHER.**

**Two independent discoveries settle it: this is a systemic class, not an incident.** Both instances share the exact shape — a `limit: N` hook feeding a `<select>` on an **edit** path, where legacy used an **open datalist**.

**The rule, in its final form:**
> **Any option list not guaranteed to contain every stored value will silently rewrite out-of-list values on save — whether excluded by a `<>`, a status filter, a narrow enum, or a PAGE BOUNDARY. On an edit path this is data loss.**
> **A `limit: N` is not a predicate. Nothing in the code says "exclude". The list looks complete. It is invisible to typecheck, lint, and review.**

**Audit action:** grep every **`useXList({ limit: N })`** feeding a `<select>` on an edit form. **Legacy's datalist choice was not incidental — it is immune to this by construction**, because free text survives when no option matches.

### PO form — mapping (my brief was incomplete; correction #10) and the drift

**I named `_poLinesHtml` L25487 as the likely shared builder. I missed the actual one.**

| Legacy fn | Role |
| --- | --- |
| `addPO()` **L25728** | create — `showModalLg('+ New Purchase Order', poHeaderForm(null), fn)` |
| `editPO(id)` **L25790** | edit — `showModalLg('Edit PO — '+po.poNo+' / Line '+…, poHeaderForm(po), fn)` |
| **`poHeaderForm(po)` L25605** | **the actual shared body builder — my brief never named it** |
| `_poLinesHtml()` **L25487** | **serves both, but INDIRECTLY** — called from inside `poHeaderForm` at **L25673**, not from `addPO`/`editPO` |

**"Your 'most likely' was right for the wrong reason."** *The lesson matches the `editSOLine` correction: I trace a plausible call and stop, instead of following it to the thing that actually renders. Right conclusion, unsound derivation — which only holds until it doesn't.*

**Legacy IS mildly asymmetric here — mirrored per-mode, not unified.** Exactly **two** `po`-driven conditionals inside the one `poHeaderForm`:
1. **Print PO / Print Challan** (L25636-39) — **edit only** (Challan further gated on `poType==='Job Work'`)
2. **PO No.** (L25642) — create: `_nextPONo()`, **editable**; edit: `po.poNo` + **readonly**. Consequence: **`addPO` validates `!b.poNo` (L25735); `editPO` doesn't.**

**ISSUE-099 → 8 for 8. And our drift is LITERALLY the SO form's drift #2:** a **`★` on PO No. in create only**, on a field that is **`.optional()` and server-generated**. **Removed in both modes** (Operators / Vendors / Invoice precedent). Submit was `Create PO`/`Save changes` on `.btn-primary` → **`✓ Save PO` on `.btn-success`** in both.

**Real structural work:** lines went from **card-per-line → legacy's TABLE** (`_poLinesHtml` L25489): `# | Item / SO Line ★ | Name | Mat. | Qty ★ | Rate (₹) | Amount | Due Date | ×`, rowspan-2 `#`/`×`, a second `<tr>` for line remarks, `idx%2` striping, empty row `No lines — click + Add Line`. **`Received` appended LAST (edit only) so legacy's order stays intact.** New: **`Mat.` column**, **`Amount` column**, **`▸ PO LINE ITEMS` header + `N lines · Qty: X` banner**, **`+ Add Line`**, **`▸ TAX` panel + Subtotal/SGST/CGST/IGST/Grand Total**.

**Money — the case NAMED, not assumed** (the standard the Invoice agent set): this is the **preview-of-unsaved-input** exception. Verified: `createPurchaseOrderInputSchema`/`updatePurchaseOrderInputSchema` have **no total field**; `service.ts` stores only `taxType` + pcts and aggregates only `totalQty` — **it never computes a total**. The sole downstream consumer is `print-po.ts`, which **recomputes from qty/rate/pcts**. **No server-owned figure is duplicated.** Uses `inrFormat`.

**Deliberately NOT copied — a strong set, several predictive:**
- **Tax toggle → kept our `<select>`.** Legacy's 2-button `_poTaxToggle` (L25563) can only write `sgst_cgst|igst`; our `taxType` is a **nullable free string ≤32** and rows may hold `null`/`'none'`. **Porting the toggle would silently rewrite them on edit — ISSUE-119 exactly.** *Predictive use of the pattern, second instance.*
- **pct `min="0" max="50" step="0.5"` → not ported.** Schema is `nonnegative().max(99.99)`: **`step="0.5"` rejects a valid 9.25** (ISSUE-152 class) and **`max="50"` narrows vs 99.99**. Kept `step="0.01" min={0}`, no max.
- **Vendor `status==='Active'` filter (`_dlVendors` L1603) → not ported** — same reason as ISSUE-167: it would drop deactivated-vendor links on edit.
- **PO Type 2 options → kept our 4** (`standard, job_work, outsource, service` — the ISSUE-124/161 set). **Never narrow.**
- **Status readonly input (L25650) → kept our editable select.**
- **📌 "Items must exist in Item Master. If SO/JW is selected, lines auto-populate." (L25713) → NOT shipped.** **Both claims are false here** — our schema accepts off-master `itemCodeText`, and there is no SO/JW field (ISSUE-162). **Trap 1 / ISSUE-100.**
- **Remarks `<input>` (L25661) → kept textarea.** `max(2000)`, may hold multi-line; **`<input>` strips CR/LF on value assignment → edit data loss.** *(Note: this is the Clients/Vendors `<textarea>` question — ISSUE-104's newline variant — decided the SAFE way here. It still needs one ruling applied consistently across all three.)*
- **Name as read-only span → kept as an input + `★`.** Legacy hard-requires on-master items; our schema requires `itemName.min(1)` **and** accepts off-master text → must stay editable, and the star is honest (**inverse rule**).
- Header **Due date** and **PR ref (audit)** are **ours**, absent in legacy — **kept**.

**`★` in a `<th>` is PLAIN TEXT, not `.req`** — `.req` exists **only** as `.form-label .req` (innovic-theme.css:639) and is **inert outside a label**; plain grey matches legacy there exactly. *(Same call the Route Card agent made independently.)*

**Noted, untouched:** `approvalRemarks` is in `FormValues` and **submitted but has no input in either mode** — round-trips via `defaultValues` on edit (no loss), inert on create. **ISSUE-088/089:** `_poInitialStatus()` L21589 → `_poNeedsApproval() ? 'Draft' : 'Open'` is the approval gate feeding this form's status. **Approval is logic — reported, not rewired.**

## ISSUE-168 — Job Card QC docs: `docName` is a silent sink (schema field, no column, never written)

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC form)
- **Severity:** P2
- **Status:** [ ] open — needs a migration + service change before any UI

Legacy's QC-docs table (L5817) has **3 data columns**; ours has **2**. The missing one is **"Document Name / Ref No."**.

**`jcDocInputSchema.docName` EXISTS** (`packages/shared/src/schemas/job-card.ts:169`) — but **`file_registry` has no `doc_name` column**, and **`registerQcDocs` (service.ts:622-636) never writes it.**

**The agent deliberately did NOT add the input.** Correct: it would render a field the user fills and the server **silently discards** — Trap 1 / ISSUE-100 in its purest form. **The schema field is the trap here**: it makes the UI look buildable and typechecks fine.

**A new variant worth naming:** a **DTO field with no column and no writer**. Distinct from "fetched but never rendered" (12+ pages) — this is the inverse: **renderable, accepted, validated, and dropped.** Grep for other input-schema fields with no corresponding column.

## ISSUE-169 — 🔴 The Job Card's SO/WO/JW field renders BLANK on every edit

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC form)
- **Severity:** **P1** — visible on every JC edit
- **Status:** [ ] open — a state fix, outside markup scope

`sourceText` is a **`useState` initialiser** reading `sourceOptions`, which is **`[]` on first render** (the query starts when the form mounts) and **never re-syncs**.

**So the SO/WO/JW box is empty on every edit — while the balance banner beneath it correctly shows the order** (it's computed per-render). The field looks unset; the banner says otherwise. **Actively confusing rather than merely wrong.**

**Not data loss** — `sourceLineId` is seeded from `model` and re-sent — **unless the user types in the box**, which nulls it. So the natural reaction to the bug (retyping the value that looks missing) is what triggers the loss.

## ISSUE-170 — Job Card edit doesn't offer the currently-linked CLOSED source line

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC form)
- **Severity:** P2
- **Status:** [ ] open

**Legacy explicitly unshifts the currently-linked CLOSED order into the datalist** (**L5947-50**) so that editing a JC doesn't lose it. Our `useJobCardSourceOptions` returns **open lines only**.

**Same class as ISSUE-104/154/167** — an option list that isn't guaranteed to contain the stored value. **Mitigated only because the ID lives in state**, not because the list is right. **And legacy guarding against it is the third such safeguard we failed to port** (alongside the SO form's `bomMasterId=origBomId` at L12482 and legacy's datalist-over-select choice).

## ISSUE-171 — The ✕ on an existing QC-doc row lies

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC form)
- **Severity:** P2 — an affordance that reports success and does nothing
- **Status:** [ ] open

The ✕ removes the row **from the UI**, but **`updateJobCard` only ADDS docs** (service.ts:864-879 — its own comment: *"Removal … is done via the file_registry/SO-Documents delete UI"*).

**So: user clicks ✕, the row disappears, they save, they believe it's deleted — and it reappears on reload.**

**Same family as ISSUE-117** (SO edit's upload control eats files): **a control whose visible effect and actual effect disagree.** The service comment shows this is *known* — which makes the surviving ✕ the defect.

## ISSUE-172 — ISSUE-065 mech 1 on the JC date default (a 10th local copy)

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC form)
- **Severity:** P2
- **Status:** [ ] open

`job-card-form.tsx:55` — `const today = () => new Date().toISOString().slice(0,10)` → **today in UTC** → **yesterday between 00:00-05:29 IST**. Legacy's `today()` L1485-87 uses local components and is **correct**. Port regression.

**Mech 4 verified ABSENT:** `jcDate` is a **`date`** column (schema.ts:707), not timestamptz.

**A LOCAL HELPER (not inlined) — the 10th copy** for the ISSUE-040 sweep. All three shapes now confirmed: **named-local helpers** (this) · **inlined expressions** (PR/PO forms) · **server-side copies** (ISSUE-128/148).

### JC form — the builder found by CALL SITE, and the ISSUE-099 streak BREAKS at 8

**Shared body builder: `jcModalBody(jc)` L5943 — proven from the call sites, not the name:**
- `addJC` **L6025** → `showModalLg('New Job Card', jcModalBody(null), …, 'Save Job Card')`
- `editJC` **L6086** → `showModalLg('Edit Job Card — '+jc.jcNo, jcModalBody(jc), …, 'Save Job Card')`
- **Same grain as our routes** (whole record) — so the `editSOLine` trap does not apply here.
- **`jcModalOpsHtml` L5868 and `jcModalDocsHtml` L5809 are DELEGATES called from INSIDE it** (L6012 / L6016) — **exactly the `_poLinesHtml` shape.** *I named the delegate in the brief; the agent found the builder because it was told to. That instruction is now load-bearing — keep it in every form brief.*
- `renderJobCards` L5739 is the LIST — unused, as expected.

**🟢 ISSUE-099: OUR FORM IS CLEAN. The 8-for-8 streak breaks — and the reason matters.** The create/edit drift (JWSO-only label, create-only `★`, governance hint) **exactly mirrors the SERVER's own asymmetry**: `createJobCard` (service.ts:647-651) **throws if `!input.sourceJwLineId`**; the update path (L855-858) **has no such guard**. **So the create-only `★` marks a constraint that is genuinely enforced on create and genuinely absent on edit.** Kept, per "keep a `★` our schema genuinely requires". **Drift that mirrors a real server asymmetry is not drift.**
**ISSUE-117 checked: no upload is create-only** — drawing and QC-doc inputs are wired in **both** modes.

**🟢 ISSUE-104 audit CLEAN — and the reason is the counter-example that proves the rule:**
> **Every `useXList({limit:500})` here feeds a DATALIST (open, free-text), not a `<select>`. Out-of-list values survive.**
**This is the structural immunity legacy had by construction — and this module kept it.** It confirms ISSUE-154/167 are about the **control type**, not the limit: *a `limit: N` behind a datalist is harmless; behind a `<select>` it is silent data loss.*
Also: `useVendorsList` + `.filter(isActive)` **mirrors legacy's identical `status==='Active'` filter** and **cannot rewrite a stored code** (free-text input, value preserved in state). `priority` select = `JC_PRIORITIES` **exactly** (`['normal','high']`).

**🟢 AND WE ARE BETTER THAN LEGACY HERE:** the `QC_DOC_TYPES` select is narrow over a free-text `doc_type` column — **but existing docs are filtered out of the payload (`!d.id`), so nothing is rewritten. Legacy re-sends all docs and HAS this bug.**

**Real gaps closed:** legacy's **`#fSoLineDisplay`** line readout was missing — `[JW] Line N` + **`[CPO:…]`** + code · part · customer; **`clientPoLineNo` was already on our schema and rendered nowhere** (the "fetched but never rendered" class, 13+ pages). Drawing section **lifted out of the details grid** into legacy's own four-section order. Ops table gained the machine-name readout (legacy `#mn_i`), the QC green left border, the `🔬 QC INSPECTION` chip, legacy's YES/NO checkbox shape, and `<th>` colours. **Footer → `✓ Save Job Card` on `.btn-success`** (explicit `saveLabel` at L6073/L6124; **L28044 prefixes `&#10003;` even on an explicit label**).

**Legacy quirks copied deliberately** (they're the spec): the ops counter **pluralises off the TOTAL count** (L5927); Program/Tool render a literal `—` on QC rows (legacy's `emptyCells`) rather than disabled inputs.

**Legacy DEAD CODE found — nothing to port (2 instances):**
- **The QC column** — `qcCell` is built (L5898) but **never inserted into the row** (L5923). **Legacy renders no QC column at all.** Ours binds real `jc_ops.qc_required` → **kept** (legacy has fewer → keep ours).
- **`rcHint`** — `rc` requires `jc` truthy, then `rcHint = rc && !jc` → **always `''`**. Nothing to port; and route-card auto-load is **backlogged by JC-1**, so shipping "will auto-load" text would be **Trap 1**.

**Deliberately NOT copied:**
- **`JC No. ★`** (L5973) — legacy stars it; **ours is server-generated**. Omitted per the standing rule (Operators/Vendors/Invoice/PO precedents).
- **`Cycle(h)`** (L5932) — **legacy's header says HOURS; our column is `cycle_time_min`, MINUTES** (schema.ts:795). Porting "(h)" would **mislabel the unit users type into**. Kept **`Cycle (min)`**. *(A unit mismatch is the sharpest possible label bug — worth generalising: check the column's unit before porting a header.)*
- **`_selQCProcesses` QC dropdown** (L5877) — **refused predictively**: our `operation` is free text holding a wider vocabulary; a narrow select over a wider column **manufactures** the ISSUE-104 bug on edit. **Third predictive refusal on this track.**
- **Drawing `accept`** — legacy is `image/*` labelled "(optional — image)"; ours accepts **PDF too**. Kept the superset and **relabelled "(optional — image or PDF)" so the text matches what is enforced** (trap 1, applied correctly in the widening direction).
- **Remarks** kept though legacy has no such field (a real persisted column).

**ISSUE-035 — a TEXTBOOK false-fail, documented:** the first typecheck showed **5 errors, all in `jc-status-content.tsx`** — the concurrent agent's file, never touched by this one. Re-ran once: **clean, zero errors.** They were mid-write. **This is exactly why only the post-batch combined run is authoritative.**

**One correction to MY css brief:** **`.blue` at theme L324 is a `/* comment */` explaining its deliberate absence** — the class genuinely does not exist. **ISSUE-110 stands.**

## ISSUE-173 — JC Completion Log shows only op_log; NC and OSP events are missing

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC status)
- **Severity:** P2 — server-side
- **Status:** [ ] open

Legacy **L11106-11131** folds into the completion feed: **NC register entries**, **NC dispositions** (Rework / Scrap / Use-As-Is), and **OSP PR/PO activity-log events**. Ours shows **op_log only**.

No server source exists on this page's endpoints. **Correctly not derived in the browser** (rule 1).

**Same shape as ISSUE-143** (SO Timeline ports 7 of 29 event families): a feed that looks complete because the events it *does* have render correctly.

## ISSUE-174 — JC op_log is capped at 300 with no total, so truncation CANNOT be disclosed honestly

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC status)
- **Severity:** P2
- **Status:** [ ] open — needs a server `total`

`useOpLog({ limit: 300 })` returns a bare **`OpLog[]` — no `total`**.

**So "Showing latest 300 of N" cannot be rendered without fabricating N.** The agent **added nothing**, explicitly citing ISSUE-113's lesson.

**This is the right call and worth recording as precedent:** the honest fix for ISSUE-095 needs a server-owned count (the Item detail had one and used it). **Where no `total` exists, inventing a disclosure is worse than the silence** — it converts an unknown cap into a confident claim. **Add `total` to the op-log response, then disclose.**

## ISSUE-175 — JC status: the QC DOCUMENTS section is absent

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC status)
- **Severity:** P2
- **Status:** [ ] open

Legacy renders it at **L11250-57**. **`JobCardListItem` has no `qcDocs`** — only `JobCardEditModel` does, and **even that lacks legacy's `docName`/`uploadDate`**.

Wiring a second fetch would change data fetching (rule 7). **Note `docName` is ISSUE-168's silent sink** — the field exists in the input schema, has no column, and is never written. **So this section cannot be completed until 168 is fixed.**

## ISSUE-176 — JC status: fields legacy renders that our shapes don't carry

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC status)
- **Severity:** P3 — server-side
- **Status:** [ ] open

- op **`toolDetails`** (L11049)
- outsource **vendor NAME** (only `outsourceVendorId` is returned)
- **`outsourcePRNo` / `outsourcePONo`** (L11070-74, the PR/PO actions)
- machine **name** inside `machTag` (L11982)
- item **`drawing`** on the Item card (L11172)

**Rendered nothing rather than hardcoding `'—'` as if measured** — correct, and exactly the ISSUE-127/133/158 discipline (*a constant wearing the costume of a measurement*).

## ISSUE-177 — JC status renders raw ISO dates — but the page is genuinely ISSUE-065 CLEAN

- **Surfaced:** 2026-07-16 (REFACTOR-1, JC status)
- **Severity:** P3 — display only
- **Status:** [ ] open — closes with the shared helper

Dates render as raw ISO where legacy uses `fmt()` (`dueDate` L11178; log dates L11039/L11147).

**NOT a timezone bug — every column type was checked, not assumed:** `job_cards.due_date` (schema.ts:713), `job_cards.jc_date` (707) and `op_log.log_date` (882) are **all `date`** → mech 4 does not bite. **`closed_at` (734) IS timestamptz but is NOT rendered on this page.**

**A verified-clean result is a real result — recorded so it isn't re-audited.** The agent **deliberately did not add a 13th local `fmt`** (ISSUE-040).

**Context flagged, not owned:** `job-cards/components/job-card-form.tsx:55` `const today = () => new Date().toISOString().slice(0,10)` — that's **ISSUE-172**, another agent's file this batch. **Two agents independently flagged the same helper.**

### JC status — mapping confirmed, and the real defects found

**`viewJCStatus(id)` L11020-11266.** Every line re-verified against the file rather than trusted — **and my briefed lines were accurate this time** (`viewJCStatus` L11020 ✓, `renderJobCards` L5739 ✓, `_machSubmitLog` L5669 ✓).

**`renderJobCards` is the LIST and NOT a decoy** — L5748 / L5768 call **`viewJCStatus(jc.id)`** from the JC No. cell and the `View` action. The list *hops* to the detail. Body maps 1:1: 6 stat cards → Operation Flow → Operations Detail → Completion Log.

**`addJCOp` L11410 / `editJCOp` L11435 / `editJCOpMachine` L11453 are NOT surfaced here** — they belong to **`renderJCOps` L11349**, a separate "JC Operations" nav screen with its own `+ Add Operation` (L11400) and `Change Machine` (L11389). **`viewJCStatus` never references them.** *(I flagged them as possibly in scope; the agent traced and correctly excluded them.)*

**ISSUE-001 NOT inherited:** `_machSubmitLog` L5669 lives in `renderMachineOpEntry`'s screen, **not reachable from `viewJCStatus`**. Nothing to copy.

**🔴 REAL DEFECTS FIXED:**
- **The `Progress` column was MISSING ENTIRELY** — legacy L11246 has **13 `<th>`**; ours had **12**. Added, using `.prog-wrap`/`.prog-bar` with `pctOp` from `completedQty`/`orderQty` (**both server-returned** — no browser math).
- **The Completion Log was SILENTLY DROPPING `start` EVENTS** — `l.logType !== 'start'`. Legacy renders them as **`▶ Started`** in a date-grouped icon feed (L11144-61). Restored; **no data lost** — shift/operator/remarks move inline as legacy does.
- **FOUR badge colours were wrong** against legacy's `badge()` map (L1959-70): `waiting` b-grey→**b-red**, `pr_raised` b-blue→**b-amber**, `po_created` b-cyan→**b-blue**, `outsource` b-grey→**b-amber**.
- **`qcRequired` and `outsourceStatus` were both fetched and rendered nowhere** (the class is now 14+ pages). Now drive legacy's Op-column `QC` marker (L11042) and the Machine cell / flow node.
- Operation Flow had **collapsed legacy's full `bg`/`bdr`/`opColor`/`doneColor` status ladders (L11213-16) into a 2-state complete/not-complete.** Restored.

**🟢 The `.b-yellow` trap held for the THIRD time:** kept our `b-amber` for `in_progress`/`running` because legacy maps them to **`b-yellow`/`b-running` — defined in NEITHER `<style>` block → inert in legacy too.** **No rule added.** *(This is the `.stat-card.blue` mistake — mine — not being repeated.)*

**🟢 SEMANTICS VERIFIED, NOT ASSUMED — and `✓` means a THIRD thing here.** On this page legacy's `✓` is the **QC-ACCEPTED COUNT**, bound to `o.qcAcceptedQty` — **never** to status. *(On SO Status, legacy's `✓` marks QC-REQUIRED (`op.qcReq`) and our port had it meaning "complete".)* **Same glyph, three meanings, two pages. Always trace what an icon binds to.**

**🟢 The `x || default` idiom kept intact:** `outsourceStatus` ported as **`o.outsourceStatus ?? 'Pending'`** — **not collapsed to a bare `'Pending'` constant.** That collapse is exactly ISSUE-158's mechanism (`uom:'NOS'`), and it was consciously avoided.

**Colour work:** `#3b82f6`→`var(--blue)`, `#22c55e`→`var(--green)`, `#ffb020`→`var(--amber)`, `#fca5a5`→`var(--red2)`. **Removed misleading `var(--green2, #86efac)` fallbacks** — **`--green2` IS defined (`#15803d`)**, so the fallback was **dead code** and the border was already dark green.

**Deliberately NOT copied:**
- **Legacy's `colspan="11"` on a 13-column table** (L11247) — **a plain legacy defect.** Used 13. *(Legacy made the same class of error on the SO form: `colspan="10"` for 11 columns.)*
- **Legacy's OSP branches in the flow node** (L11226-35) — **`jc_ops.op_type` has NO `'osp'` value in this system by design** (documented at `packages/shared/src/schemas/job-card.ts:140-142`). **The branch is unreachable → omitted rather than shipped as dead code.**
- **`.op-node`/`.op-arrow` not used** — absent from our theme, **and legacy's `viewJCStatus` never uses them either**; its flow chain uses inline styles, which the port now mirrors. *(I flagged these as the thing to watch; checked and correctly found irrelevant — second time.)*

**Kept though legacy lacks them:** the `Excel` and `▶ Open in Op Entry` buttons, the Remarks line on the SO/WO card, and the Operations Detail **collapse toggle** (legacy's `▸ Operations Detail` is static).

**Open naming question (data-side, not markup):** the field is **`cycleTimeMin`** but legacy's header is **`Cycle(h)`** and its input reads **"Cycle Time (h/pc)"** (L11419). Header text is legacy-faithful so it was left — **but the unit and the name genuinely disagree.** *(The JC-form agent hit the same seam and chose `Cycle (min)` to match `cycle_time_min` (schema.ts:795). **Two pages of one module now label the same column differently — this needs one ruling.**)*

## ISSUE-178 — ISSUE-104: the `gstPercent` select silently saves 0% — and it is CROSS-MODULE by design

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW form)
- **Severity:** P2 — needs a **cross-module** decision, not a page fix
- **Status:** [ ] open

The JWSO `<select>` offers only `[0, 5, 12, 18, 28]`, but the column is **`numeric(5,2)`** and the schema is **`.max(99.99)`**.

**The failure chain is worse than the SO's:** a stored **3%** or **18.5%** matches no option → `valueAsNumber` → **NaN** → `Number(h.gstPercent) || 0` → **silently saved as 0% on edit.** Not "reverts to a default" — **collapses to zero**, on tax.

**Latent today** (migrated JWs take the DB default 18) — but latent is not safe: one manually-entered 12.5% turns into 0% on the next edit.

**⚠️ The SO form has the IDENTICAL select (ISSUE-121), and ADR-056 binds JWSO to SO for parity.** So **fixing JWSO alone would break the parity the user just locked in** (commit 9527725, *"bring JWSO header to Sales-Order parity"*). **This must be decided once and applied to both.**

**A new wrinkle for the ISSUE-104 family:** *the defect is now protected by an ADR.* Parity between our own modules and correctness against our own schema are in direct conflict here. **That is a decision, not a refactor.**

## ISSUE-179 — ISSUE-065 mech 1 on the JW date default (inlined, and shared with the SO form)

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW form)
- **Severity:** P2
- **Status:** [ ] open

`jwDate: new Date().toISOString().slice(0,10)` → **UTC today → yesterday before 05:30 IST**. Legacy's `today()` L1485-87 uses local `getFullYear/getMonth/getDate` and is **correct**. Port regression.

**Mech 4 verified ABSENT:** `jw_date` is a **`date`** column (schema.ts:1186).

**The SO form L103 has the IDENTICAL inlined copy.** **No local helper exists to reuse** → the *inlined* shape (2nd module). **All three shapes now confirmed across the sweep:** named-local helpers (JC form, 10th copy) · **inlined expressions** (PR, PO, JW, SO) · server-side copies (ISSUE-128/148).

## ISSUE-180 — JW's "+ New" material item discards the whole unsaved form

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW form)
- **Severity:** P2 — **a feature regression**, not a gap
- **Status:** [ ] open — needs a quick-add modal

Legacy's **`_jwAddRmItem()` L12753 creates the `-rm` item INLINE, without leaving the form.** Ours is a **`<Link to="/items/new">`** that **navigates away and discards all unsaved JWSO state.**

**So the port turned a convenience into a trap:** the button is offered mid-form, and using it costs you the form. Legacy was strictly better here.

Fixing needs a quick-add modal (a new component) — correctly out of a markup pass. **Same shape as `addClientQuick`, which legacy also does inline.**

## ISSUE-181 — JW line editor: cards vs legacy's table — an ADR conflict needing a ruling

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW form)
- **Severity:** P3 — **the one open structural divergence on this form**
- **Status:** [ ] open — **needs a user decision, not an agent's**

Legacy L12771 is a **`<table>`**: `# | Item Code ★ | Part Name | Drawing No. | Qty ★ | Rate ₹ | Amount | Due Date`. Ours is **cards**.

**The agent correctly did NOT convert it:** **ADR-056 (one day old) explicitly says "Kept JWSO's free-text line editor"**, and converting would revert an approved ADR *and* rewire `useFieldArray`.

**Worth noting the contrast:** the **Route Card** and **PO** forms were both converted card→table this track, because no ADR protected them. **Here an ADR does.** *An agent must not overturn an ADR to reach parity — that is exactly the escalation this rule exists for.*

### JW form — the `/ Line N` grain question RESOLVED, and it is NOT the SO trap

**`jwHeaderForm(j)` L12784 serves BOTH** — `addJW()` L12890 passes `null` (body does `j=j||{}`); `editJW()` L12926 passes the record. **One builder → field-identical by construction.** The only `j`-driven conditionals (L12828 `clientPoFileUrl` file-show, L12829 `cpoUploadBtn` hide) are **DATA-driven, not MODE-driven** — so unlike PO's two `po`-driven forks, **legacy here is genuinely symmetric; nothing to mirror per-mode.**

**🔴 THE GRAIN INSIGHT — this is the important one:**
> **Legacy's `db.jobWorkOrders` is a FLAT ARRAY OF LINES. There is NO header entity at all.** Every element duplicates every header field (`jwNo`, `customer`, `clientPoNo`, `status`…) **plus** its own `lineNo`/item/qty/rate. `addJW` L12903-08 pushes **N records**; `editJW` L12920-24 seeds `_jwModalLines` with **exactly one line** and L12935 `Object.assign(j,…)` updates **only that record** (extras get pushed as new).
>
> **So legacy's per-line grain is real — but it exists ONLY because legacy is denormalized. That IS the single-document-per-collection JSON-blob anti-pattern CLAUDE.md §1/§12 says we are migrating AWAY from.** Our `job_work_orders` + `job_work_order_lines`, with `$id` = the **header**, is the intended target.
>
> **The grain mismatch is the MIGRATION, not a defect.**

**Why this is NOT the SO trap:** the SO case had **two different legacy functions at two grains** (`editSOLine` per-line vs `_editFullSO` whole-record) and **the port picked the wrong one**. Here there is **exactly one** edit function, and its grain is an artefact of the schema we are deliberately replacing. **Correctly refused: the `/ Line N` title (Trap 1 — a grain nothing enforces) and narrowing our edit to one line.**

**🟢 ISSUE-117 P1 CLEARED BY VERIFICATION, not assumption:** both `CreateMode` and `EditMode` declare `onPoFileChange`/`onEmailFileChange`; both routes pass both; both `onSubmit` call `registerJwDoc` twice. **Commit 9527725 wired both modes. Files are NOT eaten on JW edit.** *(The SO form — the module ADR-056 binds JWSO to — still has the P1. So the two modules disagree on the very thing the ADR aligns them for.)*

**🟢 The `job_work` two-value trap is ABSENT here** — no `PO_TYPES` import, no `'Job Work'` comparison. `type="job_work_order"` is a doc-number **series** type, not the PO enum. *(Checked because the module name invites the assumption.)*

**🟢 ISSUE-104 cleared on the pickers, structurally:** `SearchableSelect` **only writes on explicit user action and falls back to `valueLabel`**, so `limit:50` **never rewrites `clientId`**; the item datalists are open free-text. **Same immunity as the JC form's datalists — the control type is what saves it, not the limit.**

**Money exception NAMED, not assumed:** browser math previews **unsaved form input only** — `headerOut`/`linesOut` transmit **no total/amount** (only `rate` + `orderQty`), and `_jwHeaderInputBase` has **no total field**. Server owns the real figure. `toFixed(2)` → **`inrFormat`** ×2.

**Real drift fixed:** **`required={isCreate}` removed** from JWSO No. — a `★` on a **`.optional()`, server-generated** field (**the 4th instance of this exact drift**: SO, PO, PR, JW). `form-grid form-grid-3` → **`form-grid`** ×2 (legacy L12797/L12841 are 2-col; SO L465 already carries the verified comment). Added the missing legacy `fJwRmItemInfo` hint (L12849). **Footer → `✓ Save JW` on `.btn-success`, both modes.**

**Deliberately NOT copied:**
- **"📌 Items must exist in Item Master first"** (L12870) — **legacy hard-blocks** (`_badIC` L12896); **our schema allows free-text `itemCodeText`** (ADR-012 #10). **Trap 1.**
- **"⚠ Item not found in master"** — **legacy scanned ALL of `db.items`; ours is ONE 200-row page**, so absence **cannot be proven** and the warning **would fire falsely**. *(A sharp catch: the same pagination boundary as ISSUE-154/167, but manifesting as a false NEGATIVE claim rather than data loss.)*
- **Legacy's MISSING `step`** on material qty — kept our `step="0.01"` (ISSUE-152: a missing constraint lets the browser default to `step=1`).
- Legacy `<input>` for Remarks → kept `<textarea>` (`max(2000)`; `<input>` strips CR/LF).
- Legacy's 2-value Open/Closed status and no UOM control — ours are wider; **kept**.
- `clientPoNo` dup-check (L12431/L12893) — **server owns it** (rule 1), matching the SO decision.
- **`Item Code ★` not added** — `itemCodeText` is literally `.optional()` (satisfiable by `itemId`); starring it would be **sometimes-false**. **`Part Name ★` KEPT though legacy lacks it** — schema `min(1)` genuinely requires it (the inverse rule).
- **Status hidden on create** per ADR-056; legacy shows it in both modes.

## ISSUE-182 — JW detail: `gstPercent` is fetched and rendered nowhere, so the header value is pre-GST with nothing saying so

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW detail)
- **Severity:** P2 — money shown without its basis
- **Status:** [ ] open

`jobWorkOrderDetailSchema` carries **`gstPercent`** (`packages/shared/src/schemas/job-work-order.ts:69`; migration **0061**, added *"for SO-parity totals"*). `useJobWorkOrder` **fetches it**. The detail renders **no GST and no grand total**.

**So `detail.tsx:173`'s `value ₹X` is PRE-GST, unlabelled.** Meanwhile **the JWSO form shows GST totals** — **the same order presents two different money pictures depending on which screen you open.**

The 15th page in the "fetched but never rendered" class — but this one has a **live commercial consequence**, not just a missing column.

## ISSUE-183 — JW detail: browser math on server-owned money, and the same figure has two provenances in one module

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW detail)
- **Severity:** P2 — CLAUDE.md rule 1
- **Status:** [ ] open

`detail.tsx:67` (`totalQty`), `:71` (`lineValueTotal`) and `:346` (per-line Amount) all compute **in the browser**. **A read-only detail page has NO preview exception** — that exemption belongs only to forms previewing unsaved input (established on the SO/Invoice/PO/JW forms, each of which *named* its case by checking the POST payload).

**Sharper, and the reason this is worth its own issue:**
> **The LIST route gets `totalQty` FROM THE SERVER** (`jobWorkOrderListItemSchema.totalQty` — *"Σ line order_qty"*). **The DETAIL recomputes it client-side.**
> **The same figure has two provenances in one module.** They agree today; nothing enforces that they keep agreeing.

Same shape as ISSUE-098 (the Reports index and run page tinting the same cell differently) — **an internal inconsistency created by building two pages independently.**

## ISSUE-184 — JW material status: our denominator diverges from legacy's — and OURS is the sound one

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW detail)
- **Severity:** P3 — a divergence to hold **consciously**, not to "fix"
- **Status:** [ ] open — no change proposed

| | Rule |
| --- | --- |
| **Legacy** (L12648-50) | `✓ Full` when `materialReceivedQty >= **orderQty**` |
| **Ours** (`detail.tsx:91`) | `✓ Full` when `materialReceivedQty >= **clientMaterialQty**` |

**A JW where the client sent all promised material but fewer units than `orderQty` reads `✓ Full` in our port and `◑ Partial` in legacy.**

**Ours is semantically correct and legacy is not:** legacy compares a **raw-material quantity** to a **finished-part count** — a **unit mismatch**. And migration **0053** moved material to the header, where **no `orderQty` exists**, so copying legacy would require re-adding a column we deliberately removed.

**Legacy contradicts itself here:** it captures **`clientMaterialQty` on its own form** (L12851-52) and then **never uses it for the status.**

**Correctly NOT "fixed" toward legacy** — but recorded so the divergence is deliberate rather than silent. *(Same family as ISSUE-112: a place where our model is better and nobody should "correct" it back.)*

**Related, in a file the agent couldn't edit (comments aren't markup):** `jw-material-status.tsx:1-10` claims *"per-line rendering on the detail page uses the line's own qty + orderQty"*. **The detail does NOT** — `:91` passes **header totals**. **A fourth false comment** (with ISSUE-113/136/143): it documents behaviour that doesn't exist **and** implies a parity with L12648 that isn't there.

**Two minor honesty nits on the same page:**
- **`detail.tsx:368`** renders `${Number(clientMaterialQty ?? 0)} / ${Number(materialReceivedQty ?? 0)}` → a JW where material was **never recorded** shows **"0 / 0"**, indistinguishable from "recorded as zero". Legacy's form shows empty. **Trap-1-adjacent** — a constant standing in for an unmeasured value (milder than ISSUE-127, same family).
- The same pair renders in **two orders on one page**: header `:181` shows `{received}/{expected}`; grid `:368` shows `{expected} / {received}`. Both labelled, neither wrong — but two panels apart.

## ISSUE-185 — FIVE legacy pages have NO React counterpart, and the registry structurally cannot see them

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW detail — via a decoy check)
- **Severity:** P3 — a **scope** finding, not a defect
- **Status:** [x] understood — consistent with the phase plan

**The registry enumerates REACT pages and asks "does this match legacy?" It cannot ask the reverse.** So a legacy page with no React page is **invisible to it** — and to the "refactor until the list is clear" goal.

**Diffing legacy's 87 desktop router keys against the registry, five renderers have no React module at all:**

| Legacy renderer | React module |
| --- | --- |
| `renderCRMLeads` | none |
| `renderCRMReminders` | none |
| `renderCustomer360` | none |
| `renderDeptReport` | none |
| `renderTimeTracker` | none |

(`renderHome` maps to the existing `dashboard` module. **`renderProdJWList` IS mapped** — `/prod-jw-list` → `apps/web/src/modules/prod-jw-list/routes/list.tsx`, file verified to exist. A JW-detail agent reported it unmapped; **it had only grepped its own module. Checked, not taken on trust.**)

**These are NOT an oversight — they match CLAUDE.md's Phase 8** ("Peripheral modules — design, CRM, tools, CAPA") and TASKS.md's Phase 8 migration list (`leads`, `communications`, `crmReminders`). **Known unbuilt work.**

**But the distinction matters for reporting progress:**
> **"The list is clear" ≠ "the port matches legacy."** It means **every React page we have matches its legacy counterpart.** Five legacy pages have no React page to refactor, and REFACTOR-1 will never surface them.

### JW detail — mapping verdict: PORT-ONLY, category 1 (registry error #18), with the most thorough evidence yet

**`renderJWMaster` L12642 is the LIST** (router key `jwmaster`, L2417). **The agent did not stop there — it inventoried the entire JW region.**

**Evidence the list has no drill-in:**
- **`renderJWMaster` L12642-89 maps `db.jobWorkOrders` directly to `<tr>`s.** Each row carries `lineNo` (L12653), `itemCode` (L12657), `partName` (L12658), `orderQty` (L12659) → **row = LINE, not order.**
- **No expand row** — no chevron column, no `<tr onclick>`, no hidden detail `<tr>`. Unlike BOM Master L8460-8493 and `renderSOmaster` L11879-11957.
- **Hops grepped:** the row's only `onclick`s are **`editJW('id')` L12668** and **`delJW('id')` L12669** (plus a `window.open` on the Client PO attachment L12656). **No `View`, no `👁`, no `viewJW`.** So there is **no `viewPO`-style one-hop-further detail** — the decoy pattern that caught the PO detail does not apply.
- **FULL FUNCTION INVENTORY (L12357-12956):** `_cpoApplyToJW`, `renderJWMaster`, `_jwLineRowHtml`, `_jwSetQty`, `_jwUpdateAmt`, `_jwFillItem`, `_jwFillRmItem`, `_jwAddRmItem`, `_jwLinesHtml`, `_refreshJwLines`, `jwHeaderForm`, `_getJwBaseData`, `addJW`, `editJW`, `delJW`. **Every one is list, form, or delete. No read-only single-JW renderer exists.**
- Zero `*detail:` router keys in the legacy router. No mobile JW detail (`_mobJWDCList` L28228 is the JW **DC** module).

**🔴 DECOY FOUND AND REJECTED — `renderProdJWList` L22995-23033.** This one **IS header-grain**: it groups `db.jobWorkOrders` by `jwNo` into `{jwNo, customer, jwDate, dueDate, lines:[]}` (L22999) and shows Lines/Total Qty/Done/Balance/Progress. **Tempting.** But it is a **separate router page** — key `prodjwlist` (L2460), its own sidebar entry (L469 *"JW List"*), its own Production-dept slot (L2340), titled **"JW List (Production View)"** (L23028). **A list of all JWs with no drill-in — not one JW's detail.** Mapping `/job-work-orders/$id` onto it would be forcing.

**The header-vs-line grain — confirmed INDEPENDENTLY of the JW form agent.** `addJW` L12901-04 pushes **one array element per line** (`{...b, id:uid(), lineNo:String(nextLine+i)}`, `b` = `_getJwBaseData()` header fields) — so `jwNo`/`customer`/`clientPoNo`/`status`/`jwDate` are **duplicated onto every line**. **`db.jobWorkOrders` is a flat array of lines; `renderJWMaster` renders it raw.**
> **And the sharpest observation: legacy ITSELF needed the header grain — it hand-rolls the `jwNo` rollup at L22999 for the production view — but NEVER gave it a detail page.**
> So **no legacy JW detail exists at EITHER grain**, and the page was **not narrowed to one line to manufacture parity**. Our `job_work_orders` + `job_work_order_lines`, `$id` = the header, is the intended migration target; legacy's denormalization is the **JSON-blob anti-pattern CLAUDE.md §12 rejects**. **The grain mismatch is the migration, not a defect.**

**⚠️ AN INVENTION FOUND IN A FILE OUT OF SCOPE:** commit **`e3c1748`** added an expand row to `job-work-orders/routes/list.tsx` *"mirroring the SO/WO Master expand pattern"*. **Legacy's JW list has no such thing.** It is an invention — **but a live feature in a file the agent didn't own, so: reported, kept.** *(Worth a ruling: it's a good feature that legacy lacks. The rule says keep it.)*

**Clean results — REAL results, recorded so they aren't re-audited:**
- **ISSUE-065 CLEAN.** All three dates rendered (`jwDate` schema.ts:1186, `dueDate` :1253, `materialReceivedDate` :1198) are **`date`** columns → mech 4 cannot fire; **the page calls no `toISOString()` anyway**. Mech 1 absent.
- **ISSUE-095 CLEAN.** The detail service fetches **all** lines with no LIMIT (`service.ts:241`'s LIMIT is the *list* route; the `.limit(1)` calls are header lookups); `jwso-documents` has no cap. **Nothing capped → no disclosure added** (ISSUE-174 precedent).
- **Legacy's `fmt()` L1484 is SAFE, and here's why it's worth knowing:** it appends **`'T00:00:00'`** → parsed as **local midnight** → **no UTC shift**. *That is exactly the technique our port dropped, and it explains why legacy has no ISSUE-065.*
- **Date format:** our JW module renders **raw ISO on BOTH list and detail** — so it is at least **internally consistent** (unlike Invoices, which shows the same `dueDate` two ways). **No 13th local `fmt()` added.** Closes with ISSUE-040.
- **Money format:** left as `toFixed(2)` — the only legacy JW money screen is the form (`_jwLineRowHtml` L12710: `'₹'+(n(line.qty)*n(line.rate)).toFixed(2)`) and our page is **internally consistent with it** (the PO-detail precedent). Legacy's JW *list* shows no amount at all.
- One dead-code nit: `var(--green2, var(--green))` at `:173` — **`--green2` IS defined** (tokens.css:58, `#15803d`), so the fallback never fires. Harmless. *(Third page where a `--green2` fallback turned out to be dead code.)*

## ISSUE-186 — 🔴 The printed JW DC omits "⚠ RETURNABLE" — the document's entire legal character

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW DC detail)
- **Severity:** **P1 — compliance.** The second compliance defect found on a printed document, and worse than the first.
- **Status:** [ ] open — fix is in `doc-print.ts`

**Legacy titles the document `⚠ RETURNABLE GATE PASS / JW DELIVERY CHALLAN` (L24645) AND emits a banner: *"⚠ RETURNABLE — Material to be returned after processing"* (L24652).**

**Ours:** `DOC_TITLE` = plain **`JOB WORK DELIVERY CHALLAN`**. **No banner.**

**Why this outranks ISSUE-150 (the Invoice's missing buyer address):** under the **GST job-work provisions**, *returnable* is what distinguishes **material sent out for processing** from **a supply**. A gate pass that doesn't say the goods are coming back is not a weaker version of the document — **it describes a different transaction.**

**Both compliance defects share one mechanism:** the port reproduced the document's *structure* and dropped the words that carry its *legal meaning*. **Every printed document needs an explicit compliance check against legacy, not a layout diff.**

## ISSUE-187 — The printed JW DC omits Remarks; `DocPrintModel` has no slot for them

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW DC detail)
- **Severity:** P2
- **Status:** [ ] open — needs `doc-print.ts`

Legacy prints DC remarks (**L24651**). **`DocPrintModel` has no slot for them**, so **packing and handling notes never reach the vendor** — the person who most needs them.

**Structural, not an oversight in this page:** the model can't carry the field. Same shape as ISSUE-160 (the PO detail's totals) — *the UI is honest; the DTO is the gap.*

## ISSUE-188 — ISSUE-065 mech 1 on the printed JW DC (identical to ISSUE-157)

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW DC detail)
- **Severity:** P2
- **Status:** [ ] open

`jw-dc/lib/print-jwdc.ts:37` — `fmtDate(new Date().toISOString())`. **Byte-identical to ISSUE-157's `print-po.ts:64`.** `fmtDate` regexes the string, taking the **UTC** Y-M-D → **yesterday's date on a printed DC** between 00:00-05:29 IST — **on a durable artefact handed to a vendor.**

Legacy's `today()` L1485-87 uses local components → **port regression**.

**Same mechanism at `jw-dc/routes/list.tsx:488` and `:766`** (the create-form's default date) — not this agent's files.

**Mech 4 verified ABSENT, not assumed:** `fmtDate(dc.dcDate)` is **safe** — `dc_date` is a **`date`** column (schema.ts:3072) **and `fmtDate` regexes the string with no `Date` object at all.**

**Two print paths now carry the identical bug.** The shared IST helper fixes both in one line each.

## ISSUE-189 — The printed JW DC drops legacy's three signature lines, including the vendor's acknowledgement

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW DC detail)
- **Severity:** P3
- **Status:** [ ] open

Legacy prints **`Prepared By / Authorized By / Received By`** (L24656). Ours substitutes `doc-print.ts:243-246`'s **PAN + "Authorised Signatory"**.

**The `Received By` line is the vendor's acknowledgement of receipt** — the counterpart signature on a gate pass.

**And the PAN is wrong here specifically:** `doc-print.ts:244` hardcodes **`AQKPM4121A`** on **every** document, but **legacy emits NO PAN on a JW DC at all.** So this page prints a hardcoded PAN legacy never printed, while dropping the signature block legacy did. *(ISSUE-151 already covers the hardcoding; this is where it actively adds something legacy omits.)*

## ISSUE-190 — JW DC vendor address prints partial (ours is already ahead of legacy)

- **Surfaced:** 2026-07-16 (REFACTOR-1, JW DC detail)
- **Severity:** P3 — a design call, not a defect
- **Status:** [ ] open

`vendor.city` / `state` / `pincode` / `gstNumber` all exist, but **only `addressLine1` is passed** to the print model.

**Legacy printed NO vendor address at all** — so ours is **already ahead**. Flagged rather than fixed: completing it is a design decision about what a gate pass should carry, not a parity gap. *(Contrast ISSUE-150, where legacy printed the address and we dropped it — that one is a regression.)*

### JW DC detail — mapping verdict (registry error #19): a real renderer, one hop past a DECOY

**`_jwdcViewOut` L24592-24609** — category (2), hidden in a list, **not** previously ported.

**`renderJWDC()` L24434 is the LIST** (router key `jwdc`, L2412). **The hops were grepped, and the first two are decoys:**

| Hop | Target | Verdict |
| --- | --- | --- |
| L24463 — DC No. cell | `_jwdcPrint(dc.id)` | **decoy** — opens the print window, not a detail |
| L24473 — 🖨 action | `_jwdcPrint` | **decoy** — same |
| **L24474 — 👁 action** | **`_jwdcViewOut(dc.id)`** | **the real detail** (`showModalLg`: info block + line table + remarks) |

**Exactly the `viewPO` L26299 pattern** — the real detail sits one hop past a plausible-looking target. *(Third module where this shape has appeared: PO, JC status, JW DC.)*

**🔴 A FIFTH FALSE PARITY COMMENT — and a new sub-shape.** `detail.tsx`'s comment claimed it mirrored *"`_jwdcPrint` trigger (L24463)"*. **The line reference was REAL and the claim was WRONG: the page was named after a PRINT TRIGGER.** Rewritten to cite `_jwdcViewOut` with the decoy documented.
*The tally: ISSUE-113 (fabricated justification) · ISSUE-136 (wrong line + false claim) · ISSUE-143 (false "not ported" excuse) · ISSUE-184 (`jw-material-status.tsx` documents behaviour that doesn't exist) · this (real line, wrong function). **And `print-po.ts` + this file's `print-jwdc.ts` both checked out.** So: verify every comment; assume neither guilt nor innocence.*

**Print source VERIFIED and HONEST:** **`_jwdcPrint` L24611** → `lib/print-jwdc.ts`. **Line ref correct AND claim accurate** — the `_ptData` bag matches field-for-field and the five `jwdc_*` blocks substitute for real. **This re-confirms the earlier `doc-print.ts:165` trace by independent check rather than inheriting it.** *(Second print file to survive scrutiny, after `print-po.ts`.)*

**🔴 REAL DEFECT FIXED — the printed process was DROPPED.** Legacy prints **`itemName — process`** (L24614); ours printed the item name alone. **So the vendor's gate pass listed items with NO INSTRUCTION OF WHAT TO DO WITH THEM.** Markup-level → fixed.

**Other real gaps closed:** the `DetailGrid` was missing **Vendor** and **Total Sent** entirely — now legacy's six fields in legacy order (DC No. / Date / JWPO / Vendor / Total Sent / Vehicle). Remarks moved **below the line table** (legacy L24608 order). `<th>Item</th>` → **`<th>Item Code</th>`**. Line cells `td-right` → **`td-ctr`** (legacy L24596). **Pending cell `var(--amber)` → `var(--red)`** — legacy L24470 is red, **and our own summary at L125 already said red** (an internal contradiction, now resolved toward legacy).

**🟢 CLEARED BY VERIFICATION — my warnings checked, not obeyed:**
- **`uom:'NOS'` is FAITHFUL, not ISSUE-158's pattern.** **Legacy hardcodes `NOS` at L24614** and the line schema has **no `uom` field**. *I flagged this as a suspected dropped-`x || default`; the agent checked and found legacy has no `x`.*
- **`driverName:''` is FAITHFUL** — legacy has **no driver input anywhere**, so `dc.driverName||''` **always** yielded `''`.
- **ISSUE-043 not surfaced here** — `Line items ({dc.lines.length})` binds to the **rendered array**; no server `total`, no pagination → **no disclosure added** (ISSUE-174 precedent).

**Kept though legacy's modal lacks them (working features, real API data):** Returned/Pending columns, the status label, and the sent/returned/pending summary — **and legacy's own REGISTER has these columns** (L24469-71), so they're legacy-supported, just not in its modal. Also kept: `recipientAddress` = the real vendor address and DB-driven company name/GSTIN, where **legacy hardcoded `''` / `'Innovic Technology'` / `'24AQKPM4121A1Z5'`**; and the computed `purpose` (joined distinct processes) over legacy's constant `'Job Work Processing'`.

**Date format:** legacy `fmt()` → `29-04-2026`; both `detail.tsx` and `list.tsx` render raw `2026-04-29`. **Module-wide → not half-fixed here.** Closes with ISSUE-040.

## ISSUE-191 — Assembly: `overrideQty` is non-nullable, so `0` is ambiguous and legacy's ✏ marker is unportable

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail)
- **Severity:** P2 — needs `.nullable()` in shared
- **Status:** [ ] open

Legacy's **`manualOverride` is `null` when absent** — it prints a placeholder `—` and a **✏ marker** on Final Ready to show the figure was overridden.

**Ours is `z.number().int().nonnegative()`, so `0` is ambiguous between "no override" and "override = 0".**

**The agent rendered NO ✏ rather than one on every zero row** — exactly the ISSUE-127 discipline (*never let a constant impersonate a measurement*). **The fix is a schema change (`.nullable()`), not markup.**

**A new variant of the null-erasure class:** ISSUE-104 is about *option lists* narrowing a column. This is a **non-nullable type narrowing a nullable concept** — the absence of a value became a value. Same consequence: information destroyed at the boundary.

## ISSUE-192 — Assembly components: legacy's `Source` column has no server source

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail)
- **Severity:** P3
- **Status:** [ ] open

Legacy **L28829** shows JC numbers / `planNo` / `In Stock` / `Stock: N`. **`AssemblyComponentRow` has no such field.** **Not fabricated** — correctly omitted.

## ISSUE-193 — Assembly component status: legacy derives 4 states, our server derives 3

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail)
- **Severity:** P3 — a divergence to hold consciously
- **Status:** [ ] open

Legacy derives **`ready` / `in production` / `GRN pending` / `pending`** from JC + GRN lookups **in the browser**. Our server derives **3**.

**Only `ready` maps 1:1** — verified: both are `finalReady >= totalNeed` (checked against `deriveComponentStatus`). **Kept ours** — re-deriving the other states in React would need JC+GRN lookups client-side (rule 1).

## ISSUE-194 — Assembly: three legacy actions have no API

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail)
- **Severity:** P3
- **Status:** [ ] open

- **`✓ Mark All Done`** (`_atCompleteAssembly` L29220)
- **`📄 Export Shortfall`** (L29102)
- **`📦 BOM Planning` / `🚚 Dispatch Register`** cross-module navs

**No dead buttons added** — correct. *(Contrast the Report Builder's inert drag grips, which legacy ships and we correctly withheld.)*

## ISSUE-195 — `assembly/routes/list.tsx` paints a teal legacy NEVER renders

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail — found in a file the agent didn't own)
- **Severity:** P3
- **Status:** [ ] open

`list.tsx`'s **Done tile uses `var(--teal, #14b8a6)`**. **`--teal` is undefined in legacy** (ISSUE-126 — undefined in **both** systems), so **legacy's declaration is INERT and paints nothing.** **Our fallback paints a colour legacy does not.**

**This is the `.stat-card.blue` mistake — mine — in reverse:** I once *added* a rule for a class legacy references but never defines. Here the port supplies a **fallback** for a token legacy never defines. **Both invent a colour out of legacy's dead declaration.**

**The rule generalises:** `var(--undefined-token, #fallback)` **is not a port of `var(--undefined-token)`** — it is the opposite. **Legacy's undefined token renders NOTHING; a fallback renders SOMETHING.**

**The one real teal is legitimate:** legacy's Done badge uses a **literal `#14b8a6`** → `.b-teal`, which the theme documents as ported for this exact screen.

## ISSUE-196 — Assembly date-format seam (ISSUE-040), and ISSUE-065 verified ABSENT

- **Surfaced:** 2026-07-16 (REFACTOR-1, Assembly detail)
- **Severity:** P3
- **Status:** [ ] open — closes with ISSUE-040

Legacy `fmt()`s unit dates; we render **raw ISO**. **No 13th local `fmt()` added.**

**ISSUE-065 verified ABSENT, not assumed:** `assembly_date` / `dispatch_date` are **`date()`** columns (schema.ts:2619, 2628) **and no `toISOString()` is applied anywhere on the page.**

**Also reported, not fixed (logic):** legacy **admin-gates the override input** (`isAdmin()` L28815); ours is **ungated**. The Actions column *is* `canEntry()`-gated. **Role gating is logic** — out of a markup pass, but it means a non-admin can currently override a ready count.

**Omitted, not fabricated:** BOM **`revision`** and **`dueDate`** are absent from `header` (legacy's meta line has both). `partNoText`/`partName` are **hardcoded `null` in service.ts**.

### Assembly detail — mapping verdict (registry error #20) and a LEGACY BUG NOT COPIED

**`renderAssemblyTracker`'s per-SO EXPANDED BODY, L28788-28884.** Category **(2) — hidden in a list, NOT ported.**

**The list already declared the split** — `list.tsx` L8-11: *"this list is legacy's collapsed card header (L28782-28787); the expanded body (L28788-28884) is /assemblies/$soId."* Its table renders SO#/Customer/BOM/Due/Required/Assembled/Dispatched/Status — **the header row only**. **Unlike Sales Orders, the body was NEVER ported → not a zero-edit case.**

**Decoy ruled out:** `showEquipBOMPlanning` (the "📦 BOM Planning" hop, L28866) is at **L8848 and takes `soLineId`, not `soId`** — it lives in the **BOM module**; a cross-module nav like "Dispatch Register", not the assembly detail.

**`_atDispatchUnit(unitId, soId)` L28991 traced:** a **per-unit dispatch modal**, invoked from the units table *inside the expanded body*. **It confirms legacy works per-SO INSIDE the accordion, not via a separate renderer.** Its `qty:1` hardcode lives in the `db.dispatchLog` write (L29013) — **legacy's dispatch model** (already established when ruling out `/customer-dispatches/new`), not markup.

**No `render*` function is parameterised by `soId`** — grep of all `_at*` / `renderAssembly*` returns only `_atBuildAssemblies()` (data), `renderAssemblyTracker()` (list), and action functions.

**🟢 A LEGACY BUG FOUND AND NOT COPIED — and it is the `--teal` trap in its purest form:**
> **Legacy's progress bar switches its fill to `var(--teal)` at 100%. `--teal` is undefined → the declaration is invalid → THE BAR RENDERS EMPTY WHEN COMPLETE.**
> **Ours keeps cyan.** Copying legacy here would have made a finished assembly look like it hadn't started.

**Consistently applied:** the ASSEMBLED stat, unit #, units heading and card border are **not** painted teal, because **legacy's teal declarations are inert**. *(Fourth time the `.stat-card.blue` lesson has held — and the first time it prevented copying a visible bug rather than an invisible no-op.)*

**Real gaps closed:** **`header.bomName` was fetched and rendered nowhere** (16th page in that class) — now in the header (`SO — BOMName × N nos`). The **status badge** (L28778-81: `ALL READY ✓` / `Assembling M/N` / `Done ✓ M/N` / `Waiting — R/T`) and the **progress bar** (L28790) were both absent. Stats strip reordered to legacy's order **+ `COMPONENTS R/T ready` added**. Components table gained `#`, legacy's labels (`Child Item`, `Short`, **`🔧 JW`** not `📦 Outsrc`), type colours, and `td-right`→**`td-ctr`** (legacy centres these). **Units table had `Remarks` and `Dispatch Status` INVERTED** — fixed; and **`Pending` (amber) previously rendered as a bare `—`**.

**Kept though legacy lacks them:** our extra **`Qty/Set`** and **`Stock`** columns.

**Judgement call flagged, and I agree with it:** `readyCount = components.filter(c => c.status === 'ready').length` is computed in React — but it is **a count of SERVER-ASSIGNED statuses over the complete (uncapped) array already on screen**, not a re-derivation of a business figure. Same shape as `list.tsx`'s accepted `counts` useMemo. **Rule 1 bars re-deriving server-owned figures, not counting rows the server already classified.**

### 🔴 `docs/PARITY/assytracker.md` IS UNRELIABLE — 4 more false/misleading claims (I had already corrected 1)

**I asked for an audit because I'd previously caught it claiming `.dash-stat-card` "✅ exists in theme" when it exists in NEITHER theme nor legacy. The audit found four more:**

| Claim | Verdict |
| --- | --- |
| §5 item 3 — the component table has *"Override (admin only)"* and **no `#` column** | ❌ **FALSE** — legacy **L28802 opens with `<th>#</th>`**. The doc's column list is incomplete. |
| §5 item 4 — units order | ❌ **Legacy's order is stated correctly, but the doc omits that OUR PORT had Remarks/Dispatch INVERTED** — presenting the port as matching when it didn't. |
| §5 item 1 — *"Progress bar … coloured teal/cyan"* | ❌ **MISLEADING** — the teal branch is **inert**; the bar is cyan or **invisible**, never teal. |
| §1/§8 — tiles *"`--teal` coloured for Done"* | ❌ **MISLEADING** — inert in legacy. |
| §5 scope — *"Detailed mapping is OUT OF SCOPE… see a separate assytracker-detail.md"* | ⚠️ **That file DOES NOT EXIST.** The detail was unmapped until now. |
| §4.1 badge text/colours · §5 expanded-body sections · §0 accordion split · the `.dash-stat-card` correction | ✅ **Verified accurate** |

**The pattern is now unambiguous and applies to EVERY doc on this track, including the ones I write:**
> **A parity claim is worth nothing unless re-verified against the file.** Five false code comments (ISSUE-113/136/143/184 + JW DC's), and now a parity doc with **five** bad claims and a **reference to a file that was never written**.
> **Second-hand intel is a hypothesis, not a finding.** The doc's errors all lean the same way — **asserting parity that doesn't exist** — which is exactly the direction that stops anyone looking.

## ISSUE-197 — ISSUE-065 mech 1 on the NC date default

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC form)
- **Severity:** P2 — part of the ISSUE-065 sweep
- **Status:** [ ] open

`nc-register-form.tsx:44` — `ncDate: new Date().toISOString().slice(0,10)` → **today in UTC** → the form defaults to **yesterday before 05:30 IST**. Legacy's `today()` L1485-87 uses local components and is **correct** → port regression.

**Mech 4 verified ABSENT:** `nc_date` is a **`date`** column (schema.ts:1732) → serializing an existing value is safe. **Only the default is wrong.**

**An INLINED expression** (no local `today()` in this module to reuse) — the second shape. All three confirmed across the sweep: **named-local helpers** (JC form, 10th copy) · **inlined expressions** (PR/PO/JW/SO/NC) · **server-side copies** (ISSUE-128/148).

## ISSUE-198 — 🔴 The datalist-immunity rule needs a REFINEMENT: it's the HANDLER, not the control

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC form)
- **Severity:** P2
- **Status:** [ ] open — **and it corrects a rule I stated last batch**

**Two option lists on this form, two different verdicts:**

| Control | Backing | Verdict |
| --- | --- | --- |
| **JC No. `<select>`** | `useJobCardsList({ limit: 200 })` | **The exact PR/PO `vendorId` shape** — but **CREATE-ONLY**, so it is a **parity gap** (you cannot report an NC against JC #201+), **not edit data loss.** |
| **Item datalist** | `useItemsList({ limit: 1000 })` | **NOT immune** — `onItemCodeChange` sets **`itemId=''` on no-match**, so an out-of-list code **BLOCKS SUBMIT** rather than surviving as free text. |

**🔴 THIS CORRECTS THE RULE I STATED AFTER BATCH 31.** I wrote: *"a `limit: N` behind a datalist is harmless; behind a `<select>` it is silent data loss — the control type is the immunity."* **That is wrong.**

> **The immunity is not the control — it is what the handler does with a no-match.**
> - JC form's datalists: **no-match leaves the free text intact** → immune.
> - `SearchableSelect`: **writes only on explicit user action, falls back to `valueLabel`** → immune.
> - **NC form's datalist: no-match NULLS the id → blocks submit** → **not immune**, despite being a datalist.
>
> **And the failure mode differs by mode:** on **create** an unreachable value is a **parity gap**; on **edit** it is **data loss**.

**The audit is therefore wider than "grep for `<select>`":** every option list feeding a form needs its **no-match path** traced.

## ISSUE-199 — NC rejected-qty: `min={1}` narrows a `.positive()` schema and makes an RHF rule dead code

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC form)
- **Severity:** P3
- **Status:** [ ] open — left alone deliberately

The input carries **`min={1}`** (legacy has `min="1"` too). But our zod allows **`0.01`**, the column is **`numeric(12,2)`**, and the RHF rule says **`min: 0.01`** — so **the HTML `min` blocks first, making that RHF rule DEAD CODE for 0.01–0.99.**

**Left alone, correctly:** legacy agrees with the `min="1"`, and loosening it could admit a qty the business rejects. **But the RHF rule advertises a range the form cannot reach** — the two validators disagree, and nobody would notice.

## ISSUE-200 — 🟢 Legacy has an ISSUE-104 bug that OUR PORT IS IMMUNE TO

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC form)
- **Severity:** P4 — recorded as a **do-not-"fix"-toward-legacy** marker
- **Status:** [x] no action needed

**Legacy's `_disposeNC` offers only 5 reason categories (`fDispCat`) where `_addManualNC` offers 7** — and **L22649 writes `r.reasonCategory = V('fDispCat')`.**

**So in legacy, disposing an NC that was created as *Operator Error* or *Machine Fault* SILENTLY REWRITES it to *Dimensional*.** That is the ISSUE-104 mechanism, occurring natively in legacy, on a quality record.

**Our port is immune** — `NC_REASON_CATEGORIES` has **all 7** and the select covers the **full enum**.

**Recorded so nobody "restores parity" here.** *(Third instance of us being better than legacy: BOM revisions (ISSUE-112), the JC QC-doc payload filter, and this.)*

### NC form — mapping (registry error #21) and the sharpest footer derivation yet

**`/nc-register/new` → `_addManualNC()` L22565** — category (2), hidden in the list, not previously ported to legacy shape. **Hop followed, not assumed:** `renderNCRegister()` **L22551** renders `<button onclick="_addManualNC()">❌ Report NC</button>`; `_addManualNC` calls `showModalLg('❌ Report Non-Conformance', <form-grid body>, saveCb)` and **builds the actual form**. `_ncFillJC()` L22609 is its JC→Operation cascade.

**`/nc-register/$id/edit` → NO LEGACY COUNTERPART, category 4. `editNC` does not exist.** **Proof is not mere absence** — the list's row actions were enumerated **EXHAUSTIVELY** (L22540-22549) and **every hop followed**:

| Row action | Condition | What it actually opens |
| --- | --- | --- |
| `_viewNC(id)` 👁 | always | `showModal(…, **null**)` — **a null save callback = READ-ONLY** |
| `_disposeNC(id)` ✏ | `status==='Pending'` | the disposition modal (our `dispose-nc-panel`) |
| `_closeNCRework(id)` ✅ | `Disposed`+`Rework` | `confirm()` → **status flip only** |
| `_closeNCRework(id)` ✅ | `Rework Done`+`Rework` | same |
| `_createCAPAFromNC` 🛡 | `status!=='Pending'` | creates a CAPA record |
| `nav('capa')` | CAPA exists | navigation |
| `_assignTaskFromContext` 👤+ | admin/mgr, `!Closed` | task assignment |

**No edit affordance on ANY status** — the PR precedent exactly. **Cross-checked every `ncRegister` write site:** only `_autoCreateNC` (L22480), `_addManualNC` (L22597), `_disposeNC` (L22649), and the mobile QC path (L28390). **NC is create-then-DISPOSITION, never create-then-edit.**

**🔴 THE FOOTER DERIVATION — the most careful reading on this track, and it beats my heuristic:**
> `showModalLg` with **no `saveLabel`** + title **`❌ Report Non-Conformance`**. The agent checked **L28034's fallback branches** and found **NO match** — because they test for **UPPERCASE** `PO`/`SO`/`WO`/`JW`/`JC`, and **"Report" contains a lowercase `po`**. So it **falls through to plain `Save`**, rendered at L28044 as **`✓ Save`** on **`.btn-success`**.
> **My four-shape rule said "the fallback derives it from the title" — it does, but only for titles that match. This is a FIFTH case: the fallback's own default.** Ours had `btn-primary`/`Report NC`.

**🟢 ISSUE-099: NO ★ DRIFT — the recurring 4× trap is absent.** Every `★` is honest: `code`, `ncDate`, `jobCardId`, `itemId`, `rejectedQty`, `reason` are **all genuinely required** in `createNcRegisterInputSchema`; `reasonCategory` has **`.default('other')`** and correctly carries **no** `★`. Date/NC No. keep a `★` legacy lacks **because OUR schema requires them** (the inverse-of-trap-1 case). **No upload → ISSUE-117 N/A.**
**And the edit's narrowness MIRRORS A REAL SERVER ASYMMETRY** — `updateNcRegister` L493 **throws `ConflictError` unless `status==='pending'`**, and the update schema is deliberately narrow per **ADR-017 #7**. **The JC-form pattern: drift that mirrors a real server rule is not drift.** *(Second confirmation that this check is worth making before crying drift.)*

**Real work:** `form-grid form-grid-3` → **`form-grid`** (legacy's body is a 2-col `.form-grid`); **"Reported by" moved** from slot 3 to after Reason Category, so create now reads legacy's order (Date → JC No. → Operation → Operator → Machine → Rejected Qty → Reason Category → Problem); labels → legacy's (`JC No.`, `Rejected Qty`, `Reason Category`, `Problem / Defect Description`); legacy's option/placeholder literals (`-- Select JC --`, `-- Select --`, `-- Select JC first --`). **Qty input uses `fw-700 red` — the CLASS equivalent of legacy's inline `font-weight:700;color:var(--red)`; no inline style added.**

**🟢 PREDICTIVE ISSUE-104 REFUSAL — the 4th on this track.** **Operator and Machine `<select>`s refused.** Legacy binds them to `db.operators`/`db.machines`; **our `operator_text`/`machine_code_text` are FREE-TEXT SNAPSHOT columns**, and **auto-created NCs populate them from op logs that need not match a master.** A faithful port of the narrow control over the wider column would **manufacture the bug**. Kept our text inputs.

**Deliberately NOT copied:**
- **The red NC-No. banner** (`❌ Report Non-Conformance` header block with `⏰ Time … (auto-captured)`). Legacy shows the code there **because `_nextNCNo()` generates it and it isn't a field**; **our server does NOT generate it** — `createNcRegisterInputSchema` **requires a client-supplied `code`** and the service only enforces uniqueness (L415). The input must stay, so a banner would **duplicate/contradict** it. **Note the nuance the agent flagged:** the *"auto-captured"* claim **would be truthful** (the service does set `timeLogged: new Date()` at L449) — **so this is a duplication call, NOT an ISSUE-100 call.** *(Precisely the distinction that matters: trap 1 is about claims that are false, not claims that are redundant.)*
- **Extra fields kept** per the live-system rule: NC No. input, Item, SO No., Reported by. **Legacy auto-derives these from the JC; ours are explicit. Nothing deleted.**

**Reported, not fixed:** **`operatorText` is submitted on edit but never rendered there** — the update schema allows it and the service writes it (L505); it round-trips from `detailToFormValues` defaults, so **no data loss**, but it is a **server-permitted field the UI hides.** *(The inverse of "fetched but never rendered": submitted but never shown.)*

## ISSUE-201 — NC disposition cannot amend the reason category, and adding the control would ship a silent sink

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC detail)
- **Severity:** P2 — needs a server change
- **Status:** [ ] open

Legacy **L22635** renders a **Reason Category** select in the dispose modal, and **L22648** commits `r.reasonCategory = V('fDispCat') || r.reasonCategory` — **disposition can amend the category.**

**`disposeNcInputSchema` (shared, L128-133) accepts only `{action, remarks, reworkOpSeq, scrapCost}`.**

**The agent refused to add the select** — it would ship a control that **silently discards its value**, the exact ISSUE-127 shape. **And it rejected the 2-call workaround as worse:** PATCH-then-dispose is **non-atomic**, and `updateNcRegisterInputSchema` is **blocked once status leaves `pending`** — so the workaround would fail on precisely the records it's for.

**Fix:** add `reasonCategory` to `disposeNcInputSchema` + the service's dispose write.

## ISSUE-202 — NC `timeLogged` renders as a raw ISO string, and it IS a timestamptz

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC detail)
- **Severity:** P2 — **live mech-4 territory**
- **Status:** [ ] open

`time_logged` is **`timestamp('time_logged', { withTimezone: true })`** (schema.ts:1764) — **a timestamptz**. It renders raw. Legacy does `new Date(r.timeLogged).toLocaleString('en-IN')`.

**Left raw and reported rather than adding a 13th local formatter** (ISSUE-040). **The important part: this is one of the few confirmed timestamptz render sites**, so when the shared IST helper lands, this is a mech-4 fix — not merely a formatting one.

## ISSUE-203 — NC `ncDate`/`dispositionDate` unformatted (no seam — list and detail agree)

- **Surfaced:** 2026-07-16 (REFACTOR-1, NC detail)
- **Severity:** P3
- **Status:** [ ] open — closes with ISSUE-040

Both are **`date`** columns (schema.ts:1732, 1755) → **mech 4 does NOT apply; no UTC shift; safe.** Purely a formatting gap vs legacy's `fmt()` (`05 Jan 26`).

**🟢 No seam:** `list.tsx:109` renders `ncDate` raw **too**, so **list and detail agree**. *(Contrast Invoices, where the list has a correct local `fmt()` and the detail renders raw ISO — the same `dueDate` shown two ways in one module.)*

## ISSUE-204 — 🔴🔴 QC Process cycle time: legacy stores HOURS, our column is MINUTES — a likely 60× error that ISSUE-109 will PROPAGATE

- **Surfaced:** 2026-07-16 (REFACTOR-1, QC Processes)
- **Severity:** **P1** — a silent 60× data error with a queued propagation path
- **Status:** [ ] open — needs a migration audit + an explicit unit decision

**Legacy stores HOURS. Three independent confirmations:**
- form label: **`Default Cycle Time (hrs)`**
- list header: **`Std Time (h)`**
- **`_selQCProcesses` L23518** renders `' ('+p.defaultCycleTime+'h)'`

**Our column is `default_cycle_time_min numeric(8,2)` — MINUTES** (schema.ts:469; the shared schema's own header comment states it outright).

**If the migration copied `defaultCycleTime` verbatim, a legacy `0.25` (= 15 minutes) is now stored as `0.25` MINUTES.** A 60× understatement.

**🔴 AND IT DOESN'T STAY CONTAINED.** **ISSUE-109 is queued to wire `_selQCProcesses`' auto-fill of op `cycleTime` FROM `defaultCycleTime`** into **Route Cards** (L10215) and **Job Cards** (L5877). **So the moment that gets built, a 60× error propagates straight into op cycle times and capacity planning.**

**Required before ISSUE-109 is built:**
```sql
SELECT id, code, default_cycle_time_min FROM qc_processes WHERE deleted_at IS NULL;
```
Compare against legacy's `db.qcProcesses[].defaultCycleTime`. **If the values match numerically, the unit is wrong and every row needs ×60.**

**The label was correctly NOT ported:** shipping legacy's `(hrs)` over a minutes column would **mislabel the field users type into** — manufacturing the bug. The agent shipped **`(min)`**, matching the ported list header `Std Time (min)`.

**This is the SECOND unit mismatch found in the same shape** — the JC form kept **`Cycle (min)`** against legacy's **`Cycle(h)`** because `cycle_time_min` is minutes (ISSUE-177's open question). **Two modules, one unresolved units decision. Settle it once.**

### NC detail — mapping (registry error #22), a real defect fixed, and a badge question for you

**`_viewNC` L22716 is correct — a real renderer, ONE hop, no decoy.** The list row's 👁 at **L22538** → `_viewNC('+r.id+')`. **Every other hop out of that row was checked:** `_disposeNC` (L22539, a form modal), `_closeNCRework` (L22540/41, `confirm()`+mutate, **renders nothing**), `_createCAPAFromNC` (L22542, mutate+nav), `nav('capa')` (L22543). **No print function, no sub-table masquerading as a detail.** `renderNCRegister` L22494 is the LIST (router L2406).

**🔴 REAL DEFECT FIXED — Trap 1's shape, caught in our own code:** `Job card` rendered the **hardcoded placeholder `'— linked —'`** while **the actual JC code was already resolved into the `jcCode` variable (L92)** and passed to the dispose panel. **A constant sitting where a measurement belongs, with the real value one line away.** Now bound.

**🔴 ROUNDING DEFECT FIXED:** three `Number(nc.rejectedQty).toFixed(0)` sites rendered a rejected qty of **5.5 as "6"**. **Legacy's `n()` doesn't round.** Now `Number(...)`. *(A quality record overstating a rejection by half a unit.)*

**Real gaps closed:** legacy's **context strip** (`REJ NO. / DATE / JC / SO / STATUS`, L22721-26) — **DATE, JC and SO had no home on our page at all**. Field set rebuilt to legacy's exact order; nothing dropped (`Item code`+`Item name` fused into `Item:`, `Op seq`+`Operation` into `Op<n>: <op>` per L22729). Disposition moved into the main panel as legacy's tinted block, **with legacy's exact gates** (`Rework Op` rework-only; `Scrap Cost` scrap **&&** >0; `New JC` make_fresh **&&** code present) — **verified against `cascades.ts:323` that `reworkJcCodeText` is only written on the make_fresh path, so the gate hides nothing.**

**Dev jargon removed:** the subtitle *"Set during the disposition workflow (T-040b cascade)"* — internal, no legacy counterpart.

**⚠️ TWO BADGE DIVERGENCES — flagged, NOT acted on (both badges are shared with `list.tsx`, which the agent didn't own):**
1. **Legacy NEVER uses `.badge` for NC status or disposition — anywhere.** Both `_viewNC` (L22718-19) and the list row (L22524-25) use **plain coloured `<span>`/`<b>`**. **`badge()` L1959 has no NC entry.** Our port badges both, in both views. **A port-wide vocabulary call.**
2. **`return_to_vendor` is `b-orange` in our port; legacy computes `var(--purple)`** — identically in `_viewNC` L22719 **and** the list L22525. **A real colour divergence** — but **`.b-purple` does not exist** (grepped: only `b-green/amber/blue/red/grey/cyan/orange/teal`, L512-547). Fixing needs a new class (banned) or an inline `--purple` token, **and would change `list.tsx`'s rendering.** **Your call.**

**A legacy gap correctly NOT ported:** `_viewNC`'s `stColor` maps only Pending/Disposed/Closed, so **`Rework Done` falls through to GREY in legacy**; our `b-cyan` is arguably better.

**Deliberately not copied:** legacy prints **`"Opnull: "`** and `undefined`-ish artifacts when `opSeq`/`itemName` are absent (`esc(null)`→`''`). **The `??`/`||` fallbacks were preserved and nothing is rendered rather than a fabricated value.** Blue tint mapped from legacy's **dark** `rgba(59,130,246,…)` to light-theme `--blue` `#2563eb` at identical alpha (ISSUE-067).

**Kept though legacy's `_viewNC` lacks them:** **`Rework Done Qty`** (legacy's *list* shows `♻ n/m done` at L22536 and our close-rework flow captures it) and the panel-header rejected-qty chip.

**🟢 Verified clean:** **ISSUE-095** — a single-row `useNcRegister(id)` fetch, no cap; `useJcOpsEnriched` feeds only the rework dropdown. **Fields fetched and rendered nowhere: NONE LEFT** — every field in `ncRegisterSchema` was walked; `jcOpId` (dispose guard), `qcOperationText` (`||` fallback, preserved) and `linkedCapaCode` (header link) are all bound. **`jobCardId` was the one dead field; now resolved via `jcCode`.**

### QC Processes — NO shared builder (the cost-centers shape), and `/qc-processes/$id` is port-only (registry error #23)

**There is NO shared body builder — and that IS the finding.** `addQCProcess` (L23475) and `editQCProcess` (L23492) **each inline their own string literal** directly into `showModal(title, body, cb)` — traced both call sites; **neither calls a helper**; the `'<div class="form-grid">'+…` literal is built inline at **L23478-83** and **L23495-500**. **Unlike `poHeaderForm`/`jcModalBody`, there is nothing one hop further. This is the COST-CENTERS shape: two independent builders.**

**Complete universe of legacy QC-process functions** (case-insensitive grep): `renderQCProcessMaster` L23446 (list) · `addQCProcess` L23475 · `editQCProcess` L23492 · `delQCProcess` L23508 · `_selQCProcesses` L23516 · `_dlQCProcesses` L23523 · `_mobQCPending` L28256 (unrelated). **That is all seven.**

**`/qc-processes/$id` → CATEGORY 1, port-only, ZERO EDITS. All four signature markers present:**
1. **No detail fn** — `viewQCProcess|_viewQCP|qcProcessDetail` → **0 hits**; the function list is exhaustive.
2. **One router key** — L2407 `qcprocessmaster: ()=>renderQCProcessMaster()` → the list.
3. **Rows = Edit + Del only** (L23456-57), **no View/👁**.
4. **No expand row** — `expand|toggle|👁|View` inside L23446-73 → **0 hits**.
**And the agent named why it checked #4 anyway: "the PO expand-row was a decoy — absence isn't proof, so I leaned on markers 1-3, which are conclusive."** *(Exactly right: markers 1-3 are positive evidence; #4 is only corroboration.)*

**🟢 ISSUE-099: no drift, and the asymmetry MIRRORS A REAL SERVER RULE — checked before crying drift** (3rd confirmation this check matters): `updateQcProcessInputSchema` = `createQcProcessInputSchema.partial().omit({code:true})`, and `updateQcProcess` **only ever writes `description`/`defaultCycleTimeMin`/`isActive`**. **Starring a field the edit path never submits would be ISSUE-100 text.** **The cost-centers master reached the identical conclusion independently.**

**FOOTER from the call site:** both use **`showModal`** (not `showModalLg`) → **L28026-27 hard-codes `Cancel`/`Save`.** No `✓`, no title-derived label.

**Real work:** `form-grid form-grid-3` → **`form-grid`** (legacy is 2-col; our 3-col left Cycle Time + Status in a row with a **dead third column**). `★` → **create-only**. **Placeholders → create-only** on all three inputs (**legacy's edit emits `value=` and NO `placeholder=`**) — *not cosmetic: description is nullable, so an empty one previously showed a create-only prompt on the edit page.* Submit label → **`Save`**.

**🟢 ISSUE-104 CLEAN — all four vectors checked:** `step="0.01"` matches `numeric(8,2)` scale **exactly** (no ISSUE-152 integer-rejection, no `step="0.5"` narrowing); **neither side sets `max`**, column ceiling 999999.99 → no narrowing; **Status `<select>` is a 2-value boolean over a `NOT NULL boolean` → GUARANTEED to contain every stored value**; the list's `limit` feeds a **table, not a select**. **No edit-path rewrite risk.** **ISSUE-065 N/A** — no date fields, no `toISOString()` in the module.

**Reported, not fixed:**
- **Rename is a real capability loss** — legacy `editQCProcess` L23503 does `p.name = name`; **our server omits `code` from update → renaming is impossible.** **But legacy's rename is itself unsafe:** route cards / job cards store `op.operation` as the **name string**, so **a legacy rename silently orphans every referencing op.** Our immutability is defensible; flagged rather than unilaterally added.
- **Zero-value display:** legacy's edit emits `value="'+(p.defaultCycleTime||'')+'"` → **blank for 0**; ours binds `Number(...)` → renders **`0`**. Left alone (data binding, rule 7).
- **RBAC:** legacy early-returns on `!canEntry()`/`!canEdit()`; our `new.tsx`/`edit.tsx` render to any role (`list.tsx` hides the buttons; the server enforces `requireWriteRole`). **Per CLAUDE.md this is acceptable** — but a direct URL hit gives a viewer a form that **403s only on save**.

**Deliberately NOT copied:** the **`(hrs)` label** (ISSUE-204 — would mislabel a minutes column); **editable name** (server omits `code`); **description stays `<input>`** — *"the textarea rule is **keep** a textarea, not **convert** one; no legacy-origin data can contain CR/LF"* (**a precise reading — the rule exists to prevent CR/LF loss, not to upgrade controls**); **`delQCProcess` hard-deletes** (`db.qcProcesses.filter(...)`) — ours soft-deletes, **correct per rule 8**.

**`form-help` "Name cannot be changed after creation." is OURS, not legacy's — and correctly KEPT:** it explains a constraint **the server does enforce**, so it is **not** an ISSUE-100 violation. *(Contrast the items/machines forms, where the same sentence was removed as invented — there it described a rule; here it describes a real one. The distinction is enforcement, not wording.)*

**`_selQCProcesses`' green border — checked before reproducing:** it is an **inline style** (`border-color:var(--green);background:rgba(34,197,94,0.04)`), **not a class**, and **not inert**. Not reproduced — it belongs to the Route Card dropdown (ISSUE-109). **Note for whoever builds it: `rgba(34,197,94,…)` is the DARK theme's green; our light `--green` is `#16a34a`.**

## ISSUE-205 — `dateLike()` over raw `tx.execute` — INVESTIGATED AND CLEARED (not a defect)

- **Surfaced:** 2026-07-16 (REFACTOR-1, GRN detail — flagged as an **unverified conditional**, correctly)
- **Severity:** none — **cleared by test**
- **Status:** [x] closed 2026-07-16. **Recorded so it is not re-raised.**

**The concern (well-formed):** `goods-receipt-notes/service.ts:188` `dateLike()` does `v.toISOString().slice(0,10)`. The detail uses **raw `tx.execute(sql…)`**, which bypasses Drizzle's column mapping and hands `date` (OID 1082) to the driver's default parser. **If that parser returns a JS `Date` at LOCAL midnight, `toISOString()` would shift it back a day on an IST host.** No `setTypeParser` and no `TZ=` exist anywhere in `apps/api/src` — **verified independently; both still true.**

**Why it does NOT reproduce — the driver was misidentified:**

| | |
| --- | --- |
| **Claimed** | node-postgres' default parser → `Date` at **local** midnight |
| **Actual** | **`db/client.ts:1-2` uses `drizzle-orm/postgres-js` + `postgres`** — the **postgres.js** driver, not node-postgres |
| **postgres.js** | `postgres@3.4.9/src/types.js:28-32` — `from: [1082,1114,1184]`, **`parse: x => new Date(x)`** |
| **The JS spec** | **ECMA-262: a date-ONLY ISO form (`'2026-04-29'`) parses as UTC**, not local. *(Date-TIME forms without an offset parse as local — that's the distinction.)* |
| **Therefore** | the `Date` is **UTC midnight** → `toISOString().slice(0,10)` returns **the same date** |

**Proven, not reasoned** — executed on a host at **UTC+5:30 (IST)**, the exact failing condition:
```
new Date('2026-04-29')          -> 2026-04-29T00:00:00.000Z
toISOString().slice(0,10)       -> 2026-04-29
host TZ offset (min)            -> -330   (IST)
SAFE?                            -> true
```
**`dateLike()` is safe regardless of host TZ.** *(node-postgres genuinely does return local midnight for dates — so this concern is correct for that driver and wrong for ours. Worth remembering if the driver ever changes.)*

**🟢 THE PROCESS POINT, which matters more than the finding:** the agent wrote *"I am flagging this as an unverified conditional, not a confirmed break — I did not verify the deployed TZ, and I will not convert an unknown into a claim."* **That discipline let this be settled in two commands.** Contrast the five false parity comments (ISSUE-113/136/143/184 + JW DC's), every one of which was **an unknown asserted as a fact** — and each of which then *stopped* anyone from looking.

**Note it does NOT weaken ISSUE-142** (the so-timeline 500): that bug is `Date.prototype.localeCompare` **not existing**, which is independent of any timezone. Both findings sit on the same postgres.js `parse: x => new Date(x)` behaviour — one is fatal, one is harmless.

## ISSUE-206 — GRN detail: five fields fetched and rendered nowhere

- **Surfaced:** 2026-07-16 (REFACTOR-1, GRN detail)
- **Severity:** P3 — but see why nothing was added
- **Status:** [ ] open

`goods-receipt-notes/service.ts:418-422` selects **`qcRemarks`, `qcInspectedBy`, `qcReportPath`, `qcReportName`**, and line-level **`remarks`**. All five reach `GoodsReceiptNoteLineDetail`. **None render** in `detail.tsx`. *(17th page in this class.)*

**`qcReportPath`/`qcReportName` are the notable pair:** a **`QcReportLink` component already exists** and is used by `incoming-qc/routes/index.tsx:337` and `tpi/routes/index.tsx:255`, and the schema comment (`shared/…/goods-receipt-note.ts:59-61`) cites legacy **`_viewQCReport` L23860**.

**The agent did NOT add it — and the reasoning is right:** **L23860 lives on the Incoming QC page**, and **there is no legacy GRN detail to port it from**. Adding it here would be **an invention, not a port**. *(The page is port-only; "what would legacy do" has no answer, so the live-system rule governs: keep what works, invent nothing.)*

### GRN detail — mapping verdict (registry error #24): CATEGORY 1, and legacy's GRN detail is NOT EXPRESSIBLE

**Zero edits.** All markers checked, and **four decoys chased and eliminated**:

| Marker | Result |
| --- | --- |
| **1. No detail fn** | `viewGRN` / `editGRN` / `_viewGRN` / `grnDetail` → **zero hits across 29k lines** (confirmed independently of my grep) |
| **2. One router key → the list** | **L2434 `grn: ()=>renderGRN()` is the ONLY GRN router entry.** `renderGRN()` L26444 returns `section-hdr` + 4 `stat-card`s + the "GRN Register" table. **Unambiguously the list.** |
| **3. Row action inventory** | **Every `onclick` in the row body (L26461-73) enumerated. There is exactly ONE**, and it isn't a detail: `assignBtn` (L26458-60) → `_assignTaskFromContext({type:'GRN'…, navPage:'incomingqc'})` = our `AssignTaskButton`. **No View, no 👁, no Edit, no Del — even more minimal than the master-detail signature.** |
| **4. Expand row** (corroboration only) | **None.** Flat `<tr>` of 11 `<td>`s, no row-level `onclick`, no toggle state. |

**Decoys eliminated (the agent did not stop at the first hop):**
- **`grnQC(grnId)` L26740 — the strongest candidate.** Called from **exactly one site: L23776**, inside **`renderIncomingQC()` L23748 — a DIFFERENT router key.** And **it is not read-only**: it early-returns **`toast('QC already completed')`** (L26743) and writes inspection results. **"A detail view never refuses to open."**
- **`createGRNfromPO(poId)` L26730** — called from the PO list (L25297) and L6875; it does `nav('grn'); addGRN()` → **a CREATE prefill**, not a detail.
- **`renderPartyGRN` L24251 / `addPartyGRN` L24298** — a **separate module** (`party_grn`, the *second* `grn_date` table at schema.ts:2961). **Not this table.**
- **`_rptPOGRN` L20396**, **`_mobGRNEntry` L28466** — a report and the mobile entry form.

**🔴 THE STRUCTURAL CLINCHER — and it generalises:**
> **Legacy's GRN is a FLAT ONE-ITEM RECORD** — `g.itemCode`, `g.receivedQty`, `g.qcAcceptedQty`, all **singular** (L26466-69). **It has no header+lines shape to expand into.** Our `goods_receipt_note_lines` table is **a deliberate normalisation BEYOND legacy**.
> **A legacy GRN detail is not merely absent — it is not EXPRESSIBLE.** Forcing a mapping would mean **inventing a page**.

**This is the JW grain insight in a second form:** there, `db.jobWorkOrders` was a flat array of lines with **no header entity**; here, a GRN is a flat record with **no lines entity**. **Both times, OUR NORMALISATION IS THE MIGRATION** (CLAUDE.md §1/§12), and both times parity would have meant porting the anti-pattern back in.

**🟢 `qc-status-badge.tsx` is FAITHFUL — verified, not assumed, and a "fix" correctly refused.** **Legacy does NOT route GRN through `badge()`** (L1959 has no GRN path; **its `'Partial':'b-amber'` is a red herring**). GRN uses an **inline ternary at L26457**: `Pending→b-amber, Partial→b-blue, Completed→b-green`. **Ours is `pending→b-amber, in_progress→b-blue, completed→b-green` — an exact match to the site that actually renders GRN.** **"Fixing" it to `badge()`'s mapping would be a REGRESSION.** *(Third module where legacy bypasses `badge()` — NC does too. Always check whether `badge()` is even the renderer.)*

**🟢 Verified clean — real results, recorded so they aren't re-audited:**
- **ISSUE-123 does NOT reproduce.** The detail query filters **`deleted_at IS NULL` on all FIVE relations**: `grn` (:397), `po` (:392), `v` (:394), `gnl` (:429), `i` (:427). **No `pol.deleted_at`-shaped gap.**
- **ISSUE-124/161 does NOT reproduce.** **No `poType`/`job_work`/`'Job Work'` comparison exists anywhere in the GRN module's logic** — the only hits are `poType:'standard'` in **test fixtures**. **Verified rather than assumed** (I flagged it because a GRN is downstream of a PO; the check was right, the fear wasn't).
- **ISSUE-095 clean** — the line query (:403-431) has **no LIMIT**; nothing capped, **nothing disclosed** (ISSUE-174 precedent).
- **Trap 1 clean** — no constant in a measurement's costume; the `'—'` fallbacks are on **genuinely nullable** columns.
- **ISSUE-065 mech 4 clean** — `grn_date` (:1513) and `qc_date` (:1582) are both **`date`**. *(schema.ts:2961 is `party_grn` — a different module.)*
- **ISSUE-040: no seam** — the detail renders `detail.grnDate` raw and the list renders `{row.original.grnDate}` raw (`list.tsx:98`). **They AGREE** — the NC-style good case, not the Invoices-style split.

**ISSUE-065 mech 1 CONFIRMED at the line I named:** `cascades.ts:191` — `txnDate: new Date().toISOString().slice(0,10)`. **Server-side; this is the site that stamps `store_transactions.txn_date`, so a GRN received at 02:00 IST dates the stock ledger yesterday.** Not fixed (out of scope).

**Two divergences logged but NOT actionable** — both live on a page **legacy never had**, so there is no parity target: our badge label lowercases (`in progress` vs legacy's `Partial`), and our `AssignTaskButton` sets `navPage: /goods-receipt-notes/{id}` where **legacy L26459 sets `navPage:'incomingqc'`**.

## ISSUE-207 — 🔴 ISSUE-043 confirmed LIVE on the Issue Register, with a concrete reproduction

- **Surfaced:** 2026-07-16 (REFACTOR-1, Issue Register)
- **Severity:** P2 — server-side
- **Status:** [ ] open

`apps/api/src/modules/store-issues/service.ts` — **the rows query applies `searchFrag` / `fromFrag` / `toFrag`; the count query applies ONLY `companyId`, `deletedAt`, `itemId`.**

**This page passes `search`.** So searching produces **"Showing 1–25 of 412" with Next paging onto EMPTY pages.**

**The 7th module in the ISSUE-043 family**, and one of the few with the reproduction spelled out rather than inferred. Fix is server-side: **the count must apply the same predicates as the rows.**

*(Note the interaction: the page's `total` is a real server-side no-LIMIT count, so it is **ISSUE-095-compliant** — nothing is capped and no disclosure was invented. Its accuracy is compromised **only** by this filter mismatch. Two adjacent bugs that look identical from the UI and have opposite fixes.)*

## ISSUE-208 — ISSUE-065 mech 1 on the Issue Register modal (and both tool-issues sites)

- **Surfaced:** 2026-07-16 (REFACTOR-1, Issue Register)
- **Severity:** P2
- **Status:** [ ] open

`new Date().toISOString().slice(0,10)` seeds the modal's Date → at **00:00-05:29 IST the form defaults to YESTERDAY** — on a **store-issue register**, i.e. inventory movement history.

**Also at `tool-issues/routes/list.tsx:431` and `:639`** — pre-diagnosed for that page.

**Confirmed again: no shared IST helper exists** (`apps/web/src/lib/` has none). **No 13th `fmt()` copy added** (ISSUE-040). Legacy's `today()` L1485-87 uses `getFullYear/getMonth/getDate` = local = **correct**.

## ISSUE-209 — Issue Register renders raw ISO dates

- **Surfaced:** 2026-07-16 (REFACTOR-1, Issue Register)
- **Severity:** P3
- **Status:** [ ] open — closes with ISSUE-040

Renders `2026-07-15`; legacy's `fmt()` gives **`15 Jul 26`** (`en-IN`). **Legacy is correct because `fmt()` appends `'T00:00:00'` → LOCAL parse → no UTC shift.** Blocked on the same shared helper.

## ISSUE-210 — Issue Register modal has no "Issue No." field, and computing one client-side would be a race

- **Surfaced:** 2026-07-16 (REFACTOR-1, Issue Register)
- **Severity:** P3
- **Status:** [ ] open — correctly not built

Legacy prefills **`_nextIssueNo()`**. **Our server allocates the code atomically (`nextStoreIssueCode`) — which is BETTER.**

**But `DOC_NUMBER_TYPES = ['sales_order','job_work_order','purchase_order','grn']`, so `useDocNumber` CANNOT serve a store issue.** Computing MAX+1 in React would be **a browser-computed business figure AND a race**. **Correctly not added.**

*(Same family as the Invoice create refusal: legacy's `_nextInvNo()` was a browser MAX+1 and our server owns it. The difference here is that the DTO can't even expose a preview — so the field stays absent rather than fake.)*

## ISSUE-211 — Issue Register: legacy's live Stock hint is unportable

- **Surfaced:** 2026-07-16 (REFACTOR-1, Issue Register)
- **Severity:** P3
- **Status:** [ ] open

Legacy's `_issueItemFill` shows **`Stock: <b green>N</b> uom`** as you pick an item. **`ListItemsResponse.items: Item[]` has `uom` but NO stock figure.**

**Omitted rather than fabricated** — and the safety net is real: **the server still returns a genuine `ConflictError` ("available X, requested Y") on save.** So the user is protected; they just don't get the preview.

**Related to ISSUE-111 (amended):** on-hand **is** server-available via `v_item_stock.on_hand_qty` — the gap is **DTO exposure**, not structure. So this hint is a one-field API change, not a schema change.

## ISSUE-212 — ⚠️ STOP RE-RAISING THIS: `dateLike()` over raw `tx.execute` is SAFE. Two agents have now flagged it.

- **Surfaced:** 2026-07-16 (REFACTOR-1 — raised **independently by the GRN detail AND Issue Register agents**)
- **Severity:** none — **cleared by test, twice-raised**
- **Status:** [x] closed. **Recorded prominently to stop a third agent spending budget on it.**

**The recurring claim:** *"the service's raw `tx.execute` bypasses Drizzle's string mode, so **node-postgres** parses DATE into a local-midnight `Date`, and `dateLike()` does `toISOString().slice(0,10)` → off-by-one if deployed in IST."*

**THE DRIVER IS MISIDENTIFIED. We do not use node-postgres.**

| | |
| --- | --- |
| **`db/client.ts:1-2`** | `drizzle-orm/postgres-js` + `import postgres from 'postgres'` → **postgres.js** |
| **postgres.js** (`postgres@3.4.9/src/types.js:28-32`) | `from: [1082,1114,1184]`, **`parse: x => new Date(x)`** |
| **ECMA-262** | a **date-ONLY** ISO form (`'2026-04-29'`) parses as **UTC**. *(Date-TIME forms without an offset parse as local — that is the distinction that makes this confusing.)* |
| **Result** | UTC midnight → `toISOString().slice(0,10)` returns **the same date** |

**Proven on a host at UTC+5:30 (IST) — the exact failing condition:**
```
new Date('2026-04-29')     -> 2026-04-29T00:00:00.000Z
toISOString().slice(0,10)  -> 2026-04-29
host TZ offset (min)       -> -330  (IST)
SAFE?                       -> true
```
**Also verified: no `setTypeParser` and no `TZ=` anywhere in `apps/api/src` — both true, and both irrelevant given the above.**

**node-postgres genuinely DOES return local midnight for dates** — so the concern is **correct for that driver and wrong for ours**. **If the driver ever changes, this becomes real.**

**⚠️ Does NOT weaken ISSUE-142** (the so-timeline 500): that bug is **`Date.prototype.localeCompare` not existing**, which is timezone-independent. **Both findings sit on the same postgres.js `parse: x => new Date(x)` behaviour — one is fatal, one is harmless.** That is precisely why the driver's actual behaviour must be checked rather than assumed in either direction.

### Issue Register — mapping CONFIRMED (the registry was right, for once)

**`renderIssueRegister()` L23874-23905**, router key **`issueregister` L2408**, sidebar `nav('issueregister')` L429. Modal = **`addIssue()` L23914**. **Verified independently, not assumed** — and the registry's mapping was **correct**, which has happened roughly four times in 25 checks.

**`_mobIssueEntry` L28401 exists in the `_mobPage` map — ignored per the settled rule.** *(Third agent to apply it without prompting.)*

**Real work:** the **empty state** was a separate `panel-body` + an **invented `empty-icon` 📋** + `<strong>` → legacy's **in-table `<tr><td colSpan={10} className="empty-state">`**. **`colSpan` verified = 10 against the real column count — and legacy's own is also 10 here, correct for once** *(legacy gets this wrong elsewhere: 11 for a 13-col table, 10 for 11)*. Header Tailwind `mb-3`/`m-0` → legacy's exact `margin-bottom:14px` + `section-hdr{margin-bottom:0}` (**the Tailwind was not theme vocabulary, and 12px ≠ legacy's 14px**). The **modal** went from a hand-rolled inline shell → legacy `showModal`'s real `.overlay`/`.modal`/`.modal-hdr`/`.modal-title`/`.modal-body`/`.modal-footer` + ✕; a local `Field` component → `.form-grp`/`.form-label`/`.form-full` (**deleting 4 inline styles**); legacy's field order restored; save `Save Issue` → legacy's **`Save`**.

**Legacy's `x || '—'` fallbacks restored in four cells** (item name, issuedTo, refType+refNo, purpose) — **the port had dropped them**, which is the ISSUE-158 mechanism in reverse: *legacy writes `x || 'default'`; the port kept the `x` and dropped the `'default'`, so a null renders as blank rather than an explicit em-dash.*

**"(coming soon)" removed and the Tool Issue Register link restored** — trap 1: the port advertised a page that already exists.

**Deliberately NOT copied:**
- **Pagination + "Showing X–Y of N" KEPT** though legacy renders all rows unpaginated — a working feature. **The count is a real server-side no-LIMIT `total`, so it is ISSUE-095-compliant and no disclosure was invented.**
- **Client-side stock validation not ported** — server-side now (rule 1).
- **Datalist → our custom dropdown kept** — **our API needs `itemId` (a UUID); a datalist binds only `code`.** *(A precise reason: this is the one place where legacy's open-datalist immunity is not available to us, because the value we must submit isn't the value the user types.)*
- `<th className="td-ctr">` left alone (inert in both, settled); `td-code` left on the `<span>` (ISSUE-059, settled).

**No hardcoded-constant traps** — checked specifically for the ISSUE-127 shape; this module's qty is **genuinely bound**.

## ISSUE-213 — 🔴 The 6th false parity comment — and the FIRST one traced to a real feature loss

- **Surfaced:** 2026-07-16 (REFACTOR-1, GRN form)
- **Severity:** **P2** — a working legacy mode deleted, justified by two false claims
- **Status:** [ ] open — blocked in `packages/shared`

**`packages/shared/src/schemas/grn-unified.ts` L3-5 claims:**
> *"the legacy HTML v82.12.**4** reference file is absent, so there are NO HTML line citations"*

**This is weasel-worded.** It is **true about a NEWER file** and used to justify having **no legacy reference at all**. **Its own sibling `goods-receipt-note.ts` L3-6 cites `InnovicERP_v82_12_3…` — `renderGRN()` L26444, `addGRN()` L26515 — both verified exact.** The spec source was sitting in the same folder.

**🔴 THE CONSEQUENCE — this is what separates it from the other five:**
> **Legacy's `✍ Manual` GRN mode (L26535, L26571-84) was DROPPED.** Legacy has **three** inward types: *Against PO* / *Against JWPO·DC* / **Manual**. We ship two.

**And the stated reason for dropping it is ALSO false:** *"store-transactions has no create endpoint."* **Manual GRN writes `qcStatus:'Pending', qcAcceptedQty:0`**, and **`writeStoreTxnOnQcAccept` only fires on completed + accepted > 0** — **so no store endpoint is needed.**

**Two false claims stacked: one said the spec didn't exist; the other said the feature was unbuildable. Together they deleted a working mode and closed the question.**

**The tally is now SIX** (ISSUE-113 fabricated justification · ISSUE-136 wrong line + false "mirror" · ISSUE-143 false "not ported" excuse · ISSUE-184 documents behaviour that doesn't exist · JW DC's named a page after a print trigger · this). **Five were merely misleading. This one cost a feature.**

**Blocked from fixing here:** `GRN_INWARD_TYPES` lives in `packages/shared`.

## ISSUE-214 — 🔴 The `limit:200` vendor picker — THIRD independent sighting, and this one IS live edit data loss

- **Surfaced:** 2026-07-16 (REFACTOR-1, GRN form — **found independently of ISSUE-154 (PR form) and ISSUE-167 (PO form)**)
- **Severity:** **P1**
- **Status:** [ ] open

`useVendorsList({ limit: 200 })` → a **native `<select>`**, **not disabled on edit**. Vendor #201+ has **no `<option>`** → the select blanks → **`vendorId || undefined` → silently dropped on save = DATA LOSS on edit.**

**Create is a parity gap only** — the `vendorCodeText` fallback keeps it reachable.

**🔴 A SECOND, DISTINCT INSTANCE ON THE SAME FORM — and it stacks two exclusions:**
> **The PO select is narrowed by `limit:200` AND by `status ∈ draft|open|partial|qc_pending`.** So **a GRN against a now-CLOSED PO drops `purchaseOrderId`.** A page boundary *and* a status filter, on one control.

**THREE agents, three modules, zero knowledge of each other, same defect.** The class is settled beyond doubt.

**The rule, in its final and corrected form** (I got the earlier version wrong — see ISSUE-198):
> **Any option list not guaranteed to contain every stored value will silently rewrite out-of-list values on save — whether excluded by a `<>`, a status filter, a narrow enum, or a PAGE BOUNDARY.**
> **The immunity is the HANDLER'S NO-MATCH PATH, not the control type.** Datalist that leaves free text intact → immune. `SearchableSelect` that falls back to `valueLabel` → immune. **Datalist that NULLS the id on no-match → NOT immune** (NC form). **Native `<select>` → never immune.**
> **On create it is a parity gap; on EDIT it is data loss.**

**The audit is mechanical and overdue: grep every `useXList({ limit: N })` feeding a form control, and trace its no-match path.**

## ISSUE-215 — GRN lines hide Order / Prev Recv / Pending, so buyers lose over-receipt visibility

- **Surfaced:** 2026-07-16 (REFACTOR-1, GRN form)
- **Severity:** P2
- **Status:** [ ] open

Legacy **L26674-85** shows **Order qty, Previously Received, and Pending** per line, plus **`max="pending"`** on the receive input. **We show none of the three.**

**And we already have the data** — the seeding effect computes `l.qty - l.receivedQty`. It is simply never displayed.

**`max="pending"` correctly NOT added:** **the server has no such cap**, so adding it would be **frontend business logic over a wider column** — the ISSUE-104 shape in the narrowing direction. **Show the figures; don't invent the constraint.**

### GRN form — mapping (registry error #25): NO body builder (the QC-Process shape), and edit is category 4

**Create → `addGRN()` L26515**, reached from `+ New GRN` (renderGRN L26481) and `createGRNfromPO()` L26730 (**which just calls `addGRN()`**).

**🟢 BODY BUILDER: THERE IS NONE — and the agent proved it rather than failing to find one.** `addGRN` builds **`var body='…'` as an inline literal, L26530-26565**, and passes it straight to `showModalLg` at L26567. **This is the QC-Process / cost-centers shape.** `_grnRefreshPOLines` L26668 and `_grnLoadJWPODCs` L26692 are **post-render DOM injectors** into `#grnPOLinesBody`/`#grnJWPOBody` — **not body builders**. *(The distinction matters: I have twice named a delegate as the builder — `_poLinesHtml`, `jcModalOpsHtml` — so "there is no builder" is a real finding, not a search failure.)*

**Edit → CATEGORY 4, proven by EXHAUSTIVE row enumeration, not by the grep:** `renderGRN`'s `<tr>` (L26461-73) has **11 cells; ten are inert text** (`grnNo`, `grnDate`, `poNo`, vendor, `itemCode`, received, accepted, rejected, badge, ref). **The `<tr>` itself carries NO `onclick`.** The single interactive element is `assignBtn` (L26458-60) → `_assignTaskFromContext({type:'GRN', navPage:'incomingqc'})` — **task assignment, gated on `(isAdmin()||isManager()) && qcSt==='Pending'`. A nav/assign, not an edit.** **The only entries to a GRN modal in the entire file are `addGRN()` and `createGRNfromPO()→addGRN()`. Both create.**
*(This independently corroborates the GRN **detail** agent's identical row inventory — two agents, same conclusion, same evidence.)*

**FOOTER from the call site:** `showModalLg('📥 New GRN', body, cb, 'Create GRN')` — an **explicit `saveLabel`**, so **no title-fallback branch runs**. L28044 renders `&#10003; ${_saveLabel}` on **`.btn-success`** → **`✓ Create GRN`**.

**Real work:** header **reordered to legacy** and `form-grid-3` → **`form-grid`** (legacy L26537 is 2-col); mode labels `Purchase`→**`Against PO`**, `Job Work Return`→**`Against JWPO / DC`** (L26533-34); title → **`📥 New GRN`**; **a FALSE `★` removed from GRN No.** (legacy's is readonly/auto with no star — **the 5th instance of that exact drift**: SO, PO, PR, JW, GRN); PO/Vendor **moved out of the header into legacy's `▸ SELECT PO` section**; legacy's placeholders restored; **an invented subtitle and a false store-adjust note removed**.

**🟢 CHECKS THAT CAME BACK NEGATIVE — verified, not assumed:**
- **ISSUE-152 does NOT apply.** `receivedQty`/`qcAcceptedQty`/`qcRejectedQty` are **`integer`** columns — **so the missing `step` is CORRECT** (the browser's `step=1` default matches the column exactly). *(The inverse of the ISSUE-152 finding: there a missing `step` broke a decimal column; here it fits an integer one. The rule is "match the column", not "always add a step".)*
- **ISSUE-065 mech 4 safe** — `grnDate` is a **`date`** column.
- **Remarks correctly stays a `<textarea>`** — `max(2000)`; **kept, not converted** (the rule is "keep", not "upgrade").

**ISSUE-065 confirmed at THREE sites in this module:** `cascades.ts:191` `txnDate` (**mech 2, inlined** — a 02:00 IST GRN stamps the ledger **yesterday**); `goods-receipt-note-form.tsx` `HEADER_DEFAULTS.grnDate` (**mech 1, inlined — and module-level, so frozen at import**); `job-work-return-section.tsx` `today()` (**mech 1, named helper**). **All three shapes in one module.** Documented in place, not fixed.

**Deliberately NOT copied:**
- **QC fields on create** — **legacy hardcodes `Pending`/0/0 and does QC on the Incoming QC page** (L26503). **Ours is a superset; kept.**
- **Line cards, not legacy's table** — our line carries **11 fields including a file upload**; a table would crush it. **Reported (ISSUE-215) instead of forced.**
- **GRN No. not made readonly** — **our schema explicitly supports the override** (*"A caller may still pass a code"*) and `DocNumberInput` adds duplicate-checking. **Only the false ★ went.**
- **`max="pending"` not added** — the server has no such cap.
- **JW Return section labels left alone** — **it posts to `jw-dc/inward` (with OK/Rejected), not legacy's `db.grn`.** Renaming would **misdescribe** it. **And the earlier agent's refusal to bypass the atomic cascade was not re-litigated.**

## ISSUE-216 — 🔴 PR Approve DOES NOT EXIST — and my recorded reason for the refusal was INVERTED

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail — **the agent challenged a finding I had been propagating for many batches**)
- **Severity:** **P2** — an unbuilt action, and a corrupted note that hid it
- **Status:** [ ] open — **supersedes the earlier "PR Approve" note in TASKS.md/ISSUES.md**

**What I have been briefing, repeatedly:**
> *"3 agents correctly refused endpoints — PR Approve, because **legacy's handler never stamps the approver**."*

**That is BACKWARDS. Verified by direct read:**

**Legacy DOES stamp** — `approvePR` **L6416-6423**:
```js
pr.status='Approved';
pr.approvedBy=(currentUser()||{}).name||'Admin';   // ← it stamps
pr.approvedDate=today();
logActivity('PR_APPROVE', …);
```

**WE have no approve endpoint at all.** `apps/api/src/modules/purchase-requests/service.ts` **L1-7, its own header comment**:
> *"Only the basic field updates land here in T-036a; **the approve + create-PO actions ship in T-036b** alongside the PO module."*

**No approve function exists in `routes.ts`. `T-036b` apparently never shipped.**

**But the columns exist and every READ path maps them:** `approved_by` / `approved_at` selected at **service.ts:209**, mapped at **:166** and **:282-283**; schema.ts:1325, 1330.

> **So `approvedBy` / `approvedAt` are STRUCTURALLY ALWAYS NULL.** The write path was deferred and forgotten; the read path shipped.

**The refusal itself was CORRECT** — an agent was right not to wire an approve button. **The reason I recorded inverted which side had the gap**, and I then propagated that inversion into every subsequent brief. **Correction #11, same root cause as the other ten: I recorded a conclusion without tracing the claim.**

**This also explains ISSUE-220 from underneath:** `approvedBy` is not "fetched but rendered nowhere" by oversight — **there is nothing to render.**

**Action:** build the approve action (T-036b), or drop the dead columns. **Do not add a UI for `approvedBy` until something writes it** — that would be ISSUE-127's shape (a field impersonating a measurement).

## ISSUE-217 — PR detail: Vendor's placeholder precedence hides a real value (the NC `'— linked —'` defect, exactly)

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail)
- **Severity:** P2
- **Status:** [ ] open

**Two fields on one page use OPPOSITE precedence:**

| Field | Expression | Verdict |
| --- | --- | --- |
| **Item code** | `itemCodeText ?? (itemId ? '— linked —' : '—')` | **text first — correct** |
| **Vendor** | `vendorId ? '— linked —' : (vendorCodeText ?? '—')` | **placeholder first — WRONG** |

**The schema's CHECK requires only *at least one* of `vendorId`/`vendorCodeText`, so BOTH may be set** — and when they are, **the Vendor cell hides a real vendor code behind `'— linked —'`.**

**This is the NC detail defect precisely** (ISSUE-202's neighbour): *a placeholder rendered while the real value sits one field away.* Two independent pages, same mechanism.

## ISSUE-218 — PR detail renders raw ISO timestamptz values into the DOM

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail)
- **Severity:** P3 (display) — but see ISSUE-219 for the live mech-4 site
- **Status:** [ ] open

`approvedAt` / `poCreatedAt` are **`timestamptz`** (schema.ts:1325, 1330) rendered **raw**: `<Pair label="Approved at" value={detail.approvedAt ?? '—'} />` → **`2026-04-29T18:30:00.000Z`** on screen.

`prDate` / `requiredDate` are **`date`** → **safe but unformatted** (`2026-04-29` vs legacy `fmt()` → `29 Apr 26`).

**Reported, not fixed** — ISSUE-040, no 13th local `fmt()`. *(Moot until ISSUE-216 lands, since `approvedAt` is always null today.)*

## ISSUE-219 — PR list: `.slice(0,10)` on a `timestamptz` is a LIVE mech-4 site, and it creates a seam

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail — found in a file the agent didn't own)
- **Severity:** P2
- **Status:** [ ] open

**`purchase-requests/routes/list.tsx:146` and `:154`** render `approvedAt.slice(0, 10)`.

**`approvedAt` is a `timestamptz`** → **`.slice(0,10)` takes the UTC date of the instant** → **00:00-05:29 IST shows the previous day.** That is **ISSUE-065 mechanism 4, live** — not merely a formatting gap.

**And it creates a seam:** the **list** slices, the **detail** renders raw. **Two presentations of one column, in one module.** *(The Invoices shape — worse than NC's, where list and detail at least agree.)*

## ISSUE-220 — PR: `prType` is on the payload and rendered nowhere

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail)
- **Severity:** P3
- **Status:** [ ] open

Of the five originally flagged: `sourceJcOpId`, `sourceSoLineId` and `approvedAt` **are** rendered (subject to ISSUE-216/218); **`prType` and `approvedBy` are not.** **`approvedBy` is ISSUE-216's dead column** — so **`prType` is the only genuine instance.**

**No layout slot invented for it** on a page with **no legacy counterpart** — correct.

## ISSUE-221 — PR detail's Create-PO gate is WIDER than legacy's, and legacy hard-refuses

- **Surfaced:** 2026-07-16 (REFACTOR-1, PR detail)
- **Severity:** P2
- **Status:** [ ] open

Our detail offers **Create PO** when `status === 'open' || 'approved'`.

**Legacy `createPOFromPR` L6734 HARD-REFUSES:**
```js
if(!pr || pr.status!=='Approved'){ toast('PR must be Approved to create PO','err'); return; }
```

**So the `open` path offers a button legacy would reject** — the user clicks and gets an error, or worse, succeeds where legacy wouldn't.

Business logic + another agent's route (`/purchase-orders/from-pr`) — **correctly not touched.** **But note it interacts with ISSUE-216:** if nothing can move a PR to `approved` (no approve endpoint), then **`open` may be the only reachable state — and the wider gate may be the only reason Create-PO works at all.** **Fix these two together.**

### PR detail — mapping verdict (registry error #26): CATEGORY 1, eight markers, all independently re-derived

**`/purchase-requests/$id` has NO legacy counterpart.** The agent **did not take the handoff's word** — it re-enumerated everything:

1. **Function grep → ZERO hits** for `viewPR`/`_viewPR`/`prDetail`/`_prDetail`/`showPR`/`_prView`/`prView`. **The single `openPR` hit (L27065) is a VARIABLE** counting open PRs in the outsource dashboard — **not a function.**
2. **Router L2432:** `purchaserequests: ()=>renderPurchaseRequests()` is the **only** PR key. **No `prdetail`. The router takes no id.**
3. **Row actions re-enumerated exhaustively (L6255-6270):** `approvePR` (Pending), `cancelPR` (Pending), `createPOFromPR` (Approved), an inline `viewPO` span (PO Created), `_assignTaskFromContext` (Admin/Manager). **No view affordance, no edit affordance, on any status.**
4. **The decoy disarmed:** the PO-Created cell's **`viewPO(_po.id)` hop lands on the PO detail (L26299)** — **someone else's page**. And `createPOFromPR` L6732 opens **a PO creation form** carrying a PR context banner — **not a PR view.**
5. **🔴 A NEW MARKER, and a good one: the `showModal(…, null)` read-only signature is ABSENT.** **All five PR modals — L6173, L6355, L6480, L6805, L27153 — have NON-NULL save callbacks. Every one is a create.** *(The marker that positively confirmed NC's `_viewNC` does not occur anywhere in the PR region — so its absence is evidence, not a gap in the search.)*
6. **The canonical detail-link site is INERT:** L6277 is `<td class="mono fw-700" style="color:var(--cyan)">'+esc(pr.prNo)+'</td>` — **plain text, no `onclick`.** *(On every module that HAD a detail, this cell was the hop.)*
7. **No expand row** (corroboration): a flat `<tr>` of 12 `<td>`s, no `<tr onclick>`, no chevron, no hidden `<tr>`.
8. **STRUCTURAL PROOF, not mere absence:** **every PR navigation in 29k lines is a bare `nav('purchaserequests')`** — sidebar L494, L2635, L2830, the alert map L2896-2900, L3002, L3368, L3557, "View All PRs →" L25329, and `_assignTaskFromContext`'s own `navPage:'purchaserequests'`. **Legacy structurally CANNOT deep-link to one PR.** Ours can.

**🟢 `pr-status-badge.tsx` is ALREADY CORRECT — and the reason matters:** **`renderPurchaseRequests` BYPASSES `badge()` entirely.** L6286 is an inline `<span style="font-weight:700;color:'+stColor+'">`. **So `badge()`'s map — which says `'PO Created':'b-blue'` — is NOT the renderer and must not be "fixed" from.** The real source is **`stColor` L6253**: Pending→amber, Approved→blue, **PO Created→green**, Cancelled→red — **exactly what our badge already maps.** Unchanged; **no `list.tsx` impact.**
*(FOURTH module where legacy bypasses `badge()` — GRN via an inline ternary L26457, NC via plain `<span>`/`<b>`, PR via `stColor`. **Checking whether `badge()` is even the renderer is now mandatory, not optional.**)*

**Badge LABEL text diverges — deliberately not changed:** we render `open` / `po created`; **legacy L6286 renders `esc(pr.status)` = `Pending` / `PO Created`.** **Our `open` ≡ legacy `Pending`.** `pr-status-badge.tsx` **is imported by `list.tsx`**, so any label change alters the list — **reported, not acted on.**

**🟢 ISSUE-095 clean** — a single-record fetch; no list, no cap, no `total`. **No disclosure invented.**
**🟢 CSS audit passed** — all 21 classes and all 3 tokens (`--red`, `--red3` `#fee2e2`, `--cyan`) grep-verified **real**. No invented class, no inert class.

## ISSUE-222 — 🔴 SPO numbers are hand-typed: `_nextSPONo` wasn't ported and our server doesn't allocate either

- **Surfaced:** 2026-07-16 (REFACTOR-1, Service PO)
- **Severity:** **P2** — a user now types a number legacy generated
- **Status:** [ ] open — needs shared + api

`createServicePoInputSchema` **requires `spoNo` from the client**; the service **only dup-checks it** (409 `ConflictError`). **Legacy users never typed an SPO number** — `_nextSPONo()` L27496 generated it.

**This is NOT the Invoice / Issue-Register precedent.** There, legacy's browser MAX+1 was correctly dropped **because our server allocates atomically instead**. **Here NOTHING allocates.** The browser MAX+1 still must not be ported (a race — **and our list is paginated, so MAX+1 isn't even computable client-side**), but the gap it left was never filled.

**The infrastructure already exists and fits exactly:**
- `lib/use-doc-number.ts` + `/doc-numbers/check`
- **`DOC_NUMBER_FORMATS` is `prefix + 5 digits`** — and **legacy's `_nextSPONo` emits `IN-SPO-00001`, the identical shape**
- **`DOC_NUMBER_TYPES` (`doc-number.ts:14`) is just `['sales_order','job_work_order','purchase_order','grn']` — `service_po` was never registered.**

**Fix:** add `service_po: { prefix: 'IN-SPO-', digits: 5, label: 'SPO No.' }`, extend the resolver, wire `useDocNumber('service_po', spoNo)`.

**The `★` on the field is CORRECT and was kept** — it is genuinely user-entered and required, **not** server-generated. *(The five-form `★`-on-a-server-generated-field drift does not apply here — the opposite is true.)*

**Related:** `spoNo` is validated only by `codeRegex` (`^[A-Za-z0-9._/-]+$`) — **any string passes; no `IN-SPO-#####` enforcement.**

## ISSUE-223 — 🔴 The "SO / JW No." picker only lists Sales Orders — JWOs are unreachable

- **Surfaced:** 2026-07-16 (REFACTOR-1, Service PO)
- **Severity:** **P2** — a label promising a capability the page lacks
- **Status:** [ ] open — needs a new hook (rule 7)

**Legacy L27519 does `db.salesOrders.concat(db.jwOrders)`.** `new.tsx` calls **only `useSalesOrdersList`**.

**So an SPO can NEVER be costed against a Job Work Order — while the field label says "SO / JW No."** That is trap 1 with the roles reversed: usually the port *copies* legacy text describing a feature it lacks; here **the port wrote its own label describing a capability it lacks.**

**It also drops legacy's `status !== 'Closed' && status !== 'Cancelled'` filter** — so closed/cancelled SOs are offered where legacy hides them. *(Note this is the safe direction of ISSUE-104: a WIDER list can't rewrite a stored value.)*

## ISSUE-224 — The printed SPO omits Remarks and "Approved by"; `DocPrintModel` has no record-notes slot

- **Surfaced:** 2026-07-16 (REFACTOR-1, Service PO)
- **Severity:** P3 — structural
- **Status:** [ ] open — needs shared `doc-print.ts`

Legacy's `_spoPrint` emits **Remarks** and **"Approved by: «name» on «date»"** (L27723). Ours emits neither.

- **`DocPrintModel` has NO record-level notes slot** — `blocks.special_notes` is **admin-template content, not the record's `remarks`**. Same structural shape as **ISSUE-187** (the JW DC's remarks) and **ISSUE-160** (the PO detail's totals): *the UI is honest; the DTO is the gap.*
- **"Approved by" is blocked by ISSUE-225 below** — we have the uuid, not the name.

**Payment Terms + Status WERE restorable via `DocMetaCell` and were restored** — legacy emits both (L27712/L27717) and ours emitted neither; `paymentTerms` sat in the `data` bag reachable **only if an admin template happened to reference `{paymentTerms}`**.

**🟢 No legal-character loss here — checked explicitly:** an SPO is a **purchase order, not a tax invoice**; the vendor address + GSTIN survive in `recipient`, and PAN + `E. & O.E.` come from the shared footer (`doc-print.ts:244`). **The PAN was NOT re-hardcoded** (ISSUE-151). *(Contrast ISSUE-150 (Invoice: buyer address) and ISSUE-186 (JW DC: "⚠ RETURNABLE") — per-document, not systemic.)*

## ISSUE-225 — `ServicePoDetail.approvedBy` is a raw uuid with no name, and `approvedAt` renders UTC as if local

- **Surfaced:** 2026-07-16 (REFACTOR-1, Service PO)
- **Severity:** P3
- **Status:** [ ] open — needs api + shared

- **`approvedBy` is a raw uuid; there is no `approvedByName`.** Legacy's print emits **"Approved by: «name»"** (L27723). **We cannot render a name.**
- **`approvedAt` renders as `slice(0,16).replace('T',' ')` — raw UTC displayed as if local.** ISSUE-065 family: **not a `date` column, so this is a real mech-4 site.**

*(Contrast ISSUE-216: PR's `approvedBy` is never written at all. Here it IS written — `_spoApprove` stamps it — we just can't resolve it to a name.)*

### Service PO — mapping (registry error #26) and a LEGACY BUG that is almost elegant

**`renderServicePO()` L27504 switches on the module-global `_spoTab`** (`'register'` | `'create'`, declared **L27491**): it renders a `section-hdr` + a two-button tab bar, then `(_spoTab==='create' ? _spoCreateForm() : _spoRegister())`.
**Both structural calls confirmed:** **no `showModal` in the region** (L27468's belongs to `_ospDCEdit`) → **`_spoCreateForm` is an INLINE PAGE**; and **L27504 is a SWITCH, not the list.**

| Route | Legacy | Status |
| --- | --- | --- |
| `/service-pos` | **`_spoRegister()` L27630** | Refactored *(the registry's `renderServicePO` is the auto-builder error again)* |
| `/service-pos/new` | **`_spoCreateForm()` L27513** | Refactored — **called with NO argument** from the tab button → `editId === undefined` |
| `/service-pos/$id` | **none — category 4** | port-only |

**`/service-pos/$id` — category 4, traced not assumed:** no `_viewSPO`/`_spoDetail`; row actions are **🖨 / ✅ Approve / ✏ / 🗑 — no View/👁, no expand row**. **Decoy chased:** **`_spoPrint` L27703 is a PRINT TRIGGER** (the JW DC trap exactly) — it opens a `window.open` document, not a screen. **`_spoEdit(id)` L27675** sets `_spoLines`, sets `_spoTab='create'`, calls `render()` → `_spoCreateForm()` **with no arg** → then a **`setTimeout(…,100)` patches fields by DOM id**. **So legacy's edit IS `_spoCreateForm` + a DOM patch. We have no `/service-pos/$id/edit` route**, so nothing maps onto our read-only `$id`. **`_spoCreateForm` was NOT forced onto the detail** — ours is read-only + Approve/Delete, which honestly mirror `_spoApprove`/`_spoDel`.

**🔴 LEGACY BUG FOUND, DELIBERATELY NOT COPIED — and it's a good one:**
> **Because `_spoEdit` never passes `editId`, `_spoCreateForm`'s `spo` is ALWAYS `null` — so the entire `editId` branch (the `'✏ Edit'` header, the prefill) is DEAD CODE.**
> **Legacy's edit screen therefore displays "➕ New Service PO — «a fresh `_nextSPONo()`»" while `fSpoEditId` silently points at the real record.**
> `_spoSave`'s update branch **never assigns `spoNo`**, so the record keeps its real number — **the displayed number is simply wrong.**

**Real defects fixed:**
- **`detail.tsx`: `po.taxType.replace('_','+')` → `'sgst+cgst'`** — **a mangled enum shown to users.** Now `IGST` / `SGST+CGST` — **matching the tfoot 40 lines below that already did it right.** *(An internal contradiction on one page.)*
- **`detail.tsx` TOTAL: `₹{inr(po.total)}` (rounded, no paise) → `toFixed(2)`.** Subtotal and tax used `toFixed(2)`, so the foot read **`₹1,000.00 / ₹180.00 / ₹1,180`**. Legacy's `_spoPrint` uses `toFixed(2)` for all three (**the PO-detail precedent: follow legacy when it is internally consistent**). `inr()` removed — now unused.
- **`new.tsx` header grid: dropped an inline `gridTemplateColumns: repeat(4, 1fr)`** → bare `.form-grid`. **Legacy's own `.form-grid` (L196) is `1fr 1fr`, identical to our theme's — so legacy renders those 4 fields 2×2 and we rendered them 4-across.**
- **Vendor cells (list + detail): `{vendorName ?? vendorCodeText ?? '—'}` → `<VendorLabel>`**, mirroring legacy `vndLabel` L1492 (`Name [CODE]`, code muted `.text3`/10px). **The `[CODE]` suffix was being dropped.**
- **Status cells: the raw enum `approved` → `Approved`** via legacy's verbatim strings. **The filter dropdown was already Title Case — the page contradicted itself.**
- **`print-spo.ts`: added Payment Terms + Status meta cells** — legacy emits both; ours emitted neither.

**🟢 ISSUE-104 CLEAN — the no-match path traced, not assumed:** `new.tsx` uses **`SearchableSelect`** (not the confirmed `useVendorsList({limit:200})` → native `<select>` shape) with server-side `search` and `onChange(id) => setVendorId(id ?? '')`. **No match → no `onChange` → the previous id is untouched.** No id-nulling (the NC-form defect). **Create-only, no edit route → no stored value to rewrite.** `expenseHead` also clean: the column is `text` (wider than the 9-head list), **all 9 are writable**, legacy uses the same list, create-only.

**🟢 PREDICTIVE ISSUE-152 REFUSAL — the 6th:** **legacy's qty input is `min="1"` with NO `step`** → browser `step=1` → **rejects 2.5 hours of labour.** `service_po_lines.qty` is **`numeric(12,2)`** and the Zod is `nonnegative()`. **Kept our `step={0.01}` / `min={0}`.** **Not a parity gap — a legacy defect over a wider column.** *(`gstPct max={28}` matches legacy and is the real GST ceiling though the schema allows `max(99.99)` — left alone.)*

**🟢 `print-spo.ts` VERIFIED HONEST — the third print file to survive scrutiny** (with `print-po.ts` and `print-jwdc.ts`). Its comment *"totals/tax/amount-in-words are display formatting of data the API already returns"* is **true**: `subtotal = spo.subtotal`, `grand = spo.total`, taxRows from `spo.taxAmount` — **no browser math on server-owned figures.**
**And `uom: 'NOS'` (line 96) is FAITHFUL, not ISSUE-158** — verified: **`service_po_lines` has no uom column**, **legacy's `_spoPrint` has no UOM column**, and the shared builder already defaults `l.uom ?? 'NOS'`. **There is no `x` to drop, so no `x || 'default'` was collapsed.** *(Second time a suspected ISSUE-158 turned out faithful — the JW DC's was too. Verify before accusing.)*

**Two more legacy bugs not copied:**
- **Legacy's SGST+CGST / IGST buttons never indicate which is selected** — `_spoBtnSC`/`_spoBtnI` get ids but **nothing ever styles them**; `_spoCalc` doesn't touch them. **Ours highlights the active one. Kept ours.**
- **Legacy always renders the line `×` button**, splicing to zero then re-seeding an empty line on re-render; ours hides it at one line. **Equivalent net effect**; changing it means rewriting `removeLine` (rule 7).

**`_spoApprove` L27667 — read, not rewired, and neither refused nor wired:** our detail's Approve gates on `role === 'admin'` and hits the existing `useApproveServicePo`; **the service enforces pending-only and stamps `approved_by`/`approved_at`** — which **matches legacy's `isAdmin()` gate**. **Nothing to do.** *(Contrast ISSUE-216: PR's approve doesn't exist at all. Service PO's does, and works.)*

**Reported, not built:** **the list has NO actions column** — legacy L27653 has **10 columns; ours has 9**. 🖨 Print / ✅ Approve / ✏ Edit / 🗑 Del are all absent. **Print/Approve/Delete are one hop away on the detail; Edit exists NOWHERE in our app** (no edit route). Wiring mutations into the list is beyond markup (rule 7). **`colSpan={9}` is correct for our real 9.**

**`.rpt-total` — confirmed absent from BOTH `innovic-theme.css` and `tokens.css` (0 hits).** Legacy uses it on the total row. **Inert; not used, no CSS added.** *(Fourth page to check and correctly decline it.)*

**Stat card "Total Value (page)" sums only the current page** while legacy sums all SPOs — **a page-boundary divergence, but already honestly LABELLED.** Left as-is. *(The ISSUE-095 discipline: a cap that says it's a cap is not the defect.)*

## ISSUE-226 — ISSUE-065 mech 1 on PO-from-PR (inlined, as pre-diagnosed)

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P2
- **Status:** [ ] open

`from-pr.tsx:45` — `poDate: new Date().toISOString().slice(0,10)`, an **INLINED expression** (not a named helper) → **yesterday before 05:30 IST**. Legacy's `today()` L1485-87 is local-based and **correct**. **`po_date` is `date()` → mech 4 safe.** Reported, not fixed.

*(The PO-form agent pre-diagnosed this file from the outside and was right — a rare case where second-hand intel held. It was still verified before acting.)*

## ISSUE-227 — PO-from-PR: the vendor cannot be changed at conversion, and legacy writes it back

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P2 — needs schema + API
- **Status:** [ ] open

**Legacy L6770-72 renders `Vendor ★ (change if needed)` as a datalist — and its save WRITES BACK `thisPR.vendorCode` / `thisPR.vendorName` when changed.** So converting a PR can *correct* the vendor.

**Our header schema has no `vendorId`; `service.ts:802` hardcodes `vendorId: pr.vendorId`.** The vendor chosen at PR time is final.

## ISSUE-228 — PO-from-PR: multi-line clubbing absent (legacy allows it even from the SINGLE-PR entry)

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P2
- **Status:** [ ] open

**Legacy's single-PR entry point still offers `+ Add PR Line`** (L6779 / `_prPoAddLine` L6661) — you can start from one PR and club more onto the same PO. **Ours is one PR, one line, fixed.**

*(Note this is distinct from `_prCreateClubPO` L6323, the list's multi-select batch action, which requires ≥2 PRs and maps to `outsource-jobs`, not here.)*

## ISSUE-229 — PO-from-PR: per-line editing absent

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P2
- **Status:** [ ] open

Legacy's `_prPoLineRowHtml` L6609 allows **qty (≤ the PR max), rate, due date and per-line remarks** to be edited at conversion. **Our service copies `qty: pr.qty`, `rate: pr.estCost`, `lineRemarks: null`** — none are adjustable.

*(One upside, noted under ISSUE-162: because qty is never client-supplied, legacy's per-line `qty ≤ PR qty` cap is satisfied **by construction**.)*

## ISSUE-230 — PO-from-PR: the totals preview is absent

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P3
- **Status:** [ ] open

`_prPoUpdateTotal` L6688 renders **subtotal / SGST / CGST / IGST / Grand Total + a line-count·qty banner**. Ours renders none.

**Correctly reported as missing rather than invented** — and note the agent **did not add browser money math** to fill it. *(The preview-of-unsaved-input exception would arguably apply here, but the right move was still to report rather than build a totals engine in a markup pass.)*

## ISSUE-231 — 🔴 PO-from-PR hardcodes `poType: 'job_work'`, so MATERIAL PRs silently become job-work POs

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** **P2** — a silent wrong write, on every material PR conversion
- **Status:** [ ] open — business mapping, correctly not fixed in a markup pass

**Legacy computes it** (L6736-37):
```js
isJW = pr.jcNo && pr.opSeq   →  'Job Work'  :  'With Material'
```
**Ours defaults `poType` unconditionally to `'job_work'`.**

**The signal EXISTS on our PR and is simply unused** — `sourceJcOpId`, and `prType='jw_osp'`.

**So every PR that is NOT job-work is converted into a `job_work` PO.** And that is not cosmetic — **`po_type` is the exact column behind ISSUE-124** (SO Costing double-bills because `po.po_type <> 'job_work'` admits `outsource`/`service`) **and ISSUE-161** (the PO detail offers `outsource` POs a "Receive GRN" button and no DC).

**This one WRITES the wrong value**, where 124/161 merely *read* a widened enum badly. **The four-value-vocabulary problem now spans read, UI, and write.** *(Add it to the enum-wide audit: `job_work` / `'Job Work'` across api + web.)*

## ISSUE-232 — PO-from-PR: tax defaults diverge from legacy, and it affects money

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P3
- **Status:** [ ] open — reported, not changed

**Legacy defaults `taxType='sgst_cgst'` with SGST 9 / CGST 9 (IGST 18).** **Ours defaults `''` with 0/0/0.**

**A money-affecting default** — a converted PO carries no tax unless someone notices. **Correctly reported rather than changed:** altering a default changes what gets written (the same call made on the Machines form's Capacity/Shift default).

## ISSUE-233 — PR-derived POs skip PO approval entirely

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P2 — an approval gate bypassed by a whole entry path
- **Status:** [ ] open — logic

**Legacy shows a readonly Status from `_poInitialStatus()`** (L21589: **`Draft` when approvers are configured, else `Open`**). **`service.ts:804` hardcodes `'open'`**, with the comment *"PRs only convert to open POs (skip draft state)."*

**So a PO created from a PR bypasses the approval workflow that a directly-created PO must pass.** The ISSUE-088/089 family — and a governance hole, since the PR→PO path is the *normal* one.

**The comment states the behaviour honestly** — this is a **decision to re-examine**, not a false claim. *(Worth contrasting with ISSUE-113/143/213, where comments asserted things that were untrue.)*

## ISSUE-234 — The 7th false parity comment: right line, wrong function

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P3
- **Status:** [ ] open

**`purchase-order.ts:182`** claims `createPurchaseOrderFromPrInputSchema` *"Mirrors legacy `addPO()` line 25728"*.

**L25728 IS `addPO()` — verified.** But **`addPO` is the STANDALONE PO form** (the one holding ISSUE-162's 105% over-ordering cap), **not the PR conversion**. The conversion is **`createPOFromPR` L6732**.

**Correct line number, wrong claim — the exact failure mode.** Seventh instance (ISSUE-113 · 136 · 143 · 184 · JW DC's print-trigger · 213's weasel-worded "file is absent" · this).

**🟢 And in the same cluster, a comment that VERIFIED CORRECT:** `purchase-order.ts:204-207` says *"Outsource Jobs page batch action. Mirror of legacy `_ospCreatePO` L27131."* — **true, and it sits on the BATCH schema.** *(So the docblocks aren't uniformly bad; the one that was checked was right. Verify each.)*

## ISSUE-235 — PO-from-PR: JC/SO context chips absent

- **Surfaced:** 2026-07-16 (REFACTOR-1, PO-from-PR)
- **Severity:** P3
- **Status:** [ ] open

Legacy L6757-58 shows **JC and SO context chips** on the conversion screen. **Our PR payload carries only `sourceJcOpId` / `sourceSoLineId` uuids — no display text**, so there is nothing to render. *(ISSUE-156's shape: the list and detail shapes disagree about what a PR is.)*

### PO-from-PR — mapping verdict (registry error #27), and MY PREMISE WAS WRONG (correction #12)

**Verdict: `createPOFromPR(prId)` L6732.**

**🔴 I BRIEFED THE WRONG SCHEMA.** I wrote: *"our hook is `useCreatePurchaseOrderFromPr` and the schema is named `…FromPrBatch…`, which points at the club flow."* **That conflates TWO SIBLING SYMBOLS:**

| Symbol | Endpoint | Schema | Consumer |
| --- | --- | --- | --- |
| **`useCreatePurchaseOrderFromPr`** (api.ts:93) | `POST /purchase-orders/from-pr` (routes.ts:38-39) | `createPurchaseOrderFromPr**Input**Schema` — **`prId: uuid`, SINGULAR** | **this page** |
| `useCreatePurchaseOrderFromPr**Batch**` (api.ts:143) | `POST /purchase-orders/from-pr-batch` (routes.ts:46-47) | `…FromPrBatchInputSchema` — `prIds: array().min(1).max(50)` | **`outsource-jobs/routes/list.tsx:23,69`** |

**The page imports `CreatePurchaseOrderFromPrInput` (singular), and its route param is `z.object({ prId: z.string().uuid() })` — ONE PR, from the URL.**

**All three candidates ruled on with evidence:**
- **`_prCreateClubPO` L6323 — RULED OUT.** Reads `.prChk:checked` off the **PR list** and **hard-requires `selectedIds.length < 2 → toast('Select at least 2…')`**. A list batch action. **This route has no list and cannot express 2 PRs.**
- **`_ospCreatePO` L27131 — RULED OUT for this page; the second-hand intel is TRUE BUT ABOUT THE SIBLING.** It reads `.ospChk:checked` (the **Outsource Jobs** page), and **`purchase-order.ts:204-207` says verbatim: *"Outsource Jobs page batch action. Mirror of legacy `_ospCreatePO` L27131."*** That docblock sits on the **batch** schema, which this file doesn't use. **The PO-form agent's hypothesis checks out — for `outsource-jobs/routes/list.tsx`, not here.**
- **`createPOFromPR(prId)` L6732 — VERDICT.** Signature takes a **single `prId`**, exactly matching the route's `?prId=<uuid>` and the `{prId, header}` payload. Its save handler stamps that one PR (`thisPR.status='PO Created'; thisPR.poNo=_poNo`), **mirroring `service.createPurchaseOrderFromPr`**.

*(My error: I recalled a schema name and never checked that there are two hooks. Same root as the other eleven — asserting from a plausible fragment instead of tracing. The agent read `api.ts` and `routes.ts` and settled it in one pass.)*

**FOOTER derived from the call site, not the name:** **L6805 passes an EXPLICIT `saveLabel` `'Create PO'`**, and **L28043-44 renders `class="btn btn-success"` + `&#10003; ${_saveLabel}`** → **`✓ Create PO` on `.btn-success`** (ours had `btn-primary`/"Create PO"). Cancel `btn-ghost` already matched.

**Real work:** labels → legacy (`Date`→**`PO Date`**, `Type`→**`PO Type`**, `Remarks`→**`PO Remarks`**); header code inline `color/fontSize/fontWeight` → **`td-code cyan fw-700`**; `Pair` value's inline `fontWeight:600` (**`.fw-600` confirmed absent**) → **`fw-700`** (legacy uses `<b>`); the info strip's inline style aligned to legacy's own (`1px solid var(--border)` / `padding:10px 14px` / `mb:14`).

**🟢 CHECKS THAT CAME BACK CLEAN — no accusation made:**
- **ISSUE-104 does not bite.** **There is no vendor picker** (vendor is server-derived) → the `useVendorsList({limit:200})` native-select risk is **absent**. **`poType`'s select is a COMPLETE `z.enum(PO_TYPES)` → it contains every storable value → immune.** `taxType` is a narrow list over a free-string column, but the page is **create-only** → **a parity gap, not data loss.**
- **Trap 1 verified FAITHFUL, not guilty:** `service.ts:811-813` — `remarks: input.header.remarks ?? (pr.operation ? \`From PR ${pr.code} — ${pr.operation}\` : \`From PR ${pr.code}\`)` **preserves legacy L6836's `_poRemarks||'From PR '+pl.prNo+…` exactly — the `x` was KEPT, not dropped.** No hardcoded `uom`/`paymentTerms` constants here.
- **ISSUE-162 not applicable** — **`createPOFromPR` has NO 105% SO cap**; only a per-line `qty ≤ PR qty`, **which our port satisfies by construction** (qty is never client-supplied).

**Deliberately NOT copied:**
- **`_prPoTaxToggle` L6719 — refused, same reasoning as the PO form** (the 5th predictive ISSUE-104 refusal): it can only write `sgst_cgst|igst`, but **our `taxType` is a nullable free string ≤32 and the select must keep `None`/`''`** — porting the 2-button toggle would make **`none`/`null` unreachable.**
- **pct `min="0" max="50" step="0.5"` not ported** — `step="0.5"` rejects a valid **9.25** (ISSUE-152 class); `max="50"` narrows vs `nonnegative().max(99.99)`.
- **🔴 `inrFormat` deliberately NOT applied — and this is the right call for a subtle reason:** **legacy itself uses `'₹'+amt.toFixed(2)` (L6690, L6712) with NO en-IN grouping.** Switching would **diverge from legacy**. *(Contrast SO Costing, where legacy's own two screens disagreed and consistency won. Here legacy is consistent — so follow it. The rule is "match legacy when it's coherent; choose consistency only when it isn't.")*
- **`★` mirroring:** legacy stars **Vendor** (L6770) and **Qty** (L6646) — **neither field exists on our page.** Kept `★` on PO No. and PO Date **because our schema genuinely requires them** (`code: min(1)`, `poDate` non-optional) — the sanctioned inverse. **No `★` on any schema-optional field.**
- **Readonly auto PO No. (`_nextPONo`) not ported** — no numbering endpoint exists; our schema requires a caller-supplied `code`. *(Same gap as ISSUE-222's SPO No. — `DOC_NUMBER_TYPES` does register `purchase_order`, so this one is wireable.)*

## ISSUE-236 — 🔴 SO QC Status caps its selector at 20 — while the UNCAPPED endpoint we already built sits DEAD

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO QC Status)
- **Severity:** **P2** — SOs 21+ are unreachable on the page
- **Status:** [ ] open — a hook swap (rule 7)

The SO selector calls **`useSalesOrdersList({ limit: 20 })`**.

**But `apps/api/src/modules/so-qc-status/service.ts:61-75` `listSoForQc` returns EVERY non-cancelled SO, `ORDER BY so_date DESC`, with NO LIMIT** — **an exact match for legacy L18348.**

**So `useSoForQc` in `api.ts` AND the `GET /so-qc-status` route are DEAD CODE.**

**🟢 This needs NO "Showing latest N of M" disclosure.** ISSUE-095's honest fix is a truncation notice *when a cap is real*. **Here the cap is gratuitous — the honest fix is to call the endpoint that already exists.** *(A useful distinction: not every capped list wants a disclosure. Some want the cap removed.)*

**A new sub-shape worth naming: the port built the right endpoint and then didn't wire it.** Adjacent to "fetched but never rendered" (17+ pages) — but here it's an entire **route + hook + service function** that nothing calls.

## ISSUE-237 — SO QC Status: the Docs sub-table's "Action" column is unbuildable

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO QC Status)
- **Severity:** P3
- **Status:** [ ] open

Legacy **L18579** has **5 columns** (…, Status, **Action**) and links `d.url`. Ours has 4. **`soQcDocDetailSchema` carries no path/url field**, so the column would be **permanently empty**.

**Not approximated** — needs the doc download path on the API first. **The old header comment deferred only the GRN/TPI links and silently omitted this; the agent corrected the comment.** *(An 8th false-ish parity note — this one by omission rather than assertion.)*

## ISSUE-238 — `listSoForQc` never selects `due_date`, so the selector's `| Due:` will silently vanish the moment ISSUE-236 is fixed

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO QC Status)
- **Severity:** P3 — **latent, and it lands exactly when 236 is fixed**
- **Status:** [ ] open

The SELECT (`service.ts:65-66`) **omits `due_date`**, but **`toSelector` reads `r['dueDate']` → always `null`**, while **`soQcSelectorSchema` advertises it.**

**Currently unreachable** (the hook is dead — ISSUE-236). **But it lands the moment someone wires the endpoint** — the header's `| Due:` would silently disappear, and the "fix" would look like it broke the page. **Fix 238 and 236 together.**

## ISSUE-239 — SO Cycle Time: `averages` is fetched and rendered nowhere (correctly)

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Cycle Time)
- **Severity:** P3
- **Status:** [ ] open — no change proposed

`SoCycleTimeResponse.averages` is never rendered. **The page takes a client-side mean over the FILTERED set — which is exactly what legacy does (L18199-18204)** — and **the filter is client-side, so the server's full-set average would not match the table.**

**Judged acceptable and left:** the mean is over **server-owned durations across the complete on-screen array** — the Assembly precedent (*counting/averaging what the server already computed is not re-deriving a business figure*). **Resolving the dead field needs a server filter param** — an API change.

## ISSUE-240 — 🔴 `so-phase-data.ts`: a timestamptz meets `String()` and `diffDays` returns −9102 days. PROVEN.

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Cycle Time — **flagged as "needs verification", then verified by the orchestrator**)
- **Severity:** **P2** — a wrong number, not a null
- **Status:** [ ] open — server-side

**The chain, every link confirmed:**

| # | Fact | Evidence |
| --- | --- | --- |
| 1 | `bom_linked` and `plan_created` select **`b.created_at` / `p.created_at`** raw in subqueries, **no `::text` cast** | `so-phase-data.ts:114, 118` |
| 2 | Both are **`timestamp(..., { withTimezone: true })`** = **timestamptz**, OID 1184 | `schema.ts:125, 168` |
| 3 | postgres.js parses 1184 with **`parse: x => new Date(x)`** → **a `Date` object** | `postgres@3.4.9/src/types.js:28-32` |
| 4 | **`toStr`** does `typeof v === 'string' ? v : **String(v)**` | `so-phase-data.ts:83-84` |
| 5 | **`diffDays`** does **`new Date(a.substring(0, 10))`** | `so-phase-data.ts:34` |

**The agent predicted `NaN` → a silent null. The reality is worse — and luckier — than that:**

```
String(Date)          -> "Thu Apr 30 2026 02:00:00 GMT+0530 (India Standard Time)"
.substring(0,10)      -> "Thu Apr 30"          ← THE YEAR IS DROPPED
new Date("Thu Apr 30")-> Mon Apr 30 2001       ← JS defaults the year to 2001. NOT NaN.

diffDays('2026-04-01', <that>)  =  -9102 days
correct answer                  =      28 days
```

**🔴 And the part that makes it hard to catch:**
- **MIXED phases** (a `date` column vs a timestamptz) → **catastrophically wrong** (~−9102).
- **BOTH-timestamptz durations** → **accidentally CORRECT** — both get mangled to 2001, so the difference survives — **unless they straddle a year boundary, where it is off by 365.**

**A bug that is right by coincidence is the hardest kind to see.**

**Blast radius is small today** — `designToPlan`/`planToJc` are **rendered nowhere**, and the exported `BOM Linked` / `Plan Created` cells. **But it is live in the export.**

**Fix:** cast in SQL — **`b.created_at::text`**. `so.updated_at::date::text` (L144) **is already correctly cast**, which shows the pattern was known and applied unevenly.

**🔴 THE THIRD DEFECT FROM ONE ROOT.** All three are postgres.js's `parse: x => new Date(x)` meeting code that assumes a string:
1. **ISSUE-142** — `Date.prototype.localeCompare` doesn't exist → **`/so-timeline` 500s** for essentially every SO.
2. **ISSUE-212** — `dateLike()`'s `toISOString()` on a **date-only** value → **SAFE** (ECMA-262 parses date-only forms as UTC). *Two agents flagged it; it is not a bug.*
3. **This** — `String(Date).substring(0,10)` drops the year → **a wrong number.**
> **The generalisation: every raw `tx.execute` / subquery result that is NOT `::text`-cast hands a `Date` to code typed as `string`. The `as unknown as` casts make the compiler agree. Audit them as one class — the outcome ranges from harmless to a 500 to a silently wrong figure, and the type system cannot tell you which.**

**Verified safe on the same page, not assumed:** `so_date` / `dispatch_date` / `invoice_date` are **`date`** columns → mech 4 safe.

### SO QC Status — mapping confirmed, and a Trap-1 fix

**`soqcstatus: ()=>renderSOQCStatus()` at L2402** (**I said ~L2387 — the agent corrected the line**) → **`renderSOQCStatus()` L18347**. Sidebar L486. **The registry was correct** — rare, and verified rather than assumed.

**🔴 Trap 1 fixed — a constant wearing a measurement's costume:** the header rendered a **hardcoded `badge b-blue`**. Legacy maps **Open→`b-cyan`, Closed→`b-green`, Cancelled→`b-red`**. Now uses the existing **`<SoStatusBadge>`** (convention UI-002). **And the agent checked the fallback:** legacy's `||'b-grey'` is **unreachable here** because `status` is the **`soStatusEnum` DB enum**, so the map is **total** — **no fallback was dropped.** *(Exactly the `x || 'default'` discipline, applied in reverse: confirm the default is dead before omitting it.)*

**Also fixed:** the empty state → legacy's exact two lines + the real `.empty-icon`; **an invented `panel-hdr` ("Per-line QC Status / N lines") removed** — legacy goes straight `panel > tbl-wrap > table`, **and the count survives in the TOTAL row** (relocated, not deleted); the 💡 hint moved outside the panel per legacy.

**🟢 `var(--teal, #0d9488)` — VERIFIED FAITHFUL, not guilty.** **Legacy L18578 writes the same fallback.** **ISSUE-195 does not apply here.** *(I flagged `var(--teal, …)` as an invention; on this page legacy does it too. Verify before accusing — third time.)*

**Dead payload (reported, not surfaced):** `overall`, `jcCount`, `qcAccepted/Rejected/Pending`, `tpiAccepted/Rejected`, `grnReceived/Accepted/Rejected` are computed server-side and rendered nowhere — **but legacy doesn't render them either**, so this is **dead weight, not a missing feature.**

### SO Cycle Time — mapping confirmed, and the durations are CLEAN

**`socycletime: ()=>renderSOCycleTime()` L2453** → **`renderSOCycleTime()` L18176**. Sidebar L540.

**🟢 THE CYCLE-TIME QUESTION — the server owns every duration.** `computeDurations` in `apps/api/src/lib/so-phase-data.ts` is a **faithful port of legacy L17980** (`diffDays` and all), served via `so-cycle-time/service.ts`. **The page only renders `r.durations.*` — nothing is re-derived in the browser.** And **`loadSoPhaseData` has no LIMIT** → **ISSUE-095 does not apply; no disclosure added.** *(The sharpest possible test of the money/derivation rule, and it passed.)*

**Real work:** `section-hdr` `marginBottom:0` (L18208) · placeholder → `🔍 Search...`, minWidth 160 (L18210) · `innovic-input`→**`innovic-select`** on the `<select>` · avg cards 9/20px → **10/22px** (L18223) · dispatched row tint `0.04` → **`0.02`** (L18239) · filter label `Equipment` → **`Equipment Only`** (L18215).

**🟢 `lib/export.ts` VERIFIED, NOT GUILTY — the 4th export/print file to survive scrutiny.** **L18260 IS `_sctExport`**; it **IS** one sheet named `SO Cycle Time` (L18281); **our 27 columns match legacy's, in order.** **Unlike its sibling `so-status/lib/export.ts` (ISSUE-136), every claim holds.** **And it PROJECTS server rows rather than re-deriving** — legacy's version recomputes `_soPhaseData` over the in-memory `db`, **exactly the pattern refused for `_soCostExport`.**
**Three undisclosed divergences documented IN-FILE rather than silently changed:** export scope is **filtered** (legacy exports **all**); dates are **raw ISO** (legacy wraps in `fmt()`); **`stamp()` uses `toISOString()` = ISSUE-065 mech 1** where legacy uses local `today()` — **filename only, no figure affected.**

**🔴 TWO LEGACY BUGS NOT COPIED:**
- **Duration colours:** legacy L18237 is `v>10?amber:v>20?red:text` — **left-to-right, so `red` is UNREACHABLE DEAD CODE**, and **legacy's own hint ("Red = over 20d") describes behaviour its code never delivers.** Ours checks `>20` first and renders red as intended. **Reverting would re-introduce the bug.** *(Legacy's hint is itself a trap-1 instance — inside legacy.)*
- **Status cell:** legacy shows a binary `Done`/`Active`; **ours shows `Done` or the REAL SO status.** Reverting would **hide `cancelled`/`draft` from 15-20 live users.**

**Reported, not fixed:** the **SO cell target**. Legacy navigates to `sotimeline` and preselects via `setTimeout`. **Our `so-timeline` route (`modules/so-timeline/routes/index.tsx:14-22`) has NO search param** — it selects via local `useState`, **so a deep link cannot preselect.** Ours links to `/sales-orders/$id`. **Kept.**
**`Job Work Only` (L18216) has NO equivalent** — `SO_TYPES` is `component_manufacturing | equipment | with_material`. **Not invented.**

## ISSUE-241 — 🔴 `<th className="td-right">` is inert — and where LEGACY uses an inline style, that is a REAL divergence

- **Surfaced:** 2026-07-16 (REFACTOR-1, Pending SO Value)
- **Severity:** P3 — but **37 sites app-wide**
- **Status:** [ ] open — **needs a case-by-case sweep, NOT a blanket fix**

**On Pending SO Value, six money headers were rendering LEFT while legacy renders them RIGHT.**

**The cascade:** `.innovic-table th { text-align: left }` (0,1,1) **out-specifies** `.td-right` (0,1,0). So **`<th className="td-right">` does nothing.**

**🔴 THIS REFINES THE SETTLED RULE RATHER THAN CONTRADICTING IT.** The skill says `th.td-ctr`/`td-right` are *"inert in BOTH systems → don't fix"*. **That is true only when legacy ALSO uses a class.** The distinction:

| Legacy writes | In legacy | In ours | Verdict |
| --- | --- | --- | --- |
| `<th class="td-right">` | **inert** (`.panel table th` 0,1,2 beats `.td-right` 0,1,0) | inert | **PARITY — do not touch** |
| **`<th style="text-align:right">`** | **APPLIES** (inline beats everything) | **inert** | **🔴 A REAL DIVERGENCE — mirror legacy's inline style** |

**Pending SO Value is the second case.** *(The skill already said `<th style={{textAlign}}>` does apply and must be mirrored — the agent applied it correctly. What is new is that a plain `className="td-right"` can be hiding a legacy inline style.)*

**Scope, measured:** **37 `<th className="td-right">`** and **183 `<th className="td-ctr">`** sites in `apps/web/src`.

**The sweep is case-by-case: for each site, check what legacy writes at THAT header.** A blanket conversion would **manufacture divergences** on the 183 `td-ctr` sites, which are correctly inert. **Do not automate this.**

## ISSUE-242 — 🔴 A ported totals row loses its highlight to our zebra rule

- **Surfaced:** 2026-07-16 (REFACTOR-1, Pending SO Value)
- **Severity:** P3 — app-wide wherever a totals row was ported
- **Status:** [ ] open

**`.innovic-table tbody tr:nth-child(even) td` paints CELLS over any `<tr>` background** — so a ported **`<tr style="background:var(--bg4)">` totals row VANISHES on even indices.** **Legacy has no `nth-child` zebra rule**, so its totals row always shows.

**Fixed here by moving the background to the cells.** **Any ported totals row using a `<tr>` background has this.**

**A useful general shape:** *our theme adds rules legacy didn't have, and a faithfully-ported inline style can lose to one.* The inverse of the `.stat-card.blue` trap (where legacy referenced a rule that didn't exist). **Both are "the cascade differs", not "the markup differs".**

## ISSUE-243 — ISSUE-065 mech 1 on Pending SO Value — client AND server, and it drives `overdue`

- **Surfaced:** 2026-07-16 (REFACTOR-1, Pending SO Value)
- **Severity:** P2
- **Status:** [ ] open

`new Date().toISOString().slice(0,10)` as "today" at **`list.tsx:265` AND `service.ts:134`**. **In IST 00:00–05:29 this yields YESTERDAY, so the `overdue` flag mis-fires for 5.5 hours daily.** Legacy's `today()` L1485-87 uses local parts and is **correct**.

**Both sides carry the same defect** — so the client mirrors the server rather than contradicting it. *(Small mercy: they agree. ISSUE-128/148 are the same mechanism server-side, where a shared figure is poisoned for everyone at once.)*

## ISSUE-244 — Pending SO Value / SO Docs render raw ISO dates

- **Surfaced:** 2026-07-16 (REFACTOR-1)
- **Severity:** P3
- **Status:** [ ] open — closes with ISSUE-040

Renders `2026-07-15`; legacy `fmt()` → **`15 Jul 26`**. **Not fixed, and the reason is now precise:** **no shared helper produces that format** — `fmtDate` in `lib/print/doc-print.ts` is **`dd-MM-yyyy`**, a *third* format. **ISSUE-040 forbids a 13th local `fmt()`.**

> **The blocker is now specific: we need ONE shared en-IN short-date helper (`15 Jul 26`) + the IST fix, together.** Every page that has hit this — Invoices, JW, NC, GRN, Assembly, PR, Issue Register, SO Status, JC Status, and these two — is waiting on the same helper. **It is the single highest-leverage fix on the display side.**

## ISSUE-245 — 🔴 SO Docs' ARCHIVED is a constant: nothing in the API ever writes it

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Documents)
- **Severity:** **P2** — ISSUE-127's shape, exactly
- **Status:** [ ] open

**`'archived'` appears ONLY at the two READ sites** in `so-documents/service.ts:62, 206`. **Nothing in the entire API ever writes it** — **`createSoDocument` hardcodes `status:'active'`.**

**So the amber ARCHIVED card and the Archived column are STRUCTURALLY ALWAYS 0.**

Legacy produced them via **`_sdArchiveSO`**; **our port never got archive/restore.**

**The ISSUE-127 family, now at four:** `issuedQty: 0` (SO Overview) · `{hold:false}` (SO Overview drill) · `uom:'NOS'` (printed PO) · **this**. **A UI element whose shape is honest and whose input is a constant.**

**And the agent correctly refused to port legacy's Archived Files panel (L19637-42):** it **can never render** (always 0) **AND its text tells users to click "Restore from ZIP", which doesn't exist** — **Trap 1 twice over.**

## ISSUE-246 — SO Docs' status badge was hardcoded `b-grey` (FIXED)

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Documents)
- **Severity:** P3 → **fixed**
- **Status:** [x] fixed 2026-07-16

**Every SO looked identical regardless of state.** Now mapped. *(The same Trap-1 shape the SO QC Status agent fixed this batch — a hardcoded `b-blue` header badge. Two hardcoded badges in one batch.)*

### Pending SO Value — mapping confirmed, and the money concern was UNFOUNDED (checked, not assumed)

**`renderPendingSOValue()` L19272**, router key `pendingsovalue` L2451. **The registry is right this time** — verified.

**🟢 THE MONEY CONCERN I RAISED IS UNFOUNDED — and the agent checked the payload, not the comment.** **`service.ts` computes every figure in SQL and `sumTotals()` runs SERVER-SIDE (L181-205)**; `api.ts` returns them as strings; **the page only FORMATS them.** The two client-side computations are **`pct(a,b)`** — a **display ratio of two server totals, exactly as legacy L19320** — and the **`overdue` flag. No money is re-derived. The SO Costing / SC Dashboard shape is not present.**
*(I briefed legacy's L19303/L19317 browser rollups as the hazard. The right answer was to check what OUR service returns — which is what happened.)*

**🟢 ISSUE-095/043 CLEAN:** the query has **no LIMIT** and there is **NO separate count query** — **filtering is one pass over the full set.** Nothing capped, nothing to disclose, **nothing added** (ISSUE-174).

**Real work:** the header was wrapped in an **invented flex bar**; filter gap 6→**5** and **an invented border dropped**; card grid 150px→**140px**; literal uppercase labels (dropped `textTransform`); **`var(--teal, #0d9488)` ×3 restored** where ours had a bare `#14b8a6`; search `min-width:220`; **an invented "X of Y SOs" counter removed** (no legacy counterpart); badge map fixed (**open→blue/cancelled→grey** → legacy's **Open→cyan/Cancelled→red**).

**Deliberately not copied:** legacy's tip *"Click any SO row to see line-level breakdown"* — **Trap 1: the modal (`_psvDetail` L19382) is absent.** **`maximumFractionDigits:0` kept over the shared `inrFormat` (2dp)** because **legacy's PSV list AND detail are both 0dp — internally coherent, so parity wins.** *(The PO-from-PR precedent: match legacy when it's consistent; choose consistency only when it contradicts itself, as SO Costing did.)* **`.rpt-total` not used** (absent, inert) — **5th page to check and decline it.**

**Missing, reported:** **Export to Excel** (`_psvExportExcel` L19430, **2 sheets**) and the **line-level breakdown modal** (`_psvDetail` L19382) — **both need per-line data the API doesn't return.**

### SO Documents — mapping confirmed, and MY `_viewQCReport` STEER WAS THE TRAP

**`renderSODocs()` L19478**, key `sodocs` L2450.

**🔴 I pointed the agent at `_viewQCReport` L23860 and the existing `QcReportLink` as a possible fit. It is the trap, and the agent caught it:**
> **`_viewQCReport` is GRN-scoped** — `_viewQCReport(grnId)` → `grn.qcReportData`. **Legacy's SO Docs never calls it; it uses `_sdViewFile(f.id)`.** `QcReportLink`'s existing homes (`incoming-qc:337`, `tpi:255`) **are the honest ones.** **No change made.**
*(Correction #13 in effect — I suggested a component transplant on a hunch. "Is this page the honest home for them?" was the right question; the answer was no.)*

**Real work:** the selector's `(N files)` now **registry-only** — matching **legacy AND our own TOTAL FILES card**; `-- Select SO --`; `min-width:280`; **the status badge un-hardcoded** from `b-grey` (ISSUE-246); `📦 N archived`; stat cards 24/18/24 + STATUS as a badge; line header always KB; **file-row zebra restored**.

**🟢 Verified faithful, NOT fabricated:** **`fileSize: null` on QC files** — **`qc_documents` genuinely has NO `file_size` column** (schema.ts:4433-4458). **Not a Trap-1 case.** *(Fourth suspected constant that turned out honest. Verify before accusing.)*
**🟢 ISSUE-100 correctly clean:** **no "max 5MB" label anywhere, and none added** — `uploadFile()` enforces no size. **The `accept` list is all that's real.**
**🟢 ISSUE-095/043 clean** — **no LIMIT, no count query on either endpoint.**

**Kept though legacy lacks them** (never delete a working feature): the **QC Docs column + card** (real `qc_documents` data; **legacy's 7-col table has no equivalent — so `colSpan={8}` is OUR real count, not legacy's 7**) and the merged **"⬇ View"** button vs legacy's separate ⬇/👁.

**Missing, reported:** **Download All (ZIP)** `_sdDownloadZip`, **Archive & Purge** `_sdArchiveSO`, **Restore from ZIP** `_sdRestoreSO` (L19541-43) — *these are what ISSUE-245's dead `archived` status is waiting on* — and the **GRN ref in the file meta** (legacy shows `· grnNo`; **`SoDocumentFile` has no field for it**).

## ISSUE-247 — 🔴 MY OWN BRIEF told agents to commit the `.stat-card.blue` mistake for ~30 batches (correction #13)

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning — **the agent refused my directive and proved it wrong**)
- **Severity:** P3 as a bug; **P1 as a process finding**
- **Status:** [x] fixed 2026-07-16 — corrected in the skill's SETTLED section

**Every brief I have written for ~30 batches carried:** *"`.card` — Confirmed ABSENT (→ use `.panel`)"*.

**Verified, all four facts:**

| Check | Result |
| --- | --- |
| `.card` as a **selector in legacy** | **0** — never defined, in either `<style>` block |
| legacy **uses `class="card"`** | **3 times** — an inert artifact |
| `.card` in **our theme** | **0** — absent from ours too |
| **Therefore** | **inert in legacy, inert in ours → IDENTICAL RENDERING → PARITY** |

**And `.panel` would have ADDED** `background: var(--bg2)`, `1px solid var(--border)`, `border-radius: var(--radius2)`, `overflow: hidden`, `margin-bottom: 16px` — **none of which legacy renders.**

> **That is the `.stat-card.blue` mistake exactly — the one *I* made, and the one I have been quoting as a cautionary tale IN THE SAME BRIEF that ordered agents to repeat it.**

**The tell was visible:** there is exactly **one** `className="card"` in the entire web app — consistent with a faithfully-ported inert artifact, not a styling decision.

**The lesson, and it is the general form of ISSUE-027/047:**
> **An absent class is not automatically a bug. "Absent from OUR theme" and "absent from LEGACY" are different facts, and only the pair of them tells you what to do.**
> - absent from ours, **defined** in legacy → **a real gap** (report; don't invent)
> - absent from ours, **absent** in legacy → **PARITY — leave it** ← *`.card`*
> - **present** in ours, absent in legacy → **we invented it** (e.g. `var(--teal,#fallback)`, ISSUE-195)

**Correction #13, and the worst-shaped one:** the other twelve were assertions I hadn't traced. **This one was a rule I stated correctly and then contradicted in the same document.** Fixed in the skill's `SETTLED` section.

## ISSUE-248 — `showModal` takes THREE parameters: every 4th arg is silently discarded

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P3 — but it settles the footer rule's last ambiguity
- **Status:** [x] understood

**`showModal` (L28014) accepts only `(title, body, onSave)`.** So `createPlan` L9432's **`showModal(title, body, onSave, 'Create Plan')` silently discards `'Create Plan'`** — the footer is the hard-coded **`Cancel` / `Save`** (L28026-27).

**This is a SIXTH footer shape, and it explains a class of near-misses:** a call site that *looks* like it passes a save label but doesn't. **`showModalLg` (L28032) is the one that takes `saveLabel`.**

**The complete footer rule, now closed:**
| Call | Footer |
| --- | --- |
| `showModal(t, b, fn)` — **and any 4th arg is DEAD** | **`Cancel` / `Save`** (hard-coded L28026-27) |
| `showModalLg(t, b, fn, 'X')` | **`Cancel` / `✓ X`** on `.btn-success` |
| `showModalLg(t, b, fn)` — no label | the **L28034 fallback derives from the TITLE** (SO→`✓ Save SO`, PO→`✓ Save PO`) |
| …and the title matches **no** branch | the fallback's **own default** → **`✓ Save`** *(branches test UPPERCASE `PO`/`SO`/`WO`/`JW`/`JC`; NC's `❌ Report Non-Conformance` fell through on a lowercase `po`)* |
| `showModalLg(t, b, **null**)` | a **single `Close`** — **and a null `onSave` positively identifies a READ-ONLY detail** |
| some fns **hand-roll** `<div class="modal-footer">` | read it (Route Cards, Service PO) |
**L28044 renders `&#10003; ${_saveLabel}` — the `✓` prefixes even an explicit label.**

## ISSUE-249 — SO Planning: `outsourceCost` could only ever save as `0` (FIXED)

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P2 → **fixed**
- **Status:** [x] fixed 2026-07-16

**`PlanOpInput.outsourceCost` existed, `buildPayload` SENT it (`outsourceCost: o.outsourceCost`), and it was initialised to `0` and rendered NOWHERE** → **`plan_ops.outsource_cost` could only ever save as `0`.**

**A constant wearing the costume of a measurement (the ISSUE-127 family, now at five)** — but with a twist: **the field was fetched, typed, AND transmitted.** Legacy L9578 has the `₹/pc` input. **Restored.**

*(The sharpest variant yet: "fetched but never rendered" is 17+ pages; this was **fetched, typed, sent, and never rendered** — the round trip completed with a hardcoded zero.)*

## ISSUE-250 — SO Planning: `assembly` plans showed NO active tab, and the picker can't represent the type

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P2 (display fixed; the ISSUE-104 risk remains)
- **Status:** [~] display fixed; **the type-clobber is open**

**`PLAN_TYPES` includes `'assembly'`, but the 3-tab picker only offers manufacture / full_outsource / direct_purchase.** Legacy lights **Manufacture for anything non-DP/non-FO** (L9609); **ours compared `planType === 'manufacture'`** → an assembly plan showed **no active tab**. **Fixed.**

**The residual, deliberately untouched (rule 7):** **clicking any tab silently converts an assembly plan's type — the picker cannot represent `assembly`.** **ISSUE-104's shape, on an edit path.**

## ISSUE-251 — `SearchableSelect` renders BLANK for any value outside the loaded page

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P2 — **and it partially revises the "SearchableSelect is immune" finding**
- **Status:** [ ] open — not this module's file

**`searchable-select.tsx` L79-81 only shows `valueLabel` when `value` (the id) is truthy.** All four pickers here bind **`value={xIdByCode(code)}` against a 50-row page** → **`null` for an out-of-page machine/vendor → the field displays EMPTY.**

**🟢 Save is SAFE** — the code lives in separate state, untouched → **preserved.** **So this is a DISPLAY defect, not data loss** — *"but `validate()` passes on a field that looks empty."*

**Affects machine, FO vendor, DP vendor, OSP vendor.**

**This refines ISSUE-154/167/198:** `SearchableSelect` **is** immune to *data loss* (it writes only on explicit user action and falls back to `valueLabel`) — **but only when `value` is populated.** **Bound by a code→id lookup against a paged list, it can still render blank.** The immunity is about **what it writes**, not **what it shows**.

## ISSUE-252 — SO Planning's QC-process `<select>`: a faithful port that MANUFACTURES data loss

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** **P2** — edit-path data loss
- **Status:** [ ] open

**`useQcProcessesList({ limit: 200 })` → a native `<select>` matching `p.code`.** A stored op whose QC process is **inactive, deleted, or beyond row 200** has **no matching option → blank → save writes `''`. On EDIT that is data loss.**

**🔴 And legacy `_selQCProcesses` (L23516) has the SAME shape AND also filters `status==='Active'`** — **so a faithful port manufactures the bug.** *(The predictive-refusal case, arriving as a live defect rather than a near-miss.)*

**Verified faithful, not a defect:** **`p.code` vs legacy's `p.name`** — **the schema comment confirms `code` IS the QC process name.**

## ISSUE-253 — SO Planning: `foMaterialSrc` is a narrow select over a free-text column

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P2
- **Status:** [ ] open

**DB/Zod is `z.string().nullable()` (free text, max 200); the `<select>` offers only `From Stock` / `Purchase New`.** Any other stored value is **silently rewritten on save**. **Legacy is identical** — the cost-center `department`/`type` shape (ISSUE-107) exactly.

## ISSUE-254 — SO Planning: `viewPlanDetail` and the `OSP →` nav have no React counterpart

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P2
- **Status:** [ ] open — rule 7

Legacy's plan-card **`View`** button (on `PR Created` / `JC Created` / `In Production` / `Complete`) → **`viewPlanDetail` L9942**, and the FO **`OSP →`** button → `nav('outsourcejobs')`, are **both absent from our port**. **The destinations exist** (`modules/plans/routes/detail.tsx`, `modules/outsource-jobs`) — **wiring them is new navigation logic.**

**Note for whoever takes `plans/routes/detail.tsx`:** legacy's `viewPlanDetail` is **`showModalLg(…, null)` → a single `Close` footer** — **worth confirming our port didn't turn it into a Cancel/Save pair** — and it renders **`dpCost × planQty`** totals, **which is exactly the re-derives-a-business-figure line to check.**

## ISSUE-255 — SO Planning: doc presets ignore Report Master

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P3
- **Status:** [ ] open

**Legacy sources doc presets from `db.reportTypes` (Active), falling back to the 5 hard-coded defaults ONLY when empty**; `_planAddDoc` also **auto-sets `mandatory` from `rpt.defaultMandatory`**. **Our port hard-codes `DOC_PRESETS_FALLBACK` unconditionally** — and **`modules/report-types` EXISTS.**

**The `x || default` mechanism again (ISSUE-158's family): the port kept the fallback and dropped the source.**

## ISSUE-256 — SO Planning: `⚠ Linked BOM not found` is not representable, and `— already created` was correctly not invented

- **Surfaced:** 2026-07-16 (REFACTOR-1, SO Planning)
- **Severity:** P3 — server-side
- **Status:** [ ] open

- **`⚠ Linked BOM not found`** (legacy L9391, shown when `line.type==='Equipment' && line.bomMasterId` but the BOM master is absent) — **`PlanningLine` exposes only `hasEquipmentBom: boolean`, so the "linked but MISSING" case is not representable.** Not computable in React.
- **`— already created` is a fabricated constant** in our port. **Legacy shows the real assembly-plan `status` + `jcNo`** (L7147); **`PlanningBomResponse` has only `hasAssemblyPlan: boolean`.** **The agent added nothing rather than invent** — and the same for the assembly header's missing ` L{lineNo}` (**no `lineNo` on the response**).

### SO Planning — mapping confirmed, builders traced, and THREE legacy bugs not copied

**`renderSOPlanning()` L9299** (router L2384). **`_planPreSelectLine` is read at L9314**, and **`_soStatusCreateJC` L4565-69 only sets it and calls `nav('planning')`** — **confirming this page is that button's destination**, as briefed.

**🟢 THE BUILDERS — traced per call site, and there are NONE.** All five entry points **inline their body literal** (the QC-Process / GRN shape): `createPlan` L9432 · `editPlan` L9500 (`buildOpsTable()` and `_planBuildDocsTable()` are **delegates for two sub-tables only**) · `showBOMPlanning` L7116 · `showEquipBOMPlanning` L8848 · `viewPlanDetail` L9942. **None hand-rolls its own footer.**
**`badge()` is NOT the renderer here** — `renderSOPlanning` never calls it; **inline ternary colours throughout.** *(Fifth module where `badge()` isn't the renderer.)*

**Real work:** `pr_created` colour `'#8b5cf6'` → **`var(--purple)`** ×2 — **legacy writes `var(--purple,#8b5cf6)` and `--purple` IS defined (`#7c3aed`), so legacy's fallback is DEAD CODE and our port had shipped the dead fallback as the value.** *(The precise inverse of ISSUE-195's `var(--teal,#fallback)`: there the fallback fires because the token is undefined; here it never fires because the token exists.)* Plan status text: **raw enum (`in_planning`) → legacy Title Case**. The no-SO state gained legacy's header row **`Select an SO`**. Zero-lines text → legacy's exact sentence. Save labels → **`Save`** / **`✓ Save Plan`** / **`✓ Create N Plans`** per the call sites. Plan-type tabs: **hard-coded `#22d3ee`/`#22c55e` — DARK-theme hex (ISSUE-067)** → tokens, **which also removed a `${color}1A` string concat that would have become invalid CSS (the ISSUE-063 shape) once tokens were used.** `OUTSOURCE` label: **always amber → amber only when ticked** (L9576). `<Plus/>`/`<Trash2/>` → legacy's literal `+ Add Op` / `×`.

**🔴 THREE LEGACY BUGS NOT COPIED:**
- **`planMfgSection`'s initial-render bug (L9642):** legacy shows the ops table for *anything* non-`direct_purchase`, so **a full_outsource plan renders the Mfg section AND the FO section until a tab is clicked.** Ours is correct.
- **An unclosed `<span>` in `opsInfo` (L9375)** — legacy emits `<span …>(3 ops, 🏭 outsrc)` with **no closing tag.** Ours closes it.
- *(and `showModal`'s dead 4th arg — ISSUE-248)*

**Kept though legacy lacks them:** **`Save Draft`** (legacy's single save always transitions to `Planned`) — only its sibling was relabelled; the **JW badge** in the left pane; **`({customerName})`** in the right-pane header; and our **`In Production (no plan)` / direct-JC** line states.

**Flagged for a decision, deliberately not restored:** **the OSP badge + hidden Machine/Cycle on outsource rows.** Legacy's outsource-checkbox row **keeps the Machine datalist AND the Cycle(h) input visible**; ours replaces the Machine cell with a `🏭 OSP` badge and hides Cycle. **Restoring them would expose the handler's `cycleTimeMin: 0` clobber** — **legacy's checkbox changes ONLY `opType` (L9577)** — and fixing that handler is rule 7. **Left as-is deliberately.**
**Legacy's separate `opType:'OSP'` row is unportable:** **`OP_TYPES = ['process','qc','outsource']` has no `'OSP'`**, so our `+ Add OSP Op` correctly maps to `outsource`.

**Unit smell, flagged not acted on:** the ops header says **`Cycle(h)`** but binds **`cycleTimeMin`**. **The agent deliberately did NOT port legacy's QC-option ` (Nh)` suffix rather than stamp an `h` on a minutes value.** *(The THIRD module with this exact seam — JC form chose `Cycle (min)`, JC status kept `Cycle(h)`, this one declined to spread it. ISSUE-177/204 — one ruling, three modules.)*

**🟢 No ISSUE-095 exposure** — `usePlanningSoList`/`usePlanningSoDetail` take **no limit** and the responses carry **no `total`/cap**. **Clean result, reported as such.**

## ISSUE-257 — ISSUE-065 mech 1 on the DC date default

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** P2
- **Status:** [ ] open

`create.tsx:43` — `new Date().toISOString().slice(0,10)` → **yesterday before 05:30 IST**. Legacy's `today()` L1485-87 is correct.

**Mech 4 verified ABSENT:** `delivery_challans.dc_date` is a **`date`** column (schema.ts:1819) → **storage is safe; only the default is wrong.** Blocked by ISSUE-244/040.

## ISSUE-258 — DC create: a non-null assertion over a nullable vendor → a guaranteed 400

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** P2
- **Status:** [ ] open — logic

`create.tsx:145` — **`vendorId: po.vendorId!`**. But **`purchaseOrderSchema.vendorId` is `.nullable()`** (ADR-015 allows free-text vendors via `vendorCodeText`), while **`createDeliveryChallanInputSchema.header.vendorId` is a required `z.string().uuid()`**.

**So a JW PO with a free-text vendor sends `undefined` → a 400 at the boundary.** The `!` silences the only warning that would have caught it.

*(Same family as ISSUE-142's `as unknown as`: an assertion that tells the compiler to stop looking. The type system knew; it was overruled.)*

## ISSUE-259 — 🔴 DC create writes the PO CODE into the VENDOR CODE field

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** P2 — a wrong value in a real column
- **Status:** [ ] open

`create.tsx:146` — **`vendorCodeText: po.vendorCodeText ?? po.code`**.

**When the vendor code is null, this writes the PURCHASE ORDER's code into the vendor-code field.**

**A new shape for the `x || default` family — the WRONG-FIELD fallback.** The others drop the `x` and keep a constant (ISSUE-127/133/158/245/249); the Issue Register dropped the *default* and kept the `x`. **This one falls back to a DIFFERENT FIELD entirely** — so the data is neither missing nor constant, it is *plausibly wrong*: a real code, in the wrong column.

## ISSUE-260 — 🔴 DC create caps ship qty at the PO line qty, not the PENDING qty — so over-shipping is possible

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** **P2** — material can be sent beyond the order across multiple DCs
- **Status:** [ ] open — needs a server-side aggregate (rule 1)

**Legacy computes `_ospDCSentQtyLine()` L27217 → `pending = poQty − sent`**, then:
- **caps the input at `pending`** (L27330)
- **pre-fills `sendQty = pending`**
- **hides the form entirely** with **`⚠ All qty sent via DCs. No pending.`** (L27311)

**Ours caps at `poLineQty`.** **So multiple DCs against one PO line can exceed the order** — nothing stops the second DC re-sending the full quantity.

**Correctly NOT built:** it is **server-side business logic** and needs a new fetch/aggregate. **And the agent identified the trap that would have made a "fix" wrong:** **`po.lines[].receivedQty` is GRN RECEIPTS, not DC SENDS** — using it would have produced a plausible cap computed from the wrong direction of the flow.

**Legacy's whole guard is missing:** the cap, the pre-fill, **and** the all-sent empty state.

## ISSUE-261 — DC create: Vehicle No., Transporter and header Remarks have no home in the write schema

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** P3
- **Status:** [ ] open

Legacy has **Vehicle No. AND Transporter as separate fields** (L27272-73) plus a **header-level Remarks** (`form-full`, L27274). **`createDeliveryChallanInputSchema.header` has only a single `transport` and no `remarks`.**

**Our merged field kept; no columns invented.** *(Note the contrast with `/customer-dispatches/new` (ISSUE-115), where Transport/Vehicle No. are REAL nullable columns that legacy lacks — so porting legacy there would have DELETED them. Same two fields, opposite direction, in two modules.)*

## ISSUE-262 — DC No. is free-text; legacy auto-generates it readonly

- **Surfaced:** 2026-07-16 (REFACTOR-1, Delivery Challan create)
- **Severity:** P3
- **Status:** [ ] open

`_nextOspDCNo()` L27215 generates **`OSP-DC-00001`** and L27270 renders it **readonly**. **Ours is free-text.** No client-side generator exists and an endpoint may not be added here.

**Kept editable + starred — and the star is truthful:** `z.string().min(1)` genuinely requires it, **even though legacy has no star there** (the sanctioned inverse of trap 1).

**The third module with this exact gap:** **SPO No.** (ISSUE-222 — `DOC_NUMBER_TYPES` never registered `service_po`) and **PO-from-PR's PO No.** *(`DOC_NUMBER_TYPES` DOES register `purchase_order`, so that one is wireable.)* **`DOC_NUMBER_FORMATS`' `prefix + 5 digits` shape matches `OSP-DC-00001` exactly — this is wireable too.**

### DC create — mapping verdict (registry error #28): CATEGORY 1, and MY GREP WAS TOO NARROW (correction #14)

**🔴 THE PORT-ONLY HYPOTHESIS IS DISPROVEN. Legacy HAD this page.**

**I briefed:** *"I found no `_ospDCAdd`/`addDC`/`createDC` — so `/delivery-challans/new` may be CATEGORY 4."*
**The function is named `_ospDCCreateForm()` — L27251.** *(+ `_ospDCFillPO()` L27283, `_ospDCRefreshLines()` L27318, `_ospDCSave()` L27336.)*

**And it was not even hidden:** **`renderOspDC()` L27244 is a two-tab container** (`➕ Create DC` / `📦 Outward Register`), and **`_ospDCTab` defaults to `'create'` (L27214)** — **the create form is legacy's LANDING VIEW for this module.**

**Correction #14. The failure is new in shape but old in kind:** I searched three plausible names, found nothing, and **reported an absence as evidence.** *(The PR/NC/GRN port-only verdicts were sound because they enumerated the row actions **exhaustively** and followed every hop — they didn't rest on a grep. My brief told the agent to do exactly that, and it did, and that is what caught me.)*

**The register that owns this route:** **`_ospDCRegister()` L27419**, reached via `renderOspDC()` L27244, nav key **`ospdc`** (router L2465, sidebar L497, dept `purchase` L2342). **NOT `renderJWDC()` L24434** (`/jw-dc`) and **NOT `renderDispatchRegister()` L10711** (`/customer-dispatches`). **Registry error #1 confirmed corrected.**

**🟢 THE DECISIVE HOP WAS ON THE PO LIST, NOT THE DC LIST:** **L25268** — `if(poType==='Job Work' && overallSt!=='Draft') items.push({label:'Create DC', onclick:"_ospDCFromPO('"+poNo+"')"})` → **`_ospDCFromPO(poNo)` L27233** sets `_ospDCSelectedPO=poNo`, `_ospDCTab='create'`, `nav('ospdc')`. **That is EXACTLY our `?poId=` contract**, and our *"Pick a JW PO first"* branch is **the faithful analogue of legacy's unselected `<select id="fOspDCPO">`.**
*(Markers checked: no `showModal(…,null)` — it's a tab, not a modal, so the footer rule is N/A; nothing early-returns or refuses; not a print decoy — `_ospDCPrint` L27370 is the separate 🖨 action.)*

**🟢 ISSUE-241 APPLIED CORRECTLY, and verified at the exact site:** `<th className="td-right">` → **`<th style={{textAlign:'right'}}>`** — `.innovic-table th{text-align:left}` (theme L359-366, **0,1,1**) **out-specifies `.td-right`** (L398, **0,1,0**) → **inert in ours**, while **legacy L27321 writes the inline form → applies in legacy.**
**And a genuine refinement:** **`<td className="td-right">` was correctly LEFT ALONE** — **`.innovic-table td` (L380) sets no `text-align`, so the class DOES apply there.** *(The inertness is a `<th>`-only problem. That distinction belongs in the rule.)*

**🟢 VERIFIED FAITHFUL, not touched** (checked before accusing — **the fifth and sixth such checks**): **`uom:'NOS'` (line 57)** — **legacy L27355 hard-codes `uom:'NOS'` too**, matching the JW DC / Service PO precedent. **`step="1"`** — **correct**: `purchaseOrderLineSchema.qty` is **`z.number().int()`**, the GRN precedent exactly.

**Real work:** added the missing `section-hdr` **📦 OSP Delivery Challan & Outward** (L27248); **replaced a prose subtitle with legacy's 4-tile PO info grid** (L27301-07: PO NO. / VENDOR / **PROCESS** / LINES); labels → legacy (`DC code`→**DC No.**, `DC date`→**DC Date**, `Transport / vehicle`→**Transporter**, placeholder `DC-NNNNN`→**`OSP-DC-NNNNN`** per `_nextOspDCNo()`); `form-grid-3`→**`form-grid`**; `Ship qty`→**`Send Now ★`**; `Item` split into **Item Code + Name**; save → **`✔ Save DC`** on `.btn-success`.

**Deliberately NOT copied:**
- **The `<select id="fOspDCPO">` (L27267) — a PREDICTIVE ISSUE-104 refusal (the 7th).** A PO picker here would be **a native `<select>` over a filtered list** (legacy L27253 excludes Closed/Cancelled/Draft) — **the exact stacked-exclusion shape that bit the GRN** (`limit:200` **AND** `status ∈ …`). Our `?poId=` contract matches `_ospDCFromPO` anyway.
- **The tab strip** (L27245-47) — our create/register are **separate routes**; the Back link is the analogue.
- **Legacy's inline `font-size:10px;padding:4px 6px` on the lines `<th>`** — **not copied, with a reason worth keeping:** **our `.innovic-table` is the ported equivalent of legacy's `.panel table`** (legacy L347, which *does* reach that bare table), so copying the compact overrides would **fight our table's own rules for no parity gain.** **The inline `text-align` and colours WERE copied — those are the ones that genuinely apply in legacy.**
- **`Cancel` kept** despite legacy's single-button form — **route pages need an exit.**

**🟢 ISSUE-242 checked and CLEAN — with a nice piece of reasoning:** no `<tr>` background was ported, **and our 1-based `nth-child(even)` lands on legacy's 0-based odd `i` → `var(--bg3)` on BOTH sides.** **Coincidental parity; safe.**

**Flagged for whoever owns `lib/print-ospdc.ts` (not this agent's file):** legacy **`_ospDCPrint` L27394-98 renders FIVE template blocks** (`ospdc_header_note` / `_special_notes` / `_terms` / `_footer` / `_signature`, L14448-52), and **`ospdc_terms` carries *"Material is sent on a returnable basis for processing only"*** — **the same returnable-basis legal character as ISSUE-186's JW DC.** **Worth a print-compliance pass.**

## ISSUE-263 — ISSUE-043 live in TWO more modules (party-materials, party-grn) — that is 9

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party Material + Party GRN)
- **Severity:** P2 — server-side
- **Status:** [ ] open

**Both modules, identical shape:**
- **party-materials:** `service.ts:76` builds `searchFrag` and applies it to the rows query; **the count at `service.ts:114-118` applies only `companyId` + `deletedAt`.**
- **party-grn:** the rows apply `searchFrag`/`jwFrag`/`clientFrag`/`fromFrag`/`toFrag`; **the count (`service.ts:~137-141`) applies only `companyId` + `deletedAt`.**

**So search narrows the rows while `total` stays at the full company count → "Showing 1–50 of 412" with Next paging onto EMPTY pages.** The Issue Register's reproduction, twice more.

**The family is now at NINE modules.** The fix is one line per service: **the count must apply the same predicates as the rows.**

## ISSUE-264 — 🔴 `party_materials.issued_qty` has NO writer — and the comment claims it does

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party Material)
- **Severity:** **P2** — a genuine missing cascade, not a fabricated constant
- **Status:** [ ] open

**`party_materials.issued_qty` (schema.ts:2912) is written ONLY at insert** — `issuedQty: 0` (`service.ts:241`). **Every writer in `apps/api/src` and `packages/shared/src` was grepped: nothing increments it, and nothing decrements `stock_qty` on issue.**

**So the amber "Issued" column is structurally always 0.**

**🔴 LEGACY DOES BOTH — and it does them in the DC-creation flow:**
```js
// legacy L26256-57
pm.stockQty  -= dl.qty;
pm.issuedQty += dl.qty;
```

**So this is ISSUE-245's read-sites-only shape, but the diagnosis is different: it is a MISSING FEATURE, not a fabricated constant.** The writer belongs in **`delivery-challans`** — **which another agent owned this batch, so it was correctly not touched.**

**🔴 THE 8th FALSE COMMENT, and the agent caught it by applying ISSUE-113 unprompted:** **`service.ts:7-10` claims *"JW Issue — increments issued and decrements stock"*.** **No such writer exists.** *(Checked the code, not the comment.)*

**⚠️ AND IT CONNECTS TO ISSUE-260 — two agents, two modules, ONE missing cascade.** The DC-create agent found **over-shipping is possible** because ship qty caps at `poLineQty` instead of `pending`. This agent found **the DC flow should also decrement `stock_qty` and increment `issued_qty`.** **Both point at the same unported DC cascade.** *(Neither agent knew about the other's finding.)*

## ISSUE-265 — ISSUE-065 mech 1, SERVER-SIDE: the party-GRN TODAY tile counts yesterday

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party GRN)
- **Severity:** P2
- **Status:** [ ] open

**`party-grn/service.ts:147`** — `const today = new Date().toISOString().slice(0, 10);` feeding **`COUNT(*) FILTER (WHERE pg.grn_date = ${today}::date)`**.

**Before 05:30 IST the TODAY tile counts YESTERDAY's GRNs** — for every user at once. **An inlined expression, not a named helper.**

**The 4th confirmed server-side mech-1 site** (with ISSUE-128's DELAYED tile, ISSUE-148's invoice overdue, ISSUE-243's PSV overdue, and `calc-engine.ts:354`). **Client-side instances mislead one user; server-side ones poison a shared figure.**

## ISSUE-266 — ISSUE-065 mech 1, client-side: the party-GRN modal's date default

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party GRN)
- **Severity:** P2
- **Status:** [ ] open

`list.tsx:273` — `useState(new Date().toISOString().slice(0,10))`. **Inlined expression.** Same yesterday-before-05:30 defect. **Reported, not fixed, even though it is in the agent's own file** — correct: it lands with the shared helper, not piecemeal.

## ISSUE-267 — ISSUE-244's blocker, live on party-grn

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party GRN)
- **Severity:** P3
- **Status:** [ ] open — closes with ISSUE-040

Renders `{g.grnDate}` **raw ISO** (`2026-07-15`); legacy renders `fmt(g.grnDate)` → **`15 Jul 26`**. **No shared helper produces that** (`fmtDate` is `dd-MM-yyyy`, a third format); **ISSUE-040 forbids a 13th local copy.** **Gap reported, not filled.**

## ISSUE-268 — Party GRN: three legacy columns are unrenderable because OUR schema is normalized

- **Surfaced:** 2026-07-16 (REFACTOR-1, Party GRN)
- **Severity:** P3
- **Status:** [ ] open

**Legacy lists 11 columns including `JW Line`, `Material Code`, `Material Name` — because legacy pushes ONE `db.partyGrn` record PER LINE (L24346-56). Its list is one row per LINE.**

**Ours is normalized** (`party_grn` header + `party_grn_lines`) and **`/party-grn` returns HEADER rows only** (`linesCount`, `totalReceivedQty`).

**Rendering those three would need an api.ts/service change — and re-deriving them client-side would breach rule 1.**

**The FOURTH instance of "our normalisation is the migration":** JW (a flat array of lines, **no header entity**) · GRN (a flat one-item record, **no lines entity**) · party-GRN (**one row per line**) · and legacy's SO lines. **Every time, legacy's grain is an artefact of the JSON-blob anti-pattern CLAUDE.md §1/§12 names as the reason for this migration — and every time, parity would mean porting it back in.**

### Party Material + Party GRN — both mappings CORRECT as auto-built (the 27-error streak breaks)

**Party Material:** `renderPartyMaterial()` **L24129**, router **L2410** *(the orchestrator briefed ~L2411 — **the agent corrected it: 2411 is `partygrn`**)*. **Row `onclick`s grepped as instructed:** `editPartyMaterial(id)` L24214 and `delPartyMaterial(id)` L24233 — **both `showModal`/`confirm`; neither is a detail renderer. No decoy.**
**Party GRN:** `renderPartyGRN()` **L24251**, router **L2411**. **Genuinely row-onclick-free** — every `<td>` in the row builder (L24256-67) is plain. `addPartyGRN` L24298 is a `showModalLg`. **No detail hop.**

**🟢 STREAM CHECK PASSED:** stayed on **`party_grn` — `grn_date` at schema.ts:2961**, verified separate from `goods_receipt_notes` at :1513. **The GRN module was not touched.** *(A GRN-detail agent chased `renderPartyGRN`/`addPartyGRN` as a decoy and correctly ruled it out as a different module — this is the other side of that, and both agents got it right.)*

**Real work — Party Material:** the **`.tag` chip had THREE inline overrides** (`padding:2px 6px; borderRadius:4; fontSize:11`) **fighting `.tag`'s own 1px/10px** → dropped to legacy's exact `background`+`color` pair. **Del button** `btn btn-sm` + an inline rgba red → **`btn btn-danger btn-sm`** (**real in BOTH** — legacy L140, theme :584). **Empty state** → in-table `<tr><td colSpan={10} className="empty-state">`, **dropping an invented icon/bold/period** for legacy's bare string. Tip footer → `marginTop:6, padding:'0 4px'`.

**Real work — Party GRN:** the KPI tiles were a **custom `KpiTile`** with inline grid/`borderTop:3px`/`fontSize:22` → legacy's **real `.stat-grid` / `.stat-card cyan|green|amber` / `.stat-label` / `.stat-val`** vocabulary — **all five classes verified BYTE-IDENTICAL between legacy L96-104 and theme :290-341.** `KpiTile` deleted. Labels → legacy's literals (`TOTAL GRNs`/`TOTAL RECEIVED`/`TODAY` — **`.stat-label` uppercases in both, so the render is identical**). **The modal's `Material Name` column was RESTORED** (legacy's `esc(pm?pm.name:ln.materialName||'')`). Modal line-table border `var(--border)`→**`var(--border2)`**, radius `6`→**`var(--radius)`** (both tokens real).

**🟢 VERIFIED, NOT ACCUSED (5 clean checks):**
- **`esc(pm.uom||'NOS')` is NOT ISSUE-158** — **a real `uom` column exists, and the server preserves legacy's default** (`String(r['uom'] ?? 'NOS')`, service.ts:134). **The `x` is intact.**
- **`dateLike()`/`toISOString().slice(0,10)` over raw `tx.execute` — SAFE, and the agent cited the settled entry rather than re-raising it.** Driver is postgres.js; `grn_date` is a **`date`** column → date-only ISO → UTC midnight → same day. **The skill's SETTLED section worked — third agent, first one not to burn budget on it.**
- **`summary` (3 tiles) and `linesCount`/`totalReceivedQty` are SERVER-COMPUTED SQL aggregates**, not browser rollups. **Both `api.ts` files are pure `apiFetch` hooks with zero client-side derivation.** Rule 1 respected.
- **A real server `total` exists on both endpoints** → **no ISSUE-095 "invent a disclosure" temptation; nothing added.**
- **`<th className="td-ctr">` left alone** — `.innovic-table th` (0,1,1) beats `.td-ctr` (0,1,0) → **inert in ours, and legacy uses the class form too → renders left in both. PARITY. Not swept.** *(ISSUE-241's rule applied correctly in the "don't touch" direction — the inline-style case is what differs, and this isn't one.)*
- **ISSUE-242 does NOT bite the modal's zebra** — **the ported `<tr>` background sits on a BARE `<table>`**, and our zebra rule is `.innovic-table tbody…`, **so it survives in both.**

**Deliberately not copied / kept:** **pagination + "Showing X–Y of Z"** (ours; legacy renders all rows from memory — server-backed, kept); **loading/error panels** (ours; legacy is synchronous); **`DC No.` and `Lines` columns** (ours — **legacy captures `dcNo` but NEVER displays it**; both surface real captured data); **`JW` → `JWSO` naming** (a deliberate product decision, commit `9527725`).
**Two Trap-1 calls, both correct:** the tip text **drops legacy's "Line No."** (our list has no JW Line column — ISSUE-268), and the modal note **drops legacy's "Select items from Item Master."** — **legacy's own sentence is self-contradictory** (it says Item Master, then Party Material Master) **and our picker lists Party Materials.**

**⚠️ Flagged for a ruling:** the amber **"Record Party Material GRNs here" banner** (`list.tsx:47-71`) is **ours-only — legacy has no such element** — and it carries **hardcoded hex** (`#FEF3C7`/`#F59E0B`/`#92400E`/`#78350F`). **Kept** per the live-system rule (deliberate onboarding guidance), **but it is the one element on the page with no legacy counterpart.**

## ISSUE-269 — Tool Issues: the item picker renders BLANK after selection (ISSUE-251's shape, 2nd instance)

- **Surfaced:** 2026-07-16 (REFACTOR-1, Tool Issues)
- **Severity:** P2 — a render bug, no data loss
- **Status:** [ ] open — needs state, not markup

**`setItemSearch('')` on pick re-runs `useItemsList({ search: undefined, limit: 50 })`.** If the picked item isn't in the first 50, **`selectedItem` → `null` → the input shows `''`.**

**No data loss** — `itemId` is retained and the save works. **But the user sees an empty required field immediately after choosing a value.**

**The second instance of ISSUE-251's shape** (SO Planning's four `SearchableSelect` pickers). **Both are the same mechanism: a value bound by a lookup against a PAGED list renders blank when the value falls outside the page.** *(Distinct from ISSUE-154/167/214's data loss — the immunity holds on the WRITE; the DISPLAY is what breaks.)*

## ISSUE-270 — Tool Issues: legacy's readonly Issue No. has no counterpart

- **Surfaced:** 2026-07-16 (REFACTOR-1, Tool Issues)
- **Severity:** P3
- **Status:** [ ] open

Legacy's **`_nextToolIssueNo()` (L24042)** renders a **readonly Issue No.** Ours has none — **no next-number endpoint. Not faked.**

**The FOURTH module with this gap:** SPO No. (ISSUE-222) · PO-from-PR's PO No. · DC No. (ISSUE-262) · this. **`DOC_NUMBER_TYPES` registers only `['sales_order','job_work_order','purchase_order','grn']`** — and **`DOC_NUMBER_FORMATS`' `prefix + 5 digits` shape fits all four.** **One shared fix, four modules.**

## ISSUE-271 — Tool Issues: legacy's stock display and insufficient-stock guard are unportable

- **Surfaced:** 2026-07-16 (REFACTOR-1, Tool Issues)
- **Severity:** P3
- **Status:** [ ] open

**Legacy `_tisItemFill` L24073-78 shows `Stock: N uom`** and **`addToolIssue` L24063 blocks `qty > stockQty`.**

**`Item` has no `stockQty`** (`shared/item.ts:10-28`) — **stock lives in store-inventory.** The agent rendered **`code — name | uom`** only.

**ISSUE-111's amendment applies:** on-hand **IS** server-available via **`v_item_stock.on_hand_qty`** — the gap is **DTO exposure**, not structure. **So this is a one-field API change, not a schema change.** *(Same shape as the Issue Register's ISSUE-211.)*

### Tool Issues — mapping confirmed, and THREE of my briefed claims were checked rather than inherited

**`renderToolIssue()` L23965-24036** + **`addToolIssue()` L24038-24071** + **`_toolReturn()` L24080-24126** (router key `toolissue`). **`api.ts` read, report-only — no divergence found.**

**🟢 THE THREE CHECKS — every one of my warnings was verified, and one was REFUTED:**
1. **🔴 ISSUE-242 does NOT apply — and "fixing" it would have MANUFACTURED a divergence.** **Legacy HAS a zebra rule at L113** (`tbody tr:nth-child(even) td{background:var(--bg3)}`) — **structurally identical to ours at L387.** So the overdue `<tr>` tint **is eaten on even rows in BOTH systems → parity.** **The agent did not move it to the cells.** *(ISSUE-242 is real on Pending SO Value because legacy has no zebra THERE. The rule is per-table, not global — exactly the `.card` lesson again: "absent from ours" and "absent from legacy" are different facts.)*
2. **`.dash-stat-card`** — **written 5× in legacy, defined nowhere → inert in legacy too.** No class added, no rule (the `.stat-card.blue` precedent). **The inline styles carry it — mirrored those.**
3. **ISSUE-065 mech 4 N/A** — **every column is `date`** (schema L2726-27, L2789), not timestamptz. **Cited the SETTLED entry rather than re-deriving it.**

**ISSUE-065 mech 1 CONFIRMED live at `list.tsx:411` and `:620`** — **exactly where the Issue Register agent predicted (L431/L639 were close; the real lines are 411/620).** *(Second-hand intel treated as a hypothesis and verified — the right handling.)*

**Real work:** **section order** (legacy puts statCards BEFORE the header, L24018); tile styling → legacy's `padding:12px;border-radius:10px;bg2;1px border` (**dropping an invented `borderTop:3px` accent, `radius:6`, a selection ring and mono**); **the Overdue tile now renders only if `>0`** (L24016); `minmax(140px)`→**`minmax(120px)`**; **the `<th>Action</th>` column is now UNCONDITIONAL** with an empty `<td>` for read-only users (**ours dropped the whole column**, shifting every other column for non-writers); empty state → **in-`<tbody>`, `colSpan=12`**, legacy's bare string (**dropping an invented 🔧 icon, `<strong>` and trailing period**); `<Undo2/>` → **`↩ Return`**, and **an invented `✓` on returned rows → legacy's EMPTY cell**; both modals hand-rolled `fixed` divs at `min(1100px,96vw)` → **legacy's real `.overlay`/`.modal`(560px)/`.modal-hdr`/`.modal-title`/`✕`/`.modal-body`/`.modal-footer`**; inline grid + custom 10px uppercase labels → **`.form-grid`/`.form-grp`/`.form-label`/`.form-full`**; **legacy's field order restored** (Date → Item → **Qty → Issued To → Exp Return** → RefType…; ours had Exp Return second); **both footers → `Cancel`/`Save`** (`showModal(t,b,fn)`, ISSUE-248).

**`★` mirrored as LITERAL label text, not `.req`** — **legacy has no `.req` in its CSS**, so our red star would render something legacy never does. *(The convention rule says don't flip `.req` app-wide; but where legacy writes a literal ★ in a modal we are porting verbatim, matching the literal is right.)*

**🟢 ISSUE-104 CLEAR — both no-match paths BLOCK THE SAVE:** legacy `if(!item){toast('Item not found');return false;}`; ours `if(!itemId){setErr('Select an item');return;}`. **`refType` is a `<select>` over the COMPLETE `STORE_ISSUE_REF_TYPES` enum → immune by construction.**

**🔴 A NUANCED `--teal` CALL, and I think it's right:** legacy's Return button carries **`color:var(--teal)` (L23996)** — **undefined in both systems (ISSUE-126), so legacy renders that label in the inherited colour.** **Our `#14b8a6` was KEPT**, because **legacy's own `rgba(20,184,166,…)` border and background make teal the evident intent**, and **on a live system reverting would be a visible regression to match a legacy bug.**
**This is distinct from SO QC Status**, where **legacy itself writes `var(--teal,#0d9488)`** — there the fallback IS legacy's behaviour. **And from ISSUE-195** (`assembly/list.tsx`), where **ours invents a fallback legacy doesn't have.** **Three `--teal` sites, three different correct answers.**

**Kept ours:** tile click-to-toggle-back-to-All (legacy only sets); server pagination (legacy renders all client-side); loading/error panels (legacy is synchronous). **The tile selection ring was REMOVED** — legacy has none, **and the `<select>` still reflects filter state**, so nothing was lost.

### Saved Report Edit — the AUDIT hypothesis was FALSIFIED, and correctly

**I briefed:** *"`edit.tsx` is page chrome only… if it needs nothing, say so and make ZERO edits — that is a real result."*

**The audit split cleanly, and half of it needed work:**

| Aspect | Finding |
| --- | --- |
| **Inherits the Builder refactor?** | ✅ **YES** — the props contract (`Props`/`BuilderInitial`/`SaveInput`) is **byte-identical**; `edit.tsx` compiled untouched. **ISSUE-097 holds exactly as recorded.** |
| **`onExcel` wiring** | ✅ **Correct** — byte-identical to `new.tsx` (same endpoint, `apiDownload`, `excelLoading` pair). |
| **All Builder props wired** | ✅ Every prop passed, same shape as `new.tsx`; only `initial` and `saveLabel` differ, **as intended.** |
| **Its own chrome** | 🔴 **NEVER REFACTORED** — `<main className="container max-w-6xl py-10">` + shadcn `Card`/`Button`/`h1 text-2xl`. **"Literally the skill's FROM side."** |

**🔴 THE DECISIVE ARGUMENT:** **legacy serves `new` AND `edit` from the ONE `renderReportBuilder`** — and **`new.tsx`, ported from that same function, already uses `<div>` + `.section-hdr` "📄 Excel Report Builder" + `.panel`/`.panel-body`/`.empty-state`.**
> **Two routes rendering ONE legacy function cannot legitimately have different chrome.**
**`edit.tsx` inherited the *Builder* but never got its *own* chrome ported. That is precisely what the audit was for.** *(A good reminder: "the shared component was refactored" does not mean "the page was refactored.")*

**Changes:** `<main className="container max-w-6xl py-10">` + `space-y-6` → a bare `<div>`; shadcn `Button asChild` + `<ArrowLeft/>` → **`<Link className="btn btn-sm btn-ghost">← Back to report</Link>`** (**same `/saved-reports/$id` route binding**); `<h1 className="text-2xl…">Edit report</h1>` + subtitle → **`<div className="section-hdr m-0">📄 Excel Report Builder</div>`** (legacy L17555 — **and legacy has no subtitle**); loading `Card`+`Loader2` → `.panel`/`.panel-body`/`.empty-state`; error `Card`/`CardHeader`/`CardTitle`/`CardDescription` → `.panel`/`.panel-hdr`/`.panel-title`/`.panel-body`/`.empty-state`, **preserving the `sourcesQ`/`reportQ` `errorMessage` logic exactly**. Unused imports dropped.

**Zero logic changes** — `onSave`, `onExcel`, `updateMutation`, `navigate`, `loading`/`errored`/`errorMessage` all untouched.

**Correctly NOT re-litigated** (ISSUE-097/096): the drag grips (**inert in legacy** — `_rbDropCol` L17513 rejects `COL:` payloads), `N records match`, the preview stat tiles, the Load Template dropdown. **`list.tsx`/`run.tsx` untouched** (No Legacy Counterpart). **ISSUE-096 context noted, not acted on** (it lives in `runner.ts`): the cap is **`ROW_LIMIT = 5000`**, and **`SUMMARY_LIMIT = 200` truncates the summary with no indicator** where **legacy rendered all groups + a TOTAL row.**
