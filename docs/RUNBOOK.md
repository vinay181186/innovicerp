# RUNBOOK.md — Operational Procedures

## Deploy — API (Railway, Singapore / `asia-southeast1`)

API deploys are handled by **Railway's GitHub integration** (not GitHub Actions — see ADR-010). On every push to `main`, Railway pulls the repo, builds `apps/api/Dockerfile`, and rolls the new image. GitHub Actions runs CI in parallel (typecheck + lint + gated tests) but does not deploy.

### Trigger a deploy

- **Standard:** push to `main` → Railway auto-deploys within ~30 seconds.
- **Manual:** `railway up` from the repo root (uploads local code via CLI; bypasses GitHub).
- **Empty trigger:** `git commit --allow-empty -m "chore: redeploy" && git push` (e.g. after env var rotation).

### View logs

- **CLI:** `railway logs` (live tail) or `railway logs --tail 200`
- **Dashboard:** project → API service → "Deployments" tab → click any deployment → "View Logs"

### Rollback

1. Railway dashboard → API service → **Deployments** tab.
2. Find the last known-good deployment (look for green checkmark + healthy `/health`).
3. Click the `…` menu on that row → **Redeploy**.
4. Railway re-rolls the prior image. Verify `/health` after ~30 seconds.

If the bad deployment came from a code bug rather than env/config, also revert the offending commit on `main` so the next push doesn't redeploy the same broken code.

### Verify health

```
curl https://<railway-service>.up.railway.app/health
# Expected: {"ok":true,"env":"production","version":"X.Y.Z","gitSha":"...","timestamp":"..."}
```

The Railway public URL is shown on the service's main panel. Custom domains (when added) replace the `*.up.railway.app` hostname; same `/health` path.

### Required env vars (Railway → service → Settings → Variables)

- `NODE_ENV=production`
- `DATABASE_URL` — session pooler (port 5432, used by migrations + seed)
- `DATABASE_URL_POOLED` — transaction pooler (port 6543, used by runtime API)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

**Do not** set `PORT` — Railway injects it automatically and `apps/api/src/lib/env.ts` prefers Railway's `PORT` over `API_PORT` (ADR-010).

### After env var changes

Railway auto-redeploys when variables are edited. To force without changing values, click "Redeploy" on the latest deployment row.

## Deploy — Web (Cloudflare Pages, future)

Not yet wired. Will be a separate workflow file (`.github/workflows/deploy-web.yml`) when the Cloudflare account is set up. Until then, the web app runs only locally.

## Restore from Backup

1. Pull latest dump from Backblaze B2:
   ```
   b2 download-file innovic-backups innovic-<date>.sql.gz ./
   gunzip innovic-<date>.sql.gz
   ```
2. Restore to a NEW Supabase project (NOT production):
   ```
   psql "<test-connection-string>" < innovic-<date>.sql
   ```
3. Verify: connect API to test instance via env var, run smoke tests.
4. Promote: cut over via DNS.

## Rotate Secrets

1. Generate new value (Supabase service key, JWT secret, etc.).
2. Update the Railway env var (Railway dashboard → API service → Settings → Variables; auto-redeploys on save).
3. If CI/test secrets changed, also update them in GitHub repo settings → Secrets and variables → Actions (`CI_*` prefix per `ci.yml`).
4. Verify the new deployment is healthy (`/health` 200) before revoking the old value.
5. Revoke old value at the source (Supabase dashboard / etc.).

## Common Issues

### "ENOTFOUND db.\<ref\>.supabase.co" from app or migration

- The `db.<ref>.supabase.co` hostname is **IPv6-only** on Supabase. Most Indian residential ISPs don't route IPv6, so it fails to resolve.
- Fix: use the Supavisor pooler instead. Both `DATABASE_URL` (port 5432, session pooler) and `DATABASE_URL_POOLED` (port 6543, transaction pooler) should point to `aws-X-<region>.pooler.supabase.com` with user `postgres.<ref>`.
- For `ap-south-1`, newer projects live on `aws-1-ap-south-1.pooler.supabase.com` (older ones use `aws-0-`). Try `aws-1-` first.

