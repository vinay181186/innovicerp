# GO_LIVE.md — Trial-run deployment runbook

> **READ THIS on a "resume" / "go live" / "deploy" request.** This file is the
> source of truth for the trial-run deployment (it lives in the repo, so it
> travels to any machine via git — unlike the local `.claude` auto-memory).
>
> Status: **WEB IS LIVE on https://innovic-erp.pages.dev (trial URL)** as of
> 2026-06-13. API live on Railway at `https://api-production-06c90.up.railway.app`.
> `ALLOWED_ORIGINS` on Railway already includes the pages.dev origin (verified:
> CORS permits it, rejects others). Remaining: Phase 1 DB purge/migration-check,
> Phase 5 onboarding, Phase 7 backups, and the custom domain (Phase 3, deferred
> to after the trial — see GoDaddy note below). Last updated 2026-06-13.
> CRM (Leads/Reminders/Customer-360) is intentionally **deferred** until after
> the team trial run — do go-live first.

## Where the new session should start

The web app has never been deployed. The task is to put it live on
`innovicerp.com` for a 15–20 person team trial. Begin by confirming the **DB
decision** (Phase 0 below), then work Phases 1→7. Re-show the user the
"What I can do now" list at the end.

## Verified current state (2026-06-13)

- **API: ALREADY LIVE on Railway.** `railway.json` builds `apps/api/Dockerfile`;
  Railway's GitHub integration **auto-deploys on every push to `main`** (ADR-010,
  not GitHub Actions). Health: `/health` (liveness), `/readyz` (DB ping). Get the
  exact `*.up.railway.app` host from the Railway service panel.
- **Web: NOT DEPLOYED.** Stack locked to **Cloudflare Pages** (CLAUDE §5).
  Production build **verified locally 2026-06-13**: `pnpm --filter @innovic/web build`
  → `apps/web/dist` (~472 KB gzip main bundle; a chunk-size warning is non-blocking).
- **Web build is self-contained:** `@innovic/shared` is consumed from source
  (vite alias + tsconfig path → `packages/shared/src`), so no separate shared
  build step is needed. The filtered build command works standalone.
