# Migration — Firestore → Supabase Postgres

One-time scripts to dump 67 Firestore collections from the legacy Innovic ERP and load them into Supabase Postgres.

> Used during **Phase 2 (T-013–T-023)** and onwards. Scripts here are throwaway after final cutover (T-052).

## Files (created during T-013/T-014/T-015)

- `export-firestore.ts` — dumps all collections to local JSON
- `transform.ts` — flattens JSON-blob structure to per-record rows, generates UUIDs, maps Firebase auth UIDs → Supabase user IDs
- `load-supabase.ts` — bulk-load to Postgres in foreign-key dependency order
- `validate.ts` — row count + sample comparison against Firestore source

## Conventions

- Every transformation has fixture-based unit tests (CLAUDE.md §9: 100% branch coverage)
- Every load script is idempotent (re-runnable without duplicates)
- Validation report appended to `docs/MIGRATION-LOG.md` after each collection
- All migrations run against staging first, then prod
