// Phase C: post-load validation.
//
// For each loaded table:
//   - SELECT count(*) FROM <table> WHERE company_id = $1 AND deleted_at IS NULL
//   - sample N rows (default 3) and dump shape
//   - compare count to the transform row count and report mismatches
//
// Output: migration/load/_validation.json

import { rawSql } from './db';
import type { LoadResult } from './types';

export interface ValidationEntry {
  table: string;
  transformRowCount: number;
  loadAttempted: number;
  dbCount: number;
  diff: number;
  status: 'OK' | 'MISMATCH';
  sample: Record<string, unknown>[];
}

export interface ValidationReport {
  generatedAt: string;
  companyId: string;
  entries: ValidationEntry[];
}

interface ValidateInput {
  table: string;
  loadResult: LoadResult;
  transformRowCount: number;
  companyId: string;
  sampleSize?: number;
}

export async function validateOne(input: ValidateInput): Promise<ValidationEntry> {
  const sampleSize = input.sampleSize ?? 3;

  const countRows = await rawSql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM ${rawSql(input.table)}
    WHERE company_id = ${input.companyId}::uuid AND deleted_at IS NULL
  `;
  const dbCount = countRows[0]?.c ?? 0;

  const sample = await rawSql<Record<string, unknown>[]>`
    SELECT * FROM ${rawSql(input.table)}
    WHERE company_id = ${input.companyId}::uuid AND deleted_at IS NULL
    ORDER BY random()
    LIMIT ${sampleSize}
  `;

  const diff = input.transformRowCount - dbCount;
  return {
    table: input.table,
    transformRowCount: input.transformRowCount,
    loadAttempted: input.loadResult.attempted,
    dbCount,
    diff,
    status: diff === 0 ? 'OK' : 'MISMATCH',
    sample: [...sample],
  };
}
