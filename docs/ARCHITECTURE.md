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
- **Supabase Realtime** — selective WebSocket delivery for hot screens (Op Entry, Live Operations Board, Machine Status, Task Allocation)

## Authorization Model
3 layers: JWT validation (Fastify) → RLS (Postgres) → Service-level role checks (TypeScript).
Roles: `admin`, `manager`, `operator`, `qc`, `procurement`, `dispatch`, `design`, `viewer`.

## Multi-Tenancy
Every table has `company_id`. RLS enforces isolation. JWT claim `company_id` set on Postgres session via `current_company_id()` helper.

## Realtime Strategy
**Realtime on:** Op Entry, Live Operations Board, Machine Status, Task Allocation.
**Polling elsewhere:** 30s lists, 60s detail screens.

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