- **Web build-time env vars (baked in; all THREE required or the build throws —
  see `apps/web/src/lib/env.ts`):** `VITE_API_URL`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`. (`VITE_SENTRY_DSN` optional.)
- **SPA fallback:** `apps/web/public/_redirects` (`/* /index.html 200`) is
  committed — deep-link refresh works on Pages.
- **API CORS:** `ALLOWED_ORIGINS` is **required in production** — the API
  refuses to boot if unset (`apps/api/src/lib/cors.ts`). We hit this before
  (see DECISIONS / the railway-cors lesson). Must equal the live web origin.
- **DB: a single Supabase project** holds the real data the user entered PLUS
  leftover demo rows (`SO-DEMO-100`, `DEMO-FLG/SHF/BRK` items, smoke users). No
  separate prod project exists. Migrations 0001–0056 in `apps/api/src/db/migrations/`
  — the dev DB has historically lagged the files, so **verify 0056 etc. are
  applied to the live project before launch.**
- **Onboarding:** User Management → **+ Add User** (SYS-2) — admin sets each
  person's initial password.
- **Backups: NOT provisioned** (Backblaze B2). Design is in `RUNBOOK.md`.
- **Monitoring:** Sentry + Better Stack wired but dormant until DSN/env set.

## Phase 0 — The one decision: which DB is "production"

Recommended **Option A** for a trial: promote the current Supabase project (keeps
real data already entered), purge demo rows first after a backup.

- **A — Promote current project, purge demo data (RECOMMENDED):** no migration,
  ~10 min.
- B — Use current project as-is (demo rows visible to team): fastest, but cluttered.
- C — Fresh Mumbai prod project + migrate real data only: cleanest, but days of
  work — overkill for a trial.

## Phase 1 — Database prep (Supabase dashboard + Claude)

1. **Back up first** — confirm Supabase daily backup, or run `pg_dump`.
2. **Purge demo data** (Option A only) — paste **`docs/sql/purge-demo-data.sql`**
   into the Supabase SQL Editor and Run. Soft-deletes (reversible) `SO-DEMO-100`,
   `SO-SMOKE-001`, `JC-DEMO-*`/`JC-SMOKE-001`, `DEMO-*` items, `CLI-DEMO`, and
   linked dispatches/invoices/docs. Review the "purge summary" result (all 0).
   Deactivate any throwaway test logins via System Settings → User Management.
3. **Verify migrations are applied** — paste **`docs/sql/check-migrations.sql`**
   into the SQL Editor and Run. Every row must read PASS (covers the recent,
   highest-lag-risk set 0050–0056). Any MISSING → apply that migration first.

## Phase 2 — Deploy web — ✅ DONE 2026-06-13 (wrangler direct upload)

Done via Cloudflare API token (`cfat_` account token in `.env.local`) + wrangler,
NOT the dashboard Git-connect flow (that needs GitHub OAuth, impossible by token).
Reproduce / redeploy from the repo root:

```bash
# token + account id read from .env.local (gitignored)
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
# prod API URL override lives in .env.production.local (gitignored):
#   VITE_API_URL=https://api-production-06c90.up.railway.app
pnpm --filter @innovic/web build          # bakes prod VITE_* into the bundle
pnpm dlx wrangler@latest pages deploy apps/web/dist \
  --project-name=innovic-erp --branch=main --commit-dirty=true
```

- Project: **innovic-erp** (production branch `main`). Live: **https://innovic-erp.pages.dev**.
- Verified post-build: no `localhost` in the bundle; Railway + Supabase URLs baked in.
- SPA deep-link fallback (`_redirects`) confirmed working (deep route → 200).
- Future deploys: re-run the two commands above, OR add the auto-deploy GitHub
  Action (see Follow-ups) so every push to `main` redeploys.

## Phase 3 — Custom domain (DEFERRED to after the trial)

Domain `innovicerp.com` is registered at **GoDaddy** (not Cloudflare). Trial runs
on `innovic-erp.pages.dev` first to de-risk launch. When ready to attach the domain:
- **Recommended:** move DNS to Cloudflare (change the 2 nameservers at GoDaddy →
  Cloudflare). Free, auto-SSL, apex works, and DNS becomes token-manageable.
  ⚠️ Before the NS switch propagates, confirm Cloudflare imported any existing
  MX/TXT records so email/other services don't break.
- **Alternative:** keep DNS at GoDaddy, add a CNAME to the pages.dev host (apex is
  awkward over CNAME — prefer `www` or GoDaddy forwarding).
- Then: Cloudflare Pages → project → Custom domains → add the domain, AND append
  the new origin to Railway `ALLOWED_ORIGINS` (see Phase 4).

## Phase 4 — Connect API ↔ web (Railway) — ✅ DONE 2026-06-13

`ALLOWED_ORIGINS` on Railway already includes `https://innovic-erp.pages.dev`
(verified 2026-06-13: OPTIONS preflight from that origin returns
`access-control-allow-origin`; a bogus origin returns none → real allowlist, not
a wildcard echo). When the custom domain is added later, append it here too.

## Phase 5 — Onboard the team (in the app — user)

11. Login as admin → User Management → + Add User for each of the 15–20 people
    (admin sets each initial password). Hand out email + password.

### Login & onboarding — USE PASSWORDS, not magic links (lesson 2026-06-13)

The login page offers two modes: **password** (email + password) and **magic link**
(email OTP). **Tell the team to use password login.** Magic link failed on the
first live attempt with `{"code":403,"error_code":"otp_expired"}` because:

- **Email link scanners consume the single-use token before the human clicks.**
  The office runs eScan/Seclore DLP and Gmail also pre-scans links — opening the
  one-time link first burns it, so by the time you click you get `otp_expired`.
- **Magic-link redirect must be allow-listed in Supabase** (see below) or the
  callback to `…pages.dev/auth/callback` never completes.

Password login sidesteps all of it and is what **+ Add User** (SYS-2) was built
for — admin sets each person's initial password, hands out email + password, done.
On the login screen click **"Sign in with password instead"**. Because the trial
runs on the **same Supabase project** used during testing (Option A), existing
credentials work on `…pages.dev` unchanged.

### Supabase Auth URL configuration (do this once — fixes magic link + password-reset emails)

Supabase Dashboard → **Authentication → URL Configuration**. After go-live these
likely still point at `localhost` from dev:

- **Site URL** → `https://innovic-erp.pages.dev`
- **Redirect URLs** (allowlist) → add `https://innovic-erp.pages.dev/auth/callback`
  and `https://innovic-erp.pages.dev/**`

Even with passwords-only, set these now: password-**reset** emails (which the team
will eventually need) redirect through the same allowlist, and will fail the same
way if it's wrong. When the custom domain is added later, add its URLs here too.

## Phase 6 — Smoke test before announcing (user, ~15 min)

12. Admin: login → dashboard tiles → SO create/edit/soft-delete round-trip → no
    console errors.
13. One non-admin role (e.g. operator): RLS hides what it should.
14. Two browsers / a phone.

## Phase 7 — Backups (don't skip for a real trial — Claude + user)

15. **`.github/workflows/backup.yml` is committed** (daily 02:00 IST `pg_dump` →
    B2, manual `workflow_dispatch` for restore drills). User: create a Backblaze
    B2 bucket + app key, set a 30-day lifecycle rule on the bucket, then add the
    GitHub repo secrets `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`,
    `BACKUP_DATABASE_URL` (Supabase **Direct connection** string, port 5432 — not
    the pooler), and optional `BACKUP_HEARTBEAT_URL` (Better Stack). Trigger one
    manual run to confirm before relying on it.

## What Claude can do right now (offer these)

**ALL DONE 2026-06-13** (Option A confirmed) — committed alongside this update:

1. ✅ Demo-data **purge SQL** → `docs/sql/purge-demo-data.sql` (soft-delete, reversible).
2. ✅ **Migration-status checker** → `docs/sql/check-migrations.sql` (0050–0056).
3. ✅ **`backup.yml`** GitHub Action committed (daily `pg_dump` → B2).
4. ✅ Root **`.npmrc`** with `engine-strict=false`.

Remaining is all dashboard work (next section) — Claude has nothing left to build
for the launch itself; the next major Claude task is **CRM, deferred until after
the trial**.

## What only the user can do (dashboard logins Claude lacks)

Cloudflare Pages setup + domain · Railway `ALLOWED_ORIGINS` · Supabase backup ·
Backblaze account.

## Follow-ups beyond MVP launch

- Cloudflare native Git auto-deploy is preferred over a `deploy-web.yml` workflow
  (mirrors how Railway auto-deploys the API — no workflow file needed).
- Activate Sentry + Better Stack (set DSNs / uptime monitor on `/readyz`).
- Region note (non-blocking): Supabase Mumbai + Railway Singapore (~50–80 ms
  cross-region) — fine at this scale.
- After the trial settles: build **CRM** (Leads / Reminders / Customer-360) — the
  last major legacy-parity gap.
