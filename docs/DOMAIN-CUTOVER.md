# DOMAIN-CUTOVER.md — Moving the ERP onto innovicerp.com

> Doc: CUTOVER-01
> Created: 2026-09-06
> Web version (with tick boxes): https://claude.ai/code/artifact/b9f46759-381c-48b9-8b63-e1315a9cddc4
>
> Plain-English runbook. Work through the OPs in order. Nothing switches until OP-60 —
> everything before it is preparation that can be abandoned with nothing changed.

---

## PROGRESS

| OP | What | Status |
| -- | ---- | ------ |
| OP-10 | Railway — allow new addresses | [x] DONE 2026-09-06, verified by CORS preflight |
| OP-20 | Supabase — auth URLs | [x] DONE 2026-09-06 via Management API, read back and confirmed |
| OP-30 | Cloudflare — claim domain on Pages project | [x] DONE 2026-09-06 — apex + www both registered, both Pending |
| OP-40 | GoDaddy — screenshot current DNS | [x] DONE 2026-09-06 — A, CNAME www, 2x TXT, SOA. Nothing unexpected. |
| OP-50 | Cloudflare — add site + records | [x] DONE 2026-09-06 — zone created, 4 records in, read back and confirmed |
| OP-60 | GoDaddy — switch nameservers (THE SWITCH) | [x] DONE 2026-09-06 — public DNS confirms aurora/felicity.ns.cloudflare.com |
| OP-70 | Verify | [~] LIVE 2026-09-06 — innovicerp.com serves the new ERP (HTTP 200, deep links OK, byte-identical to pages.dev). Supabase Site URL switched to https://innovicerp.com. Remaining: www cert still issuing; user to confirm login + a save. |
| OP-80 | Aftercare | [ ] |

---

## 1. CURRENT STATE (all verified live 2026-09-06, not assumed)

| Item | Value | Meaning |
| ---- | ----- | ------- |
| New ERP | innovic-erp.pages.dev | LIVE — this is real production, not a test site |
| Old ERP | innovicerp.com | LIVE — legacy file dated 29-04-2026, nobody using it |
| Domain controlled by | ns73.domaincontrol.com / ns74.domaincontrol.com | GoDaddy — this is what changes |
| Domain points to | 199.36.158.100 | Google Firebase (old ERP) |
| Email on domain | none (no MX records) | SAFE — nothing to break |
| Cloudflare Pages project | innovic-erp | id 0ae12cdc-d274-45be-a920-2fde07a197c8 |
| Custom domain status | innovicerp.com = PENDING | reason: "CNAME record not set" — correct at this stage |
| Deep-link refresh | /job-cards -> 200 | Working. No _redirects file needed. |
| Supabase project | ctbrlcdwfddhlscnoyos | Mumbai (ap-south-1). ONLY ONE — no staging exists. |
| Railway API | https://api-production-06c90.up.railway.app | |

### The old ERP is not deleted

It keeps two permanent free addresses, both confirmed working, both serving the identical
file byte-for-byte (2,290,944 bytes):

    innovic-erp-v1-77a19.web.app
    innovic-erp-v1-77a19.firebaseapp.com

Its Firebase data is untouched. A copy of the file is in the repo at
`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`.

### FAULT FOUND (unrelated to the domain move)

Supabase **Site URL** was set to `http://localhost:5173`, left over from development.
Password-reset emails have therefore been sending staff to a dead address on their own
machine. Broken all along. Fixed in OP-20.

---

## 2. API TOKENS (lets Claude do and verify the steps)

Create these yourself. **Paste them into the file, never into chat.**

Target file — use this one (it is where the Supabase token went, outside git, safe):

    C:\Innovic_projects\innovic-erp\erp\.env.local

Rules that tripped it up the first time:
- No leading spaces before the name
- No spaces around the `=`
- Each entry on its own line

Finished file should contain:

    SUPABASE_ACCESS_TOKEN=sbp_...     [x] done 2026-09-06, tested OK
    CLOUDFLARE_DNS_TOKEN=...          [ ] token 2 — needed for OP-50
    GODADDY_API_KEY=...               [ ] token 3 — will probably be rejected
    GODADDY_API_SECRET=...            [ ] token 3
    RAILWAY_API_TOKEN=...             [ ] token 4 — for Phase 2 only