### "XX000 Tenant or user not found" from Supavisor

- The user portion is wrong (must be `postgres.<project-ref>`, not just `postgres`), OR the pooler region in the host doesn't match the project's actual region.
- Try the alternate pooler shard: `aws-0-` ↔ `aws-1-`.

### "Connection pool exhausted"

- Check Supabase dashboard → Database → Connection Pooler usage.
- Increase pool size, or confirm PgBouncer (port 6543) is being used in `DATABASE_URL_POOLED`.

### "Realtime subscription drops"

- Check WebSocket connection in browser dev tools.
- Verify token hasn't expired.
- TanStack Query reconnect logic handles this; ensure `staleTime` isn't too aggressive.

### "Migration fails on production"

- DO NOT manually fix in Supabase Studio (CLAUDE.md §6 rule 9).
- Roll back deployment.
- Fix migration locally, test in staging, redeploy.

## Database — Migrations

Schema is owned by Drizzle. Two migration paths run side-by-side:

- **drizzle-kit-generated migrations** — file pattern `apps/api/src/db/migrations/NNNN_<name>.sql`, generated from `apps/api/src/db/schema.ts`. Applied by `drizzle-kit migrate`. Used for tables, columns, FKs, indexes, RLS policies expressed in the schema graph.
- **Hand-written migrations** — same folder, same numbering convention, but anything outside the drizzle schema graph: triggers, views, CHECK constraints not in schema.ts, RLS policies referencing custom helpers, one-off DDL like dropping legacy text columns. Applied by `apps/api/src/db/apply-sql.ts` (statement-by-statement runner that splits on `--> statement-breakpoint` markers).

### Generating a drizzle migration

```
pnpm --filter @innovic/api drizzle-kit generate
```

Creates the next-numbered SQL file in `apps/api/src/db/migrations/` plus a journal entry. Inspect the generated SQL before applying — drizzle-kit can suggest unnecessary diffs (column re-orders, default value changes); reject those by reverting the schema.ts wobble that triggered them.

### Applying drizzle-generated migrations (standard path)

```
pnpm --filter @innovic/api drizzle-kit migrate
```

Executes any unapplied migrations in journal order against `DATABASE_URL`. Idempotent — already-applied entries skip.

### Applying hand-written migrations (`apply-sql.ts`)

```
pnpm --filter @innovic/api exec dotenv -e ../../.env.local -- tsx src/db/apply-sql.ts <path1.sql> [path2.sql ...]
```

Runs each `--> statement-breakpoint`-separated statement sequentially in a single connection. Use `CREATE OR REPLACE` / `CREATE … IF NOT EXISTS` so re-runs are safe. Hand-written files do NOT get journaled — re-running is your responsibility.

Concrete past invocations (search commit history for shape):

- Phase 5 triggers + views: `0010_phase5_triggers.sql` + `0011_phase5_views.sql`
- Phase 6 NC + dispatch triggers: `0012_phase6_nc_dispatch_triggers.sql`
- Phase 7 saved-reports trigger: `0014_phase7_saved_reports_trigger.sql`
- Phase 8 activity-log: `0015_phase8_activity_log.sql` (drizzle-gen file applied via apply-sql to bypass the journal-orphan blocker — see below)

### The journal-orphan workaround

**Symptom:** `drizzle-kit migrate` fails with a message about a journal entry referencing a SQL file that doesn't exist (e.g. `0008_verify_no_drift` in this repo).

**Root cause:** Pre-existing journal corruption from an early migration that was rolled back before the file was created or after the file was deleted. The journal table thinks the migration ran; the file is missing; drizzle-kit refuses to proceed.

**Workaround (in use since Phase 5):**

1. Generate the migration normally with `drizzle-kit generate` — produces an `NNNN_*.sql` file.
2. Skip `drizzle-kit migrate`. Apply the new file directly via `apply-sql.ts`:
   ```
   pnpm --filter @innovic/api exec dotenv -e ../../.env.local -- tsx src/db/apply-sql.ts src/db/migrations/NNNN_<name>.sql
   ```
