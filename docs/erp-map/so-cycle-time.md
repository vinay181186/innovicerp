# SO Cycle Time
**Module key:** `so-cycle-time` · **Domain:** Sales & SO Analytics

## Purpose
Read-only cycle-time report: for every Sales Order, the phase-transition durations
(design, production, QC, assembly, total) plus the set averages. Mirrors legacy
`renderSOCycleTime` (L18176).

## Pages / Screens
web routes under `apps/web/src/modules/so-cycle-time/routes/`:
- `page.tsx` — path `so-cycle-time` — SO cycle-time table with averages (filter + search are client-side).

## Database Tables
READ-ONLY. Phase data loaded through the shared helper `lib/so-phase-data` (`loadSoPhaseData(tx, companyId)`), which reads the SO lifecycle tables (sales orders, plans, job cards, ops, QC, assembly, dispatch) to compute per-SO phase timestamps + durations. This module itself declares no tables. Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-cycle-time` — all-SO cycle-time rows + averages.

Access: any authenticated company user; RLS via `withUserContext`.

## Services / Key Functions
`service.ts`:
- `getSoCycleTime(user)` → `SoCycleTimeResponse` — calls `loadSoPhaseData`, maps to `SoCycleTimeRow[]` (phases + durations), computes averages over the full set.
- `average(rows, key)` — private; mean over non-null durations for keys design/production/qc/assembly/total.

## Entry Points
`soCycleTimeRoutes(app)`. Delegates data loading to `lib/so-phase-data` (shared with other phase-based reports).

## Business Logic
- **Durations** per SO: design, production, qc, assembly, total — computed in `loadSoPhaseData` from phase-transition timestamps.
- **Averages** (`averages`): rounded mean per key over all rows where the duration is non-null (rows with a null phase are excluded from that key's average).
- Filtering/search is done client-side; the server-returned averages always cover the full set (legacy recomputes over the filtered set on each render).

## Dependencies on Other Modules
- **`lib/so-phase-data`** — shared phase-timestamp/duration loader (also used by other SO phase reports).

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the SO Cycle Time report.

## Imports / Exports
None.

## Background Jobs
None.
