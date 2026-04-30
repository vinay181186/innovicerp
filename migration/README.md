# Migration — Firestore → Supabase Postgres

One-time scripts to dump 67 Firestore collections from the legacy Innovic ERP and load them into Supabase Postgres.

> Used during **Phase 2 (T-013–T-023)** and onwards. Scripts here are throwaway after final cutover (T-052).

## Files

- `export-firestore.ts` — **T-013** — dumps all 67 collection docs from Firestore to `migration/export/<collection>.json`, plus singletons (`_settings.json`, `_company.json`) and a `_manifest.json` with hashes + anomalies.
- `transform.ts` — **T-014** (not yet built) — flattens the JSON-blob structure to per-record rows, generates UUIDs, maps Firebase auth UIDs → Supabase user IDs.
- `load-supabase.ts` — **T-015** (not yet built) — bulk-loads to Postgres in foreign-key dependency order.
- `validate.ts` — **T-023** (not yet built) — row count + sample comparison against Firestore source.

## Source schema (legacy Firestore)

Project: **`innovic-erp-v1-77a19`**.
Single root collection: **`innovic`** (the `COMPANY_ID`).
Each "collection name" is a single doc under that root with this shape:

```ts
{
  records: string,    // JSON-stringified array of records — the JSON-blob anti-pattern
  updatedAt: Timestamp
}
```

Plus two singletons:
- `innovic/_settings` — settings + meta blobs (similar shape)
- `companies/innovic` — company metadata

The 67 collection names live in `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` lines 585–595 and are mirrored verbatim in `export-firestore.ts`'s `COLLECTIONS` array.

## Setup (T-013)

### 1. Generate a Firebase service account key

1. Open `https://console.firebase.google.com/project/innovic-erp-v1-77a19/settings/serviceaccounts/adminsdk`
2. Click **Generate new private key** → confirm
3. Save the JSON file. Two safe locations:
   - **Outside the repo** (recommended for production-class secrets), e.g. `C:\secrets\innovic-firebase-key.json`
   - **At the repo root** — `.gitignore` covers `*-firebase-adminsdk-*.json` and `firebase-service-account*.json`, so Google's default filename is safe. **Never** put it under `migration/` or anywhere else not covered by `.gitignore`.

### 2. Set env vars

In `.env.local` at the repo root (already gitignored):

```
FIREBASE_PROJECT_ID=innovic-erp-v1-77a19
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/firebase-service-account.json
```

The path must be absolute (or resolvable from the migration script's CWD).

### 3. Install workspace deps

From the repo root:

```
pnpm install
```

This pulls in `firebase-admin` for the migration package.

## Running the export

### Full dump (all 67 collections + 2 singletons)

```
pnpm migrate:export
```

Output → `migration/export/`:
- `<collection>.json` × 67
- `_settings.json`, `_company.json`
- `_manifest.json` (hashes, record counts, anomalies)

The export directory is gitignored.

### Incremental (one or more named collections)

```
pnpm --filter @innovic/migration export -- --only=salesOrders,jobCards
```

The `--only` flag skips singletons and only re-dumps the listed collections. Useful for retrying a single failed collection without re-pulling 50 GB.

## Output file shape

Each collection file:

```json
{
  "collection": "salesOrders",
  "exportedAt": "2026-04-30T15:00:00.000Z",
  "sourcePath": "innovic/salesOrders",
  "docExists": true,
  "updatedAt": "2026-04-29T...",
  "recordCount": 142,
  "anomalies": [],
  "records": [ ... ]
}
```

`anomalies` may include:
- `doc_missing` — Firestore doc didn't exist (collection never written by the legacy app)
- `records_field_absent` — doc exists but no `records` field
- `records_not_string` — `records` is some other type (shouldn't happen under the JSON-blob convention)
- `records_not_array` — `records` parsed to something other than an array
- `records_parse_error: ...` — JSON.parse threw

The `_manifest.json` aggregates all anomalies for a single-glance audit.

## Logs

The script emits one JSON line per significant event (`collection_exported`, `singleton_exported`, `export_complete`, etc.). Pipe to `jq` for pretty output:

```
pnpm migrate:export | jq -c .
```

## Conventions (carry into T-014/T-015)

- Every transformation has fixture-based unit tests (CLAUDE.md §9: 100% branch coverage)
- Every load script is idempotent (re-runnable without duplicates)
- Validation report appended to `docs/MIGRATION-LOG.md` after each collection
- All migrations run against staging first, then prod