### Token 2 — Cloudflare (needed for OP-50)
1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** -> scroll down -> **Get started** next to *Create Custom Token*
3. Name: `claude-dns`
4. Permissions — add three rows:
       Zone    | Zone             | Edit
       Zone    | DNS              | Edit
       Account | Cloudflare Pages | Edit
5. Zone Resources: **Include -> All zones from an account -> <your account>**
6. Continue to summary -> Create Token -> copy it
7. Add line: `CLOUDFLARE_DNS_TOKEN=<paste>`

### Token 3 — GoDaddy (expect rejection)
1. https://developer.godaddy.com/keys — sign in with the account that OWNS innovicerp.com
2. **Create New API Key**
3. Name: `claude-cutover`
4. Environment: **Production** (NOT OTE / Test)
5. Copy BOTH values — the Secret is shown only once
6. Add lines:
       GODADDY_API_KEY=<paste>
       GODADDY_API_SECRET=<paste>

GoDaddy restricted DNS API access to accounts holding 10+ domains (or Discount Domain Club
members). With one domain this will likely return access denied. Takes 30 seconds to test.
If blocked, OP-40 / OP-50 / OP-60 stay manual — about 5 minutes of clicking in total.

### Token 4 — Railway (Phase 2 only, not needed for the domain move)
1. https://railway.app/account/tokens
2. Name: `claude-cutover`
3. If offered a Team / Project dropdown, scope it to the ERP project — narrower is better
4. Create -> copy
5. Add line: `RAILWAY_API_TOKEN=<paste>`

Needed later to create the second API service for the test environment. OP-10 is already
done, so nothing in this cutover depends on it.

### After the cutover
Revoke all four from their dashboards and strip the lines from `.env.local`.
Long-lived production credentials in a file is how accidents happen months later.

---

## OP-10 — RAILWAY — allow the new addresses
**Time: 4 min · Risk: none · STATUS: DONE + VERIFIED**

The step that decides whether the site works or silently fails. If Railway doesn't know
the new address, the ERP opens normally and then fails on every save, list and login.

1. Railway -> project -> **api** service
2. **Variables** tab
3. Edit `ALLOWED_ORIGINS`, set to exactly (one line, no spaces):

       https://innovic-erp.pages.dev,https://innovicerp.com,https://www.innovicerp.com

4. Save. Railway redeploys automatically. Wait for green.

**Keep the pages.dev entry** — it is the fallback address and the Playwright tests use it.

### Verified 2026-09-06 by CORS preflight against the live API

    ALLOWED  https://innovicerp.com
    ALLOWED  https://www.innovicerp.com
    ALLOWED  https://innovic-erp.pages.dev
    BLOCKED  https://not-allowed-example.com

A fake origin is rejected, so it is a real allowlist and not a wildcard echo.

---

## OP-20 — SUPABASE — auth URLs
**Time: 4 min · Risk: none**

Reset emails carry a link back into the ERP. If the address isn't allow-listed, staff
click the link and land on a dead page.

Supabase -> project -> **Authentication** -> **URL Configuration**

**Site URL** — set to:

    https://innovic-erp.pages.dev

NOT innovicerp.com. That domain isn't live yet; pointing there now would swap one dead
link for another. It changes to the .com in OP-70.

**Redirect URLs** — add these, keep whatever is already there:

    https://innovicerp.com/**
    https://innovicerp.com/auth/callback
    https://www.innovicerp.com/**
    https://innovic-erp.pages.dev/**
    https://innovic-erp.pages.dev/auth/callback

**Then test:** trigger a password reset on your own account. The link should now work.
That fixes a fault that has nothing to do with the domain move.

---

## OP-30 — CLOUDFLARE — claim the domain on the Pages project
**Time: 2 min · Risk: none · STATUS: apex already added**

1. Cloudflare -> **Workers & Pages** -> project `innovic-erp` -> **Custom domains**
2. `innovicerp.com` should already be listed as **Pending**, reason "CNAME record not set".
   That is correct and expected at this stage.
