# RUNBOOK.md — Operational Procedures

## Deploy to Staging
```
git checkout staging
git merge main
git push origin staging
# GitHub Actions handles the rest (wired in T-011)
```

## Deploy to Production
1. Merge to `main` after staging verification.
2. GitHub Actions runs CI; manual approval gate triggers.
3. Approve in GitHub Actions UI.
4. Migrations run automatically via Drizzle Kit (`pnpm --filter api db:migrate`).
5. Verify health: `curl https://api.<domain>/health`.

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
2. Update Railway / Hetzner env var.
3. Redeploy API.
4. Revoke old value at the source.

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