3. Verify in Supabase Studio (or via `psql`) that the new objects exist.
4. Manually upsert a row in the drizzle journal table so future drizzle-kit drift checks see the migration as "applied" if needed (rarely required — drizzle-kit drift detection compares schema.ts to DB state, not journal contents).

**Permanent fix (deferred):** clean up the orphan journal entry. Requires identifying which legacy migration the orphan refers to + reconstructing or replaying it. Not blocking — apply-sql is the working path. Track in a follow-on task if the journal corruption ever expands beyond the single orphan.

### Rolling back a bad migration

drizzle has no "down" path. To roll back:

1. Write a new migration that inverts the change — drop columns added, recreate columns dropped, etc.
2. Apply via the same path (drizzle-kit migrate or apply-sql).
3. Production rollback path is "deploy a fixed migration", not "undo the last migration."

For partial-failure cases (migration applied to half a multi-statement transaction): hand-investigate the DB state, write a corrective migration, and document the incident in `docs/MIGRATION-LOG.md`.

### Forbidden

- **Never modify production schema in Supabase Studio** (CLAUDE.md §6 rule 9). Studio edits don't journal and break the next deploy.
- **Never delete a migration file once applied to any environment.** Even on local dev, you'll lose the ability to bootstrap a fresh DB.

---

## Database — Phase Validators

Each migration phase ships a validator script that does a read-only field-level diff between transform output and DB state plus FK orphan checks. Run after any load, after any schema/data change touching a phase's tables, and before any cutover.

| Script             | Phase                                | Tables covered                                                                                                    | Notes                                                                                                |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `validate:phase2`  | Master data                          | `users`, `clients`, `vendors`, `items`, `machines`, `operators`                                                   | 14 FK columns; users count can show +1 from leftover smoke users (documented in MIGRATION-LOG)       |
| `validate:phase3`  | Op-entry chain                       | `route_cards`, `route_card_ops`, `route_card_revisions`, `job_cards`, `jc_ops`, `op_log`, `running_ops`           | 25 FK columns; checks `v_jc_op_status` + `v_jc_status` view sanity; HH:MM ↔ HH:MM:SS time normaliser |
| `validate:phase4`  | Sales chain                          | `sales_orders`, `sales_order_lines`, `job_work_orders`, `job_work_order_lines`                                    | 16 FK columns; verifies job_cards source FK backfill (2/2 — IN-JC-00002 + IN-JC-00003)               |
| `validate:phase5`  | Procurement                          | `purchase_requests`, `purchase_orders`, `purchase_order_lines`, `goods_receipt_notes`, `goods_receipt_note_lines`, `store_transactions` | 32 FK columns; verifies jc_ops outsource backfill (1/1)                                              |
| `validate:phase6`  | QC + dispatch                        | `qc_processes`, `nc_register`, `delivery_challans`, `delivery_challan_lines`                                      | 16 FK columns; legacy dispatch_log + JW DC + party collections deliberately NOT migrated (ADR-017)   |
| `validate:phase8`  | Activity log                         | `activity_log`                                                                                                    | 2 FK columns; legacy "Japan" entries land with `user_id=null` + `user_name` snapshot (ADR-019)       |

### Run a validator

```
pnpm --filter @innovic/migration validate:phase5    # or phase2 / phase3 / phase4 / phase6 / phase8
```

Output lands in `migration/load-output/_phaseN_validation.json` (gitignored). Look at the last line of stdout: `overallStatus: PASS` or `overallStatus: FAIL`.

### Reading the output

PASS means: **(a)** every transform-row's mapped columns match the DB row byte-for-byte (modulo documented normalisations: enum lowercasing, NUMERIC `.toFixed(2)` strings, ISO ↔ Postgres timestamptz format, jsonb canonical), AND **(b)** every FK column in the checked set has zero orphans.

FAIL means: at least one of the above failed. The output JSON has a `byTable` block listing diffs per table + an `orphanFks` block listing FK column → orphan-row counts. Investigate each before proceeding.

### When to run