3. Click **Set up a custom domain** and add `www.innovicerp.com` as well.

**Verify:** two entries, both Pending. They go green by themselves after OP-60.

---

## OP-40 — GODADDY — screenshot the current DNS
**Time: 3 min · Risk: none**

This is the undo button.

1. GoDaddy -> My Products -> `innovicerp.com` -> **DNS**
2. Screenshot every record. Scroll and capture all of it.
3. Keep it somewhere findable today.

Publicly visible right now — your screenshot should match:

    A     @    199.36.158.100
    TXT   @    hosting-site=innovic-erp-v1-77a19
    TXT   @    BeguIbkdM4u5BGhvUd9QLaQKstkx2umc-ZM5ScLUT84
    MX         (none)

If anything else appears — an extra CNAME, a subdomain, an SPF record — stop and check it
before continuing. Something else may be using the domain.

---

## OP-50 — CLOUDFLARE — add the site and check the import
**Time: 8 min · Risk: care needed, but nothing goes live**

Cloudflare needs the domain's settings before GoDaddy hands it over. Nothing activates here.

1. Cloudflare -> **Add a site** -> `innovicerp.com` -> **Free** plan
2. Cloudflare scans GoDaddy and copies records across.
   **Compare against your OP-40 screenshot, line by line.**
3. **Keep both TXT records.**
4. **Delete the A record** pointing to `199.36.158.100` — that is the old ERP. Cloudflare
   creates the correct record for the new one automatically.
5. Cloudflare shows you **two nameservers**. Write them down — needed in OP-60:

       something.ns.cloudflare.com
       somethingelse.ns.cloudflare.com

**Verify:** both TXT records present, old A record gone, two nameservers written down.
Domain shows "Pending nameserver update" — correct.

---

## GATE — stop and check before OP-60

Everything above is reversible and invisible to staff. Next operation is the real switch.

- [ ] OP-10 done — Railway shows the new addresses, deploy green
- [ ] OP-20 done — Supabase redirect list updated, Site URL fixed
- [ ] OP-40 done — GoDaddy screenshot saved
- [ ] OP-50 done — Cloudflare imported records, two nameservers written down

**Do OP-60 in the evening or on a Sunday. Not 11am on a working day.**

---

## OP-60 — GODADDY — hand the domain to Cloudflare
**Time: 5 min · THIS IS THE SWITCH**

Two lines change. This is the entire cutover.

1. GoDaddy -> `innovicerp.com` -> **DNS** -> **Nameservers** -> **Change**
2. Choose **"I'll use my own nameservers"**
3. Replace both entries:

       REMOVE   ns73.domaincontrol.com
                ns74.domaincontrol.com

       ENTER    aurora.ns.cloudflare.com
                felicity.ns.cloudflare.com

Cloudflare zone id: 7173d2eebe6c906e50b69454f78ea706 (created 2026-09-06)

Records already waiting in Cloudflare (verified by read-back):

       CNAME  innovicerp.com      -> innovic-erp.pages.dev   proxied
       CNAME  www.innovicerp.com  -> innovic-erp.pages.dev   proxied
       TXT    innovicerp.com      -> hosting-site=innovic-erp-v1-77a19
       TXT    innovicerp.com      -> BeguIbkdM4u5BGhvUd9QLaQKstkx2umc-ZM5ScLUT84

The old Firebase A record (199.36.158.100) was deliberately NOT carried over — that is what
moves the .com off the old ERP and onto the new one.

GoDaddy warns that changing nameservers can affect services on the domain. That warning is
generic. There is no email and no other service on this domain, so the only thing affected
is the website — which is the point.

**Then wait.** Usually 1–4 hours, occasionally up to 24. Cloudflare emails when active.
During the wait some people may still reach the old ERP. Normal and harmless.

---

## OP-70 — VERIFY
**Time: 10 min**

Test in this exact order. The first failure tells you where the problem is.

