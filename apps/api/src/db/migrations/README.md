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
1. Create `NNNN_short_description.sql` with the **next number** — the current highest is `0062`,
   so the next new file is `0063_…`. (Some historical numbers have two files; ignore that — just
   continue past the highest number.)
2. Write plain SQL. Prefer idempotent, safe statements:
   - Views: `CREATE OR REPLACE VIEW …` when the column set is unchanged (no drop, dependents safe).
   - Tables/columns: `… IF NOT EXISTS` / `IF EXISTS` where possible.
   - Wrap multi-statement changes so a failure can't leave a half-applied state.
3. Keep `apps/api/src/db/schema.ts` (the Drizzle table definitions) in sync by hand so the ORM
   types match the DB.

## How to apply a migration
Use the project's own runner, `apps/api/src/db/apply-sql.ts` (splits on `--> statement-breakpoint`
and executes each statement against `DATABASE_URL`):

```
pnpm --filter api exec dotenv -e <path-to-env> -- tsx src/db/apply-sql.ts src/db/migrations/00NN_x.sql
```

Point `-e` at an env file whose `DATABASE_URL` targets the intended database. Apply to **dev first**,
verify, then apply the same file to production. There is no automatic migration step in the
Railway/Cloudflare deploy — code deploys and DB migrations are separate, manual actions.

## What NOT to do
- Do **not** run `pnpm --filter api db:migrate` or `db:generate` expecting them to work — they
  rely on the removed metadata and will mis-number or fail.
- Do **not** re-add a `meta/` journal unless you are deliberately re-adopting drizzle-kit-driven
  migrations (a full squash/baseline reset), which is a separate, deliberate decision.
