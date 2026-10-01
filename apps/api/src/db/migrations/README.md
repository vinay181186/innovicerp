# Database migrations — how this project actually works

**Migrations here are hand-authored raw SQL files, applied manually. `drizzle-kit generate` and `drizzle-kit migrate` are NOT the mechanism — do not use them to author or apply migrations.**

## Why (the history)
`drizzle-kit migrate` was used only for the first few migrations and then abandoned:
the DB's `drizzle.__drizzle_migrations` tracking table holds ~5 rows while there are
70+ `.sql` files here. The old `drizzle-kit` metadata (`meta/_journal.json` + per-migration
snapshots) had gone badly out of sync — it stopped around `0015`, skipped indices, contained
duplicate tags, and was missing ~50 snapshots. Because drizzle numbers new migrations from its
journal index (not from the on-disk file numbers, which had diverged), running
`drizzle-kit generate` produced a **colliding, mis-numbered file** (e.g. a second `0016_…`).

The ~50 missing historical snapshots cannot be reconstructed, so the metadata was removed rather
than left as a trap. The `.sql` files below are the real, authoritative migration history.

## How to add a migration
1. Create `NNNN_short_description.sql` with the **next free number**: list this folder and take
   the highest number + 1 (do not trust a number written in any doc — parallel branches add files).
   Some historical numbers have two files; ignore that — just continue past the highest number.
   Separate statements with `--> statement-breakpoint`.
2. Write plain SQL. Prefer idempotent, safe statements:
   - Views: `CREATE OR REPLACE VIEW …` when the column set is unchanged (no drop, dependents safe).
   - Tables/columns: `… IF NOT EXISTS` / `IF EXISTS` where possible.
   - Wrap multi-statement changes so a failure can't leave a half-applied state.
3. Keep `apps/api/src/db/schema.ts` (the Drizzle table definitions) in sync by hand so the ORM
   types match the DB.

## How to apply a migration
Use the project's own runner, `apps/api/src/db/apply-sql.ts` (its header is the authority). It
splits on `--> statement-breakpoint`, runs the file in ONE transaction (unless the file carries
`-- no-transaction`, has its own `BEGIN;`/`COMMIT;`, or adds an enum value), and records the file
in `public.schema_migrations`. **`DB_TARGET` is required** and the run is refused when
`DATABASE_URL` is not the project it names (TEST = `uitsrhyulidubnddzcex`,
PROD = `ctbrlcdwfddhlscnoyos`):

```
DB_TARGET=TEST pnpm --filter @innovic/api exec dotenv -e <test.env> -- tsx src/db/apply-sql.ts src/db/migrations/NNNN_x.sql
DB_TARGET=PROD pnpm --filter @innovic/api exec dotenv -e <prod.env> -- tsx src/db/apply-sql.ts src/db/migrations/NNNN_x.sql
```

(`--target TEST|PROD|LOCAL` anywhere in the arguments works instead of the env var.)

TEST and PROD are **separate databases** — every migration runs on both. Apply to TEST first,
verify, then PROD. PROD migrations ship through the release script
(`release/release-prod.sh`), which applies every migration on `test` but not on `main` before it
merges. Code deploys and DB migrations are separate actions: a migration the code depends on must
be on the database **before** that code deploys.

## What NOT to do
- Do **not** run `pnpm --filter api db:migrate` or `db:generate` expecting them to work — they
  rely on the removed metadata and will mis-number or fail.
- Do **not** re-add a `meta/` journal unless you are deliberately re-adopting drizzle-kit-driven
  migrations (a full squash/baseline reset), which is a separate, deliberate decision.