1. **Cloudflare shows Active** — Pages -> Custom domains -> both green, not Pending
2. **Site opens** — type `innovicerp.com`, new ERP appears, address bar stays on innovicerp.com
3. **Login works** — if this fails, it is OP-10. Go back to Railway.
4. **Data saves** — open a Job Card, change something, save. Proves the server accepts the
   new address.
5. **Refresh an inner page** — open a Job Card detail, press F5. Should reload, not error.
6. **Padlock present** — secure connection, no warning
7. **Change Supabase Site URL** -> `https://innovicerp.com` (deliberately left until now)
8. **Old address still works** — `innovic-erp.pages.dev` still opens the same ERP.
   Keep it alive as the fallback.

---

## OP-80 — AFTERCARE
**Not urgent. Do in the days after.**

- Tell staff the new address. Old pages.dev bookmarks keep working — nobody is stranded.
- Three files still point at the old address and need updating:
      apps/web/playwright.pages.config.ts     (BASE_URL)
      apps/web/.playwright/auth.json          (origin)
      docs/GO_LIVE.md                         (Phase 3 says "deferred")
  Ask Claude to do these.
- Note the old ERP's new home somewhere findable: `innovic-erp-v1-77a19.web.app`
- Leave the Firebase project alone. Costs nothing, it is the long-term archive.
- Revoke the API tokens created in section 2 and strip them from `.env.local`.

---

## IF SOMETHING GOES WRONG

**Site opens but nothing saves, or login fails**
Almost always OP-10. Check `ALLOWED_ORIGINS` in Railway for a typo, a space after a comma,
or a missing `https://`.

**Cloudflare stays Pending for more than a day**
The nameservers at GoDaddy didn't save. Reopen GoDaddy and confirm both lines took.

**Put everything back**
In GoDaddy set nameservers back to `ns73.domaincontrol.com` and `ns74.domaincontrol.com`,
then restore records from the OP-40 screenshot. Old ERP returns within a few hours.

**The ERP itself is never at risk.** None of these steps touch the database or the code.
The system stays reachable at `innovic-erp.pages.dev` throughout.

---

## PHASE 2 — SEPARATE TEST DATABASE (in progress, started 2026-09-06)

Decisions taken by the user:
- Test data: **EMPTY** (structure only, no copy of production data)
- Supabase tier: **FREE** (pauses after ~7 days idle; upgradeable later without rebuilding)
- Test URL: **innovic-erp.pages.dev** — the user chose this over a new subdomain, which means
  production must move to a NEW Pages project (see Stage 2/3).

### Stage progress

| Stage | What | Status |
| ----- | ---- | ------ |
| 1a | Create test Supabase project | [x] DONE — `uitsrhyulidubnddzcex`, INNOVICERP-TEST, ap-south-1, free |
| 1b | Apply all 124 migrations | [x] DONE — verified identical to prod (see below) |
| 1c | Create Railway service `api-test` | [x] DONE — https://api-test-production-19ca.up.railway.app, /readyz db:up, sees 0 job_cards vs prod 13 |
| 2 | New Cloudflare Pages project for PRODUCTION | [x] DONE — `innovic-erp-prod`, built from clean worktree at 843ba3c |
| 3 | Move innovicerp.com onto it | [x] DONE — detach+attach+DNS repoint in 6.2s, domain `active` |
| 4 | Repoint innovic-erp.pages.dev at the test API | [x] DONE — test bundle deployed, zero production refs |
| 5 | Lock down origins + auth URLs both sides | [x] DONE — CORS isolation verified both directions |
| 6 | Seed the test system so it is usable | [x] DONE — company + admin created, no email sent |

## PHASE 2 COMPLETE — final verified state (2026-09-06)

    PRODUCTION                                TEST
    innovicerp.com                            innovic-erp.pages.dev
    www.innovicerp.com                        
    innovic-erp-prod.pages.dev (fallback)     
      |                                         |
    Pages  innovic-erp-prod                   Pages  innovic-erp
    API    api-production-06c90               API    api-test-production-19ca
    DB     ctbrlcdwfddhlscnoyos               DB     uitsrhyulidubnddzcex
    13 job cards, 13 SOs, 46 items            0 rows everywhere

