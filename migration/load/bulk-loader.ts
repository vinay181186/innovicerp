// Phase B: generic bulk loader for master-data tables.
//
// One function handles items / clients / vendors / machines / operators
// because all five share the same shape requirements:
//   - companyId injected (single seed company today)
//   - createdBy / updatedBy injected (seed admin)
//   - id present in transform output (deterministic UUIDv5)
//   - all input rows carry _legacyId / _legacyExtras to be stripped before INSERT
//   - on conflict (company_id, code) do nothing (idempotent re-runs)
//
// Anomalies and validation come from the transform layer — this loader is a
// dumb pipe with audit injection + conflict handling.

import { rawSql } from './db';
import type { LoadResult } from './types';

export interface BulkLoadConfig<T extends { _legacyId: string }> {
  table: 'items' | 'clients' | 'vendors' | 'machines' | 'operators';
  rows: T[];
  companyId: string;
  adminUserId: string;
  /** Map a transformed row to the column => value pairs we send to Postgres
   *  (excluding companyId, createdBy, updatedBy — the loader injects those).
   *  Return null to skip a row (e.g. unresolved FK). */
  toRow: (row: T) => Record<string, unknown> | null;
}

const BATCH_SIZE = 100;

export async function bulkLoad<T extends { _legacyId: string }>(
  cfg: BulkLoadConfig<T>,
  dryRun: boolean,
): Promise<LoadResult> {
  const result: LoadResult = {
    table: cfg.table,
    attempted: 0,
    inserted: 0,
    conflicts: 0,
    dryRun,
    notes: [],
  };

  if (cfg.rows.length === 0) {
    result.notes.push('no_rows');
    return result;
  }

  // Build the rows we'll send.
  const enriched: Record<string, unknown>[] = [];
  for (const row of cfg.rows) {
    const mapped = cfg.toRow(row);
    if (!mapped) {
      result.notes.push(`row_skipped:${row._legacyId}`);
      continue;
    }
    enriched.push({
      ...mapped,
      company_id: cfg.companyId,
      created_by: cfg.adminUserId,
      updated_by: cfg.adminUserId,
    });
  }

  result.attempted = enriched.length;

  if (dryRun) {
    result.notes.push('dry_run_no_writes');
    return result;
  }

  // Insert in batches of 100, with on-conflict-do-nothing per (company_id, code).
  for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
    const batch = enriched.slice(i, i + BATCH_SIZE);
    const inserted = await rawSql`
      INSERT INTO ${rawSql(cfg.table)} ${rawSql(batch)}
      ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO NOTHING
      RETURNING id
    `;
    result.inserted += inserted.count;
    result.conflicts += batch.length - inserted.count;
  }

  return result;
}
