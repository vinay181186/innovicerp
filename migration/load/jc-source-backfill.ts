// migration/load/jc-source-backfill.ts
//
// T-029d — Phase 4 backfill helper.
//
// Resolves `job_cards.source_so_line_id` / `source_jw_line_id` from each JC's
// `source_legacy_ref` text column (JSON-encoded payload written by T-024c
// per ADR-011 #5). Lookup uses the Phase 4 transform output's `_id_map.json`,
// which keys legacy line ids to the new line UUIDs.
//
// Idempotent — only updates rows where BOTH FKs are currently NULL. A
// re-run after a successful Phase 4 load is a no-op (rows fall into
// `jcsAlreadyBackfilled`).
//
// `source_legacy_ref` text remains in place after backfill; it's kept one
// phase as audit trail per ADR-012 #3 and dropped in a Phase 5 cleanup commit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawSql } from './db';

interface IdMap {
  sales_order_lines?: Record<string, string>;
  job_work_order_lines?: Record<string, string>;
  [k: string]: unknown;
}

interface JcRow {
  id: string;
  code: string;
  source_legacy_ref: string | null;
  source_so_line_id: string | null;
  source_jw_line_id: string | null;
}

export type BackfillStatus =
  | 'backfilled_so'
  | 'backfilled_jw'
  | 'already_backfilled'
  | 'no_legacy_ref'
  | 'json_parse_failed'
  | 'both_so_and_jw_refs'
  | 'so_ref_not_in_transform'
  | 'jw_ref_not_in_transform'
  | 'no_so_or_jw_ref_in_payload';

export interface BackfillRow {
  jcId: string;
  jcCode: string;
  legacyRef: string | null;
  status: BackfillStatus;
  resolvedColumn?: 'source_so_line_id' | 'source_jw_line_id';
  resolvedTarget?: string;
  /** The legacy id we tried to resolve (`soRefId` / `jwRefId`). */
  legacyTargetId?: string;
}

export interface BackfillResult {
  jcsExamined: number;
  jcsAlreadyBackfilled: number;
  backfilledSo: number;
  backfilledJw: number;
  unresolved: BackfillRow[];
  rows: BackfillRow[];
  dryRun: boolean;
}

interface BackfillArgs {
  companyId: string;
  adminUserId: string;
  transformDir: string;
  dryRun: boolean;
}

export async function runJcSourceBackfill(args: BackfillArgs): Promise<BackfillResult> {
  const { companyId, adminUserId, transformDir, dryRun } = args;

  const idMapPath = join(transformDir, '_id_map.json');
  const idMap = JSON.parse(readFileSync(idMapPath, 'utf8')) as IdMap;
  const soByLegacy = new Map<string, string>(Object.entries(idMap.sales_order_lines ?? {}));
  const jwByLegacy = new Map<string, string>(Object.entries(idMap.job_work_order_lines ?? {}));

  const jcs = (await rawSql`
    SELECT id, code, source_legacy_ref, source_so_line_id, source_jw_line_id
    FROM public.job_cards
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND source_legacy_ref IS NOT NULL
  `) as unknown as JcRow[];

  const result: BackfillResult = {
    jcsExamined: jcs.length,
    jcsAlreadyBackfilled: 0,
    backfilledSo: 0,
    backfilledJw: 0,
    unresolved: [],
    rows: [],
    dryRun,
  };

  for (const jc of jcs) {
    if (jc.source_so_line_id !== null || jc.source_jw_line_id !== null) {
      result.jcsAlreadyBackfilled++;
      result.rows.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: jc.source_legacy_ref,
        status: 'already_backfilled',
        resolvedColumn:
          jc.source_so_line_id !== null ? 'source_so_line_id' : 'source_jw_line_id',
        resolvedTarget: (jc.source_so_line_id ?? jc.source_jw_line_id) as string,
      });
      continue;
    }

    if (!jc.source_legacy_ref) {
      // Filtered out by the WHERE clause already; defensive.
      result.unresolved.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: null,
        status: 'no_legacy_ref',
      });
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jc.source_legacy_ref) as Record<string, unknown>;
    } catch {
      result.unresolved.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: jc.source_legacy_ref,
        status: 'json_parse_failed',
      });
      continue;
    }

    const soRefId =
      typeof parsed['soRefId'] === 'string' && parsed['soRefId'].length > 0
        ? (parsed['soRefId'] as string)
        : null;
    // Tolerate either `jwRefId` or `jwLineRefId` from a future legacy schema.
    const jwRefId =
      typeof parsed['jwRefId'] === 'string' && parsed['jwRefId'].length > 0
        ? (parsed['jwRefId'] as string)
        : typeof parsed['jwLineRefId'] === 'string' && parsed['jwLineRefId'].length > 0
          ? (parsed['jwLineRefId'] as string)
          : null;

    if (soRefId && jwRefId) {
      // CHECK constraint would reject if we wrote both. Surface as unresolved.
      result.unresolved.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: jc.source_legacy_ref,
        status: 'both_so_and_jw_refs',
      });
      continue;
    }

    if (soRefId) {
      const target = soByLegacy.get(soRefId);
      if (!target) {
        result.unresolved.push({
          jcId: jc.id,
          jcCode: jc.code,
          legacyRef: jc.source_legacy_ref,
          status: 'so_ref_not_in_transform',
          legacyTargetId: soRefId,
        });
        continue;
      }
      if (!dryRun) {
        await rawSql`
          UPDATE public.job_cards
          SET source_so_line_id = ${target}::uuid,
              updated_by = ${adminUserId}::uuid
          WHERE id = ${jc.id}::uuid
        `;
      }
      result.backfilledSo++;
      result.rows.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: jc.source_legacy_ref,
        status: 'backfilled_so',
        resolvedColumn: 'source_so_line_id',
        resolvedTarget: target,
        legacyTargetId: soRefId,
      });
      continue;
    }

    if (jwRefId) {
      const target = jwByLegacy.get(jwRefId);
      if (!target) {
        result.unresolved.push({
          jcId: jc.id,
          jcCode: jc.code,
          legacyRef: jc.source_legacy_ref,
          status: 'jw_ref_not_in_transform',
          legacyTargetId: jwRefId,
        });
        continue;
      }
      if (!dryRun) {
        await rawSql`
          UPDATE public.job_cards
          SET source_jw_line_id = ${target}::uuid,
              updated_by = ${adminUserId}::uuid
          WHERE id = ${jc.id}::uuid
        `;
      }
      result.backfilledJw++;
      result.rows.push({
        jcId: jc.id,
        jcCode: jc.code,
        legacyRef: jc.source_legacy_ref,
        status: 'backfilled_jw',
        resolvedColumn: 'source_jw_line_id',
        resolvedTarget: target,
        legacyTargetId: jwRefId,
      });
      continue;
    }

    result.unresolved.push({
      jcId: jc.id,
      jcCode: jc.code,
      legacyRef: jc.source_legacy_ref,
      status: 'no_so_or_jw_ref_in_payload',
    });
  }

  return result;
}