### Isolation proof (CORS preflight against the live APIs)

    PRODUCTION API   ALLOW  innovicerp.com / www / innovic-erp-prod.pages.dev
                     REJECT innovic-erp.pages.dev
    TEST API         ALLOW  innovic-erp.pages.dev
                     REJECT innovicerp.com

### Supabase auth, after lockdown

    PROD  site_url https://innovicerp.com
          allow    localhost:5173/**, innovicerp.com/**, www.innovicerp.com/**,
                   innovic-erp-prod.pages.dev/**
    TEST  site_url https://innovic-erp.pages.dev
          allow    localhost:5173/**, innovic-erp.pages.dev/**

### Test login

    email     innovic.technology@gmail.com
    password  see TEST_ADMIN_PASSWORD in erp/.env.local
    company   Innovic Technology (seeded)

Created with a password directly via the Supabase admin API rather than the seed script's
magic-link invite — GO_LIVE.md records that office email scanners consume magic links before
the human clicks them.

## DEPLOY SPLIT — branch per environment (2026-09-07)

    push to `test`  ->  innovic-erp.pages.dev  + Railway api-test   (test data)
    push to `main`  ->  innovicerp.com         + Railway api        (real data)

| Piece | main -> PRODUCTION | test -> TEST |
| ----- | ------------------ | ------------ |
| Railway | service `api` watches `main` | service `api-test` watches `test` (set via `serviceConnect`) |
| Web | `.github/workflows/deploy-web.yml` -> project `innovic-erp-prod` | `.github/workflows/deploy-web-test.yml` -> project `innovic-erp` |

Committed as `5f206fb` on the `test` branch. Verified 2026-09-07: pushing `5f206fb` to `test`
deployed Railway `api-test` and Pages `innovic-erp`, while Railway `api` and Pages
`innovic-erp-prod` both stayed on `843ba3c`.

The test workflow hard-codes its `VITE_*` values rather than using GitHub secrets — they are
public-safe (they ship inside the browser bundle regardless) and address only the test stack.
It also fails the build if `ctbrlcdwfddhlscnoyos` or `api-production-06c90` ever appear in the
test bundle.

### CLOSED 2026-09-07 — merge commit `0b07ba1` landed the split on `main`

Verified from GitHub after the push:

    main: deploy-web.yml       branches:[main]  -> project innovic-erp-prod  (production)
    main: deploy-web-test.yml  branches:[test]  -> project innovic-erp       (test)

Merged with `[skip ci]` so that landing a config-only change would not redeploy production.
Workflow files only — zero files under `apps/` or `packages/`.

### `[skip ci]` works for GitHub Actions but NOT for Railway

GitHub Actions honoured it (no workflow run for `0b07ba1`). **Railway ignored it and redeployed
the production API anyway** — deployment of `0b07ba1` went SUCCESS, `/health` 200 throughout, no
downtime seen. Harmless here because the commit changed no application code, but do not rely on
`[skip ci]` to hold Railway back. If a Railway redeploy must genuinely be avoided, disable the
service's GitHub trigger first, or stage the change on `test` and merge when a production deploy
is acceptable anyway.

### Standing rule (user, 2026-09-07)

Deploy edits to the TEST stack only. Production deploys happen only when the user explicitly
asks. Treat any push to `main` as a production deploy.

### Wrangler needs Node 22+; this machine has Node 20

`pnpm dlx wrangler@latest` refuses to run. `pnpm dlx wrangler@3` works and was used for both
deploys. CI is unaffected (it runs Node 24).

### Test environment IDs

    Supabase project   uitsrhyulidubnddzcex  (INNOVICERP-TEST)
    Railway service    76a3be90-f365-4db6-a2d8-26b176bd27c8  (api-test)
    Test API URL       https://api-test-production-19ca.up.railway.app
    Pages project      innovic-erp        -> becomes TEST at stage 4
    Pages project      innovic-erp-prod   -> becomes PRODUCTION at stage 3

Test API `ALLOWED_ORIGINS` is set to `https://innovic-erp.pages.dev` ONLY. The production
domain is deliberately absent so the test site can never reach real data.

### Builds must come from a CLEAN checkout

The working tree had 16 uncommitted files including app code
(`apps/web/src/modules/delivery-challans/routes/list.tsx`) from the user's parallel terminal.
Building there would have shipped unreviewed work to production. Both bundles are built in a
throwaway git worktree at the committed HEAD instead:

    git worktree add --detach <temp> HEAD
    cp .env.local .env.production.local <temp>/
    pnpm install --frozen-lockfile
    pnpm --filter @innovic/web build

Remove it afterwards with `git worktree remove <temp> --force`.

### Stage 1b verification (2026-09-06)

    TABLES    test 99    prod 99
    COLUMNS   test 1661  prod 1661
    POLICIES  test 194   prod 194

Structure is an exact match; the test database holds no rows.

### How the migrations were actually applied — READ THIS BEFORE REPEATING

`drizzle-kit migrate` does NOT work on this repo (no `meta/_journal.json` — see
`apps/api/src/db/migrations/README.md`). The project runner `apply-sql.ts` works but drives one
statement per round trip to Mumbai; it managed 24 of 124 files in ~10 minutes and then hung at
95% CPU and had to be killed.

What worked: POST each `.sql` file whole to the Supabase Management API
`/v1/projects/<ref>/database/query`. The `--> statement-breakpoint` markers are ordinary SQL
comments, so files can be sent unmodified. All 100 remaining files applied in under a minute.

Gotcha: Python's default `urllib` User-Agent is blocked by Cloudflare in front of the Supabase
API and every request returns `error code: 1010`. Set `User-Agent: curl/8.4.0` and it works.
Script kept at `scratchpad/apply_rest.py`.

### Credentials (in `C:\Innovic_projects\innovic-erp\erp\.env.local`)

    SUPABASE_TEST_DB_PASSWORD
    TEST_SUPABASE_URL
    TEST_SUPABASE_ANON_KEY
    TEST_SUPABASE_SERVICE_ROLE_KEY
    TEST_DATABASE_URL           (session pooler, port 5432 — migrations)
    TEST_DATABASE_URL_POOLED    (transaction pooler, port 6543 — the API)

Still needed for the test API: the test project's JWT secret (dashboard → Settings → API).

### Original outline (unchanged)

Goal:

    innovicerp.com          -> PRODUCTION  -> Supabase ctbrlcdwfddhlscnoyos (real data)
    innovic-erp.pages.dev   -> TEST        -> new Supabase project (safe to break)

Both URLs stay live permanently. The .dev is never switched off — it gets repointed.

**Structural note:** `innovic-erp.pages.dev` is permanently attached to the Cloudflare
project named `innovic-erp` and cannot be moved. So the existing project becomes TEST, and
a NEW Pages project is created for PRODUCTION and takes innovicerp.com. Costs one extra
10-minute step later — cheap, because the slow one-way part (nameservers) happens once.

What must be built:
1. Second Supabase project (Mumbai)
2. Run all migrations on it
3. Second Railway service `api-test` pointing at the test database
4. Second Cloudflare Pages project for production
5. Split the deploy workflow: `main` -> production, `test` branch -> test
6. Remove `pages.dev` from the PRODUCTION `ALLOWED_ORIGINS` so test can never reach real data

Things that surprise people:
- **Staff logins will not exist in test.** Logins live in the database. New database, new
  logins. Either create a few test accounts or copy the real ones across.
- **Test must not send emails**, or a reset in test lands in a real employee's inbox.
- **Uploaded files don't come across.** Drawings, QC photos and attachments live in Supabase
  Storage. Test starts with an empty file store unless deliberately copied.

Effort ~1 day. Cloudflare free; Railway second service a few dollars a month; Supabase free
tier works but **pauses after ~7 days idle** and needs waking.

Open decisions:
1. Test data — empty, or a copy of production?
2. Supabase free (pauses) or paid (always on)?

### UNTIL PHASE 2 IS FINISHED

`innovic-erp.pages.dev` is **LIVE PRODUCTION**. Testing on it edits real data that staff
see on the .com immediately. Tell anyone who has the link.