- **After a re-load** (e.g. you reset the dev DB and re-ran `migration/load.ts`).
- **After any schema migration that touches a phase's tables** (column add/drop/rename can leave existing rows still valid but the validator catches mismatches with transform expectations).
- **Before any cutover** — the cutover SOP (see "Phase Cutover" section below) requires a clean PASS as the entry gate.
- **Periodically** if you suspect drift (e.g. someone hand-edited a row in Supabase Studio against §6 rule 9).

### Known transient

`validate:phase3` can rarely return FAIL on `v_jc_status` view-vs-snapshot mismatch when run concurrently with a parallel test that mutates `jc_ops`. Re-run alone to confirm. If still FAIL, investigate.

---

## Release Smoke / Sign-off Procedure

Run this before declaring a release ready, and after any infra change (Railway region, env var rotation, schema migration, new module rollout).

### Setup — point local web at production API

1. Edit `.env.local` (repo root): set `VITE_API_URL` to the Railway URL (e.g. `https://innovic-erp-production-xxxx.up.railway.app`). Do not commit this change.
2. `pnpm --filter @innovic/web dev` — local Vite on `:5173`, talking to production API.

### Part A — Admin happy path (Chrome)

1. Open DevTools → Network → tick "Preserve log".
2. Log in as admin.
3. For each touched module: list → create → edit → soft-delete → confirm gone from list. All HTTP responses 2xx.

### Part B — Non-admin role (RLS verification)

1. Supabase dashboard → Authentication → add a fresh user.
2. Activate via SQL: `update public.users set role = '<role>', company_id = (select id from public.companies where ...), is_active = true where email = '<test-email>';`
3. Sign out, log in as the new user.
4. Read should succeed (per `company_isolation` RLS policy).
5. Write attempts that exceed the role's policy must fail (403 from service-layer check, OR DB-level RLS rejection — both acceptable; document if it surfaces as 500).
6. Cross-company isolation check: never visible from this user's account.

### Part C — Cross-browser

Repeat Part A in Firefox. Optional: Edge / Safari if any user is on those.

### Cleanup

1. Revert `.env.local` to `VITE_API_URL=http://localhost:3000`.
2. Soft-delete or hard-delete the smoke records (per current data policy — soft is the project default per ADR-006).
3. Remove the test non-admin user if no longer needed.

### Sign-off

Record date + browsers + roles tested + result in `docs/TASKS.md` recently-completed table, with a one-line note. Phase cutovers also get an entry in `docs/MIGRATION-LOG.md`.

## Phase Cutover — Module-by-Module User Migration

The Phase 5 procurement cutover (T-037) is the first time we use this. Phase 4 sales cutover (T-034) and future phase cutovers follow the same shape — substitute the module list and the per-user smoke checks.

### Pre-cutover (do once, before the first user)

1. **Re-run the phase validator** to confirm dev DB still matches transform:

   ```
   pnpm --filter @innovic/migration validate:phase5
   ```

   Must end with `overallStatus: PASS`. If it FAILs on a transient pooler issue (rows visible in one run but not the next), re-run; if still failing, investigate before cutting anyone over. Output lands in `migration/load-output/_phase5_validation.json` (gitignored).

2. **Snapshot the pre-cutover state** for post-cutover diffing. Quick ad-hoc:

   ```
   pnpm --filter @innovic/migration tsx -e "
     import('./load/db.ts').then(async ({rawSql, closeDb}) => {
       const c = (await rawSql\`SELECT id FROM public.companies LIMIT 1\`)[0].id;
       for (const t of ['purchase_requests','purchase_orders','purchase_order_lines','goods_receipt_notes','goods_receipt_note_lines','store_transactions']) {
         const r = await rawSql\`SELECT count(*)::int AS c FROM public.\${rawSql(t)} WHERE company_id = \${c}::uuid\`;
         console.log(t, r[0].c);
       }
       const stock = await rawSql\`SELECT item_id, on_hand_qty FROM public.v_item_stock WHERE company_id = \${c}::uuid ORDER BY item_id\`;
       console.log('v_item_stock rows:', stock.length, '· total on_hand:', stock.reduce((s,r)=>s+r.on_hand_qty,0));
       await closeDb();
     });
   "
   ```

   Save the output as the pre-cutover baseline (paste into a session note or commit to a `cutover-snapshots/` folder if you want history).

