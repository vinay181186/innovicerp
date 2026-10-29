# ARCHITECTURE.md — System Design

## System Diagram

```
Browser (User Device)
   ↓ HTTPS / WebSocket
React SPA (Cloudflare Pages, free)
   ↓
Fastify API (Railway, asia-southeast1 / Singapore — ADR-010)
   ↓ ~50ms RTT
Supabase Pro (Mumbai, ap-south-1)
   Postgres + Auth + Storage + Realtime + Daily backups + 7-day PITR
+ Backblaze B2 (offsite pg_dump, daily 02:00 IST)
+ Sentry (errors), Better Stack (uptime), Resend (transactional email)
```

**Note on API region (ADR-010):** Railway's nearest region is `asia-southeast1` (Singapore), not Mumbai. Round-trip to Supabase Mumbai is ~50 ms, which costs ~150 ms of baseline p95 budget per typical request (1 write + 2 reads). User chose Railway for DX over Fly.io `bom` (Mumbai, <5 ms). If sustained p95 crosses 250 ms, the documented escape hatch is Fly.io Mumbai using the same Dockerfile.

## Component Responsibilities

- **React SPA** — UI only, zero business logic
- **Fastify API** — business logic, validation, authorization, integration; talks to Supabase as its database
- **Supabase Postgres** — single source of truth; RLS-enforced multi-tenancy
- **Supabase Storage** — file uploads with same access policies as DB
- **Supabase Auth** — JWT issuance and validation
- **Supabase Realtime** — live updates: a change to a table in `LIVE_TABLES` refreshes the screens that show it on every PC (ADR-230)

## Authorization Model

3 layers: JWT validation (Fastify) → RLS (Postgres) → Service-level role checks (TypeScript).
Roles: `admin`, `manager`, `operator`, `qc`, `procurement`, `dispatch`, `design`, `viewer`.

## Multi-Tenancy

Every table has `company_id`. RLS enforces isolation. JWT claim `company_id` set on Postgres session via `current_company_id()` helper.

## Live updates (ADR-230 — supersedes ADR-004)

- **One list of live tables:** `LIVE_TABLES` in `packages/shared/src/lib/live-tables.ts`.
- **Table → screens:** `LIVE_TABLE_KEYS` in `apps/web/src/lib/live-updates/table-keys.ts` maps each live table to the TanStack Query key roots it refreshes (typed Record — an unmapped table fails the build).
- **Database:** each live table is in the `supabase_realtime` publication via a hand-written, guarded migration (pattern: `0217_cancel_requests.sql`; newest `0222_day_log.sql`).
- **Flow:** the change message is a doorbell, never data — changes are batched (750 ms quiet, 2 s max), then the mapped keys are invalidated and the screen re-reads through the API. Every (re)connect re-reads what is on screen; a drop shows "Live updates paused" in the top bar.
- **Privacy:** Realtime sends the row to every subscriber that passes the table's RLS SELECT policy — publish only tables whose company-wide read is acceptable.
- **Same PC:** each mutation invalidates its own module's key root and every other module root showing the same data, imported from that module's key factory.
- **Not live:** no default polling. TanStack defaults (`apps/web/src/main.tsx`): staleTime 30 s, refetch on window focus, retry 1. Screens that are not live refresh on open/focus, or set `refetchInterval` (60 s fallback on JC/SO/PO/GRN/PR/PRO lists).
- **Every key root is declared** live / poll / on-open in `REFRESH_POLICY` (`apps/web/src/lib/live-updates/refresh-policy.ts`), checked by `refresh-coverage.test.ts`.

How to build a new page against this: CLAUDE.md §22.

## Performance Targets (at 100 concurrent users)

- p50 API: <100ms · p95: <300ms · p99: <800ms
- Page load (cold): <2s · (warm): <500ms
- DB query: <50ms p95
- Realtime delivery: <500ms

## Backup & Recovery

- Supabase auto: daily, 7-day PITR
- Offsite: `pg_dump` → Backblaze B2 daily 02:00 IST, 30-day retention
- RPO: 24h · RTO: 4h
- Restore drill: first Monday of every month (T-058)

## Data Volume Targets

- Postgres: 5–15 GB
- Storage: 35–45 GB (QC documents, drawings, exports)
- Total: ~50 GB

## Region & Time

- Region: Mumbai (`ap-south-1`)
- Timestamps: stored as `timestamptz` in UTC, displayed as `Asia/Kolkata` IST via `date-fns-tz`
