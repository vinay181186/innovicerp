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
- **Status:** [~] Partial — QC submit flow shipped 2026-05-15 (T-040d per ADR-025) writes `log_type='qc'` and triggers `tryCascadeJcComplete` like `submitOpLog` does. New service test "cascade fires when QC log brings the JC to complete" proves the QC path drives the cascade end-to-end. **Still gated on the outsource receive flow** for IN-JC-00002 op 7 (COATING) — once that lands, the migrated JC can drive cascade end-to-end. Browser-smoke gated on user (after T-040d ships, navigate to `/op-entry?jc=IN-JC-00003` and submit QC against ops 1/2 to clear the `qc_pending` state).

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
- **Status:** [ ] open

**Repro:** Open SO-436 detail. The ITEM column on every line reads `— linked —`. The DRAWING column already shows the unique identifier the user actually scans for.

**Fix sketch:** Either render the item code (when `item_id` is set, show `items.code`; else `item_code_text`), or drop the column entirely since DRAWING covers identification.

---

## ISSUE-007 — `job_cards.closed_at` not set when cascade fires

- **Surfaced:** 2026-05-15 (cascade smoke verification on TEST-CASCADE-001)
- **Severity:** P2 (cascade still fires correctly; downstream consumers reading `closed_at` will miss the event)
- **Status:** [ ] open

**Repro:** Run a full op-entry cascade through TEST-CASCADE-001. After Op 2 submit, query `SELECT closed_at FROM job_cards WHERE code='TEST-CASCADE-001'` — value is `NULL` even though `v_jc_status.computed_status='complete'` and the SO/SO-line are both `closed`.

**Effect:** `v_jc_status` derives `'closed'` from `jc.closed_at IS NOT NULL` first, then `'complete'` from op completeness. So a cascade-completed JC sits in derived state `'complete'` forever, never `'closed'`. Reports / alerts / dashboards keying off `closed_at` (`apps/api/src/modules/reports/definitions/jc-ageing.ts`, `al-012-jc-overdue.ts`, etc.) won't see the JC as closed.

**Root cause hypothesis:** `sales-cascade.ts` closes SO/JW lines + headers but doesn't touch `job_cards.closed_at`. There may not be any code path that sets `closed_at` automatically — possibly intended as a manager-explicit-signoff field, but if so the v_jc_status `'complete'` vs `'closed'` distinction needs documentation.

**Fix sketch:** Either (a) extend `tryCascadeJcComplete` to set `jobCards.closed_at = now()` in the same tx when computed_status flips to complete, or (b) document that `closed` and `complete` are distinct states with `closed` reserved for manager signoff and audit alignment of all JC consumers.

---

## ISSUE-006 — no global nav / Home button in /apps/web

- **Surfaced:** 2026-05-15 (browser smoke T-030 / T-031 / T-032)
- **Severity:** P3 (navigation UX; everything still reachable via URL bar / back)
- **Status:** [ ] open

**Repro:** Every route renders its own card layout. There's no header with Home + breadcrumb. Users currently navigate via URL bar or browser back button.

**Fix sketch:** A shared `<AppHeader>` component (`apps/web/src/components/shared/`) with Home link + per-route breadcrumb prop. Apply via the root route component so every screen inherits. Reads role from `lib/session.ts` for role-gated nav items (admin: alerts admin, etc.).

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