3. **Confirm the legacy HTML is still reachable** as the safety net (CLAUDE.md §Phase 9 turns it off later). Procurement users should be able to flip back to it if anything breaks during cutover.

4. **Pick the first user** — usually an admin or a comfortable senior procurement person. Avoid the busiest hour; pick a quiet window (early morning or end-of-day IST).

### Per-user cutover steps

For each user being cut over:

1. **Pre-flight (with user, ~5 min):**
   - Sign in as the user in the new system.
   - Open their key procurement screens. For Phase 5 that's: Purchase requests · Purchase orders · Goods receipt notes · Store transactions.
   - Confirm everything they own is visible (filter by `vendorId` or scroll the list).
   - On a single live PR / PO they recognise, click through to detail. Confirm vendor / item / qty / status all match what they see in the legacy system.

2. **Workflow smoke (~10 min, with the user driving):**
   - **PR**: list shows their open PRs; create a fresh test PR (e.g. vendor + item + qty=1 + estCost=1) → save → confirm status `open`.
   - **PR → PO**: open the test PR → "Create PO" button → fill code (e.g. `CUTOVER-TEST-<initials>-001`) + date + GST → save. Confirm: PR status flips to `po_created`; PO appears in /purchase-orders with status `open`; "Open linked PO" button on the PR works.
   - **PO → GRN**: from the new PO detail → "Receive (new GRN)" button → form pre-fills vendor + 1 line received=1 + qcStatus=pending → save GRN. Confirm: PO status flips to `qc_pending` (received qty matches order qty, but QC not yet complete); PO line received_qty = 1.
   - **GRN QC accept (the cascade test)**: edit the GRN line → qcStatus=`completed` + qcAcceptedQty=1 + qcDate=today → save. Confirm: PO status flips to `closed`; the item's master detail page now shows On hand bumped by 1 and a new row in Stock history (type=`in`, source=`grn_qc`, source_ref starts with the GRN code).
   - **Locks**: try to edit the QC-completed line again (qcAcceptedQty back to 0) → expect 409 ConflictError surfaced as a toast; "create reversing GRN line instead" message. Try to delete the GRN → button disabled with hover title.

3. **Hand-off:**
   - User keeps the new system open; legacy stays reachable as the safety net.
   - They use the new system for all their next procurement actions during the soak.
   - Capture any gaps surfaced as new tasks in `docs/TASKS.md` — do NOT extend T-037 with rolling fixes.

4. **Soak (1–2 days):**
   - Watch for: items master on_hand drifting from legacy stock counts (unexpected), PO header status not flipping when expected, store_transactions rows missing for QC accepts, viewer/role users seeing things they shouldn't.
   - Daily during soak: re-run `validate:phase5` and re-snapshot counts; per-table count must equal `pre_cutover_count + new_writes_today`.

5. **Cut next user** once first user has soaked clean.

### Rollback (if cutover goes sideways for one user)

The new system writes are durable but additive — rolling a single user back means:

1. Tell the user to use legacy only for their next actions.
2. Identify writes the user made in the new system during the cutover. Tag them with `remarks` so they're easy to spot, OR query by `created_by = <user.id> AND created_at > <cutover_start_ts>`.
3. Decide for each: (a) re-enter into legacy (most common — duplicate write), (b) leave in new only (if the user is willing to consult the new system for those records), or (c) soft-delete from new (`PATCH … status=cancelled` for PRs/POs; for GRN lines that have already QC-accepted, see below).
4. **GRN QC-completed rollback is special**: those wrote `store_transactions` rows that the new on-hand depends on. Don't soft-delete the GRN — instead create a reversing GRN line on the same PO with type=`adjust` (T-036c product call). If you need a clean rollback that erases the on-hand bump, fall through to a manual SQL adjustment in coordination with the user — document in `docs/MIGRATION-LOG.md` and apply the inverse `store_transactions` row by hand.

