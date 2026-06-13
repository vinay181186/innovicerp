# GO_LIVE.md — Trial-run deployment runbook

> **READ THIS on a "resume" / "go live" / "deploy" request.** This file is the
> source of truth for the trial-run deployment (it lives in the repo, so it
> travels to any machine via git — unlike the local `.claude` auto-memory).
>
> Status: **planned, not yet executed.** Last updated 2026-06-13.
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
2. **Purge demo data** (Option A only) — Claude generates the SQL (`SO-DEMO-100`,
   `DEMO-*` items, smoke users).
3. **Verify migrations 0001–0056 are all applied** to the live project — Claude
   can write a quick checker.

## Phase 2 — Deploy web (Cloudflare dashboard — user)

4. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → repo
   `vinay181186/innovicerp`, branch `main`.
5. Build settings (pnpm monorepo):
   - Build command: `pnpm --filter @innovic/web build`
   - Build output directory: `apps/web/dist`
   - Root directory: `/`
6. Build environment variables:
   - `VITE_API_URL` = Railway API URL (`https://<service>.up.railway.app`)
   - `VITE_SUPABASE_URL` = prod project URL
   - `VITE_SUPABASE_ANON_KEY` = prod project anon key
   - `NODE_VERSION` = `22` (repo declares Node 24, but the WEB build doesn't need
     it and Cloudflare's image tops out lower. If install fails an engine check,
     add a root `.npmrc` with `engine-strict=false` — there is none today.)
7. Deploy → get the `*.pages.dev` URL.

## Phase 3 — Domain (Cloudflare — user)

8. Pages → Custom domains → add `innovicerp.com` (recommended: root, one URL for
   the team). DNS already on Cloudflare = couple clicks + auto SSL; else add the
   CNAME at the registrar.
9. Keep the API on its Railway URL for the trial (skip `api.innovicerp.com`).

## Phase 4 — Connect API ↔ web (Railway — user) ⚠️ CRITICAL

10. Railway → API service → Variables → set
    `ALLOWED_ORIGINS=https://innovicerp.com` (add `https://www.innovicerp.com` if
    used). API will not boot in prod without it. Railway auto-redeploys on save.

## Phase 5 — Onboard the team (in the app — user)

11. Login as admin → User Management → + Add User for each of the 15–20 people
    (admin sets each initial password). Hand out email + password.

## Phase 6 — Smoke test before announcing (user, ~15 min)

12. Admin: login → dashboard tiles → SO create/edit/soft-delete round-trip → no
    console errors.
13. One non-admin role (e.g. operator): RLS hides what it should.
14. Two browsers / a phone.

## Phase 7 — Backups (don't skip for a real trial — Claude + user)

15. Create a Backblaze B2 bucket + app key. Claude commits
    `.github/workflows/backup.yml` (design in `RUNBOOK.md`); user adds GitHub
    secrets (`B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `BACKUP_DATABASE_URL`,
    `BACKUP_HEARTBEAT_URL`). Daily `pg_dump` → B2.

## What Claude can do right now (offer these)

1. Demo-data **purge SQL** (after Option A confirmed).
2. **Migration-status checker** (confirm 0001–0056 on the live DB before launch).
3. Commit the **`backup.yml`** GitHub Action.
4. Add the **`.npmrc`** `engine-strict=false` guard preemptively.

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
