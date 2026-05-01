// Phase B: generic bulk loader for transform-output tables.
//
// Used by Phase 2 (T-015 — items/clients/vendors/machines/operators) AND
// Phase 3 (T-024d — route_cards/route_card_ops/route_card_revisions/job_cards/
// jc_ops/op_log/running_ops). Each table declares its own conflict target
// and audit shape.
//
// Shared invariants:
//   - companyId injected (single seed company today)
//   - id present in transform output (deterministic UUIDv5)
//   - input rows carry _legacyId / _legacyExtras to be stripped before INSERT
//   - inserts batched, ON CONFLICT DO NOTHING for idempotent re-runs
//
// Anomalies and validation come from the transform layer — this loader is a
// dumb pipe with audit injection + conflict handling.

import { rawSql } from './db';
import type { LoadResult } from './types';

export type AuditShape = 'full' | 'created_only' | 'none';

export interface BulkLoadConfig<T extends { _legacyId: string }> {
  table: string;
  rows: T[];
  companyId: string;
  adminUserId: string;
  /** Map a transformed row to the column => value pairs we send to Postgres
   *  (excluding company_id and audit columns — loader injects those).
   *  Return null to skip a row (e.g. unresolved FK). */
  toRow: (row: T) => Record<string, unknown> | null;
  /** SQL fragment after `ON CONFLICT`. Default `(company_id, code) WHERE
   *  deleted_at IS NULL` matches the Phase 2 master-table pattern. Phase 3
   *  uses table-specific targets (e.g. `(route_card_id, op_seq) WHERE
   *  deleted_at IS NULL`, or `(id)` for tables without a business unique key). */
  conflictTarget?: string;
  /** Which audit columns to inject. `full` = created_by + updated_by (the
   *  Phase 2 default). `created_only` for immutable append-only tables
   *  (op_log, route_card_revisions). `none` for tables that have no audit
   *  columns at all. */
  auditColumns?: AuditShape;
}

const BATCH_SIZE = 100;
const DEFAULT_CONFLICT_TARGET = '(company_id, code) WHERE deleted_at IS NULL';

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

  const audit: AuditShape = cfg.auditColumns ?? 'full';
  const conflictTarget = cfg.conflictTarget ?? DEFAULT_CONFLICT_TARGET;

  const enriched: Record<string, unknown>[] = [];
  for (const row of cfg.rows) {
    const mapped = cfg.toRow(row);
    if (!mapped) {
      result.notes.push(`row_skipped:${row._legacyId}`);
      continue;
    }
    const enrichedRow: Record<string, unknown> = {
      ...mapped,
      company_id: cfg.companyId,
    };
    if (audit === 'full') {
      enrichedRow['created_by'] = cfg.adminUserId;
      enrichedRow['updated_by'] = cfg.adminUserId;
    } else if (audit === 'created_only') {
      enrichedRow['created_by'] = cfg.adminUserId;
    }
    enriched.push(enrichedRow);
  }

  result.attempted = enriched.length;

  if (dryRun) {
    result.notes.push('dry_run_no_writes');
    return result;
  }

  for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
    const batch = enriched.slice(i, i + BATCH_SIZE);
    const inserted = await rawSql`
      INSERT INTO ${rawSql(cfg.table)} ${rawSql(batch)}
      ON CONFLICT ${rawSql.unsafe(conflictTarget)} DO NOTHING
      RETURNING id
    `;
    result.inserted += inserted.count;
    result.conflicts += batch.length - inserted.count;
  }

  return result;
}