### Soft-delete vs cancel in cutover noise

During cutover, prefer **cancel** (status='cancelled' on PR / PO) over **soft-delete** for any test or duplicate records — leaves the audit trail intact and avoids the "PR has linked PO" deletion guard. Reserve soft-delete for genuine mistakes.

### Sign-off

When the last procurement user is cut over and has soaked clean for ≥1 day:

1. Append a row to `docs/MIGRATION-LOG.md` under "Phase 5 cutover sign-off": date, users + dates each cut over, count of writes during cutover, any incidents.
2. Update `docs/TASKS.md`: mark T-037 done; recently-completed entry summarises any gaps captured.
3. Mention in the ADR or at minimum the TASKS.md entry whether legacy HTML stays reachable or has been retired for procurement (Phase 9 turns it off globally).

---

## Monthly Restore Drill (T-058)

First Monday of every month:

1. Pull latest backup.
2. Restore to test instance.
3. Boot API against it.
4. Run smoke test suite.
5. Log result in `docs/MIGRATION-LOG.md` (or a new `docs/DRILL-LOG.md` if it gets long).

## Local Dev Setup (Windows)

- Node 24, pnpm 10+, Git for Windows
- Set PowerShell ExecutionPolicy: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
- `pnpm install` from repo root
- `cp .env.example .env.local` and fill in dev Supabase keys

## Local Dev — Starting the API and Web

The API and web dev servers run in **two separate, foreground terminals**. Don't background them and don't combine them in one terminal.

### Terminal #1 — API (Fastify, port 3000)

```
pnpm --filter @innovic/api dev
```

This invokes plain `tsx src/server.ts` (no watch — see "Seclore / eScan notes" below). Wait for the Pino `Server listening at http://127.0.0.1:3000` line. **Manual restart on code changes:** Ctrl+C, then re-run.

A `dev:watch` variant exists (`pnpm --filter @innovic/api dev:watch`) for machines where DLP isn't intercepting `tsx`'s watcher. On this workstation it silently exits — don't use it here.

### Terminal #2 — Web (Vite, port 5173)

```
pnpm --filter @innovic/web dev
```

Wait for `Local: http://localhost:5173/`. If 5173 is already bound by an orphan from a prior session, Vite will jump to 5174 — kill the orphan first:

```
netstat -ano | findstr :5173
taskkill /F /PID <pid>
```

### Verifying both are up

```
curl http://localhost:3000/health      # API → {"ok":true,...}
# then open http://localhost:5173 in the browser, log in,
# DevTools → Network → confirm /me and /items? return 200.
```

## Test Suite — Hygiene & Recovery

### How tests share the dev DB

There is currently one Supabase project — dev. Tests run against the same DB the API talks to during local dev. Until a dedicated CI/staging Supabase project is provisioned (Phase 1 carry-over note), tests must be hygienic on a shared DB:

- Every test file inserts rows with a code prefix (`T<phase>R?-`, e.g. `T018-A1`, `T036C-LST`, `T051-AUD`).
- Tests `afterAll`-clean their prefixed rows. CASCADE handles child rows.
- Vitest's `globalSetup` (`apps/api/test/global-setup.ts`) wipes any leftover test cruft *before* the first test runs.

### What `globalSetup` does

`apps/api/test/global-setup.ts` runs once at the start of every full-suite invocation (`pnpm test` or `pnpm --filter @innovic/api test`). It:

1. Deletes parent transactional rows where `code LIKE 'T%-%'` in FK-safe order: nc_register → delivery_challans → goods_receipt_notes → store_transactions → purchase_orders → purchase_requests → sales_orders → job_work_orders → job_cards. CASCADE handles each parent's children (lines, jc_ops, op_log, running_ops).
2. Deletes master rows where `code LIKE 'T%-%'`: items → vendors → clients → machines → operators.
3. Deletes `saved_reports` where `name LIKE 'T041B-%'` (saved-reports keys by `name`, not `code`).
4. Deletes `activity_log` where `entity LIKE 'T051-%' OR ref_id LIKE 'T%-%'` (audit cruft from emitter sweeps).

