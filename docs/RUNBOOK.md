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

## Seclore / eScan Notes (this dev box only)

- This workstation runs Seclore FileSecure DLP and eScan AV. Both intercept PowerShell execution and child-process loaders for native binaries.
- **`tsx watch` is silently killed.** Plain `tsx` (single-shot, no watch) is fine. The api `dev` script uses plain `tsx` for that reason. If even plain `tsx` ever stops working, fall back to compiled output: `pnpm --filter @innovic/api build && node dist/server.js`.
- The web dev server (`vite`) is unaffected — it survives backgrounding fine.
- For local-only ops scripts, prefer `.cmd`/`.bat` wrappers or invoke via Node (`node ./scripts/foo.js`) to bypass PowerShell-specific blocks.
- Clarification of Seclore egress policy on legacy spec/migration scripts is an open ADR (see `docs/DECISIONS.md` ADR-012 pending).
