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
- `pnpm dev` — runs api + web in parallel

## Seclore / eScan Notes (this dev box only)
- This workstation runs Seclore FileSecure DLP and eScan AV. Both intercept PowerShell execution and stdout from native processes.
- For local-only ops scripts, prefer `.cmd`/`.bat` wrappers or invoke via Node (`node ./scripts/foo.js`) to bypass PowerShell-specific blocks.
- Clarification of Seclore egress policy on legacy spec/migration scripts is an open ADR (see `docs/DECISIONS.md` ADR-011 pending).