The `code LIKE 'T%-%'` pattern matches every test prefix without false positives — real seed/migrated codes never start with `T0/T1/T2/T3/T4` followed by a hyphen.

### When `globalSetup` isn't enough

If a test suite still fails on `code already exists` errors during `beforeAll`, the cruft is using a code shape that doesn't match `T%-%`. Find the shape:

```sql
-- Example: scan items for any code that doesn't look like seed/migrated data
select code from public.items where code !~ '^[0-9A-Z]+$' order by code;
```

Once identified, either (a) update the offending test to use a `T%-%` code, OR (b) add a targeted DELETE to `global-setup.ts`.

### Manual recovery — wedged dev DB

When tests have left the DB in a state that `globalSetup` doesn't recover (e.g. a fixture references a row outside the prefix pattern, or a test-killed run left orphaned `running_ops` rows that block JC fixture inserts), nuke and re-load:

1. **Stop the API dev server** (`Ctrl+C` in the API terminal).
2. **Run the global-setup wipe by hand** to clear the standard cruft:
   ```
   pnpm --filter @innovic/api exec dotenv -e ../../.env.local -- tsx test/global-setup.ts
   ```
   (The file exports a default async function; vitest calls it; you can call it directly too.)
3. **Inspect leftover oddities** in Supabase Studio's Table Editor or via `psql`. Common stragglers: rows in `op_log` keyed by jc_op_ids whose parent JC was wiped (FK CASCADE should handle this — if not, raw delete by id range).
4. **Re-run the affected phase load** if a transactional table got truncated:
   ```
   pnpm --filter @innovic/migration tsx load.ts
   ```
5. **Re-run the validator** for the phase: `pnpm --filter @innovic/migration validate:phaseN` — must end PASS before resuming.

### Known transient races

These are documented baselines, not bugs. They surface ~1× per full-suite run; isolated module re-runs are always green.

| Race                                                        | Phase                | Symptom                                                                                                          | Recovery                                                                                                                  |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `v_jc_status` snapshot vs concurrent `op_log` write         | Phase 3 / op-entry   | A test asserting `v_jc_status` row count or computed_status sees a mid-flight value                              | Re-run the affected file (`pnpm --filter @innovic/api test op-entry`). If still failing, investigate.                     |
| `store_transactions` ledger write race in GRN-QC cascade    | Phase 5 / GRN module | Test reading store_transactions counts sees +/-1 vs expected during parallel GRN write                           | Re-run the GRN module file alone (always 15/15).                                                                          |
| Reports `stock-movement-log` filter race vs GRN ledger writes | Phase 7 / reports    | Reports test sees a transaction row that wasn't there at filter eval time                                        | Re-run reports module alone (always 27/27).                                                                               |

If a race surfaces twice in a row in the same module file run alone, treat as a real regression — investigate, don't retry.

### Why we can't just `pool: 'forks' + singleFork: true`

Tried 2026-05-04. Made things worse — surfaced 13 cruft-related failures from accumulated test-killed runs that the parallel-`afterAll`s were masking. Reverted. The current `globalSetup` is the proper fix for the cruft problem; `singleFork` would only paper over it. Track in TASKS.md if test isolation ever needs a real CI/staging DB.

---

## Seclore / eScan Notes (this dev box only)

- This workstation runs Seclore FileSecure DLP and eScan AV. Both intercept PowerShell execution and child-process loaders for native binaries.
- **`tsx watch` is silently killed.** Plain `tsx` (single-shot, no watch) is fine. The api `dev` script uses plain `tsx` for that reason. If even plain `tsx` ever stops working, fall back to compiled output: `pnpm --filter @innovic/api build && node dist/server.js`.
- The web dev server (`vite`) is unaffected — it survives backgrounding fine.
- For local-only ops scripts, prefer `.cmd`/`.bat` wrappers or invoke via Node (`node ./scripts/foo.js`) to bypass PowerShell-specific blocks.
- Clarification of Seclore egress policy on legacy spec/migration scripts is an open ADR (see `docs/DECISIONS.md` ADR-012 pending).
