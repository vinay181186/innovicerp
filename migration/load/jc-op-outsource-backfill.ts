// migration/load/jc-op-outsource-backfill.ts
//
// T-035c — Phase 5 backfill helper.
//
// Resolves `jc_ops.outsource_pr_id` / `outsource_po_line_id` from the legacy
// text columns (`outsource_pr_no` / `outsource_po_no`) that T-024d left in
// place. Per ADR-015 #5, these text columns are dropped in a follow-on
// commit once this backfill is verified.
//
// Strategy:
//   - `outsource_pr_id` ← lookup PR by `purchase_requests.code = jc_ops.outsource_pr_no`.
//   - `outsource_po_line_id` ← lookup PO line via the inverse pointer that
//      the PO transform already sets: `purchase_order_lines.source_jc_op_id =
//      jc_ops.id` (see purchase-orders.ts — line 290-295). This is cleaner
//      than parsing PO header text and guessing which of the PO's lines maps
//      to this jc_op, and it works even if the PO has multiple lines because
//      only the line originating from this jc_op carries the back-pointer.
//
// Idempotent — only updates rows whose target FK is currently NULL.
//
// Current real-data shape: 1 jc_op (IN-JC-00002 op_seq=7, COATING) carries
// `outsource_pr_no='PR-00001'` and `outsource_po_no='IN-JWPO-00001'`. The
// matching PR + PO line both exist after Phase 5 load, so both FKs should
// flip from NULL → set.

import { rawSql } from './db';

interface JcRow {
  id: string;
  code: string;
  op_seq: number;
  outsource_pr_no: string | null;
  outsource_po_no: string | null;
  outsource_pr_id: string | null;
  outsource_po_line_id: string | null;
}

export type OutsourceBackfillStatus =
  | 'backfilled_pr_only'
  | 'backfilled_po_only'
  | 'backfilled_both'
  | 'already_backfilled'
  | 'pr_not_in_db'
  | 'po_line_not_in_db'
  | 'no_legacy_refs';

export interface OutsourceBackfillRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  status: OutsourceBackfillStatus;
  resolvedPrId?: string;
  resolvedPoLineId?: string;
  legacyPrNo?: string;
  legacyPoNo?: string;
}

export interface OutsourceBackfillResult {
  jcOpsExamined: number;
  jcOpsAlreadyBackfilled: number;
  backfilledPr: number;
  backfilledPoLine: number;
  unresolved: OutsourceBackfillRow[];
  rows: OutsourceBackfillRow[];
  dryRun: boolean;
}

interface BackfillArgs {
  companyId: string;
  adminUserId: string;
  dryRun: boolean;
}

export async function runJcOpOutsourceBackfill(
  args: BackfillArgs,
): Promise<OutsourceBackfillResult> {
  const { companyId, adminUserId, dryRun } = args;

  const jcOps = (await rawSql`
    SELECT
      jo.id,
      jc.code,
      jo.op_seq,
      jo.outsource_pr_no,
      jo.outsource_po_no,
      jo.outsource_pr_id,
      jo.outsource_po_line_id
    FROM public.jc_ops jo
    JOIN public.job_cards jc ON jc.id = jo.job_card_id
    WHERE jo.company_id = ${companyId}::uuid AND jo.deleted_at IS NULL
      AND (jo.outsource_pr_no IS NOT NULL OR jo.outsource_po_no IS NOT NULL)
  `) as unknown as JcRow[];

  const result: OutsourceBackfillResult = {
    jcOpsExamined: jcOps.length,
    jcOpsAlreadyBackfilled: 0,
    backfilledPr: 0,
    backfilledPoLine: 0,
    unresolved: [],
    rows: [],
    dryRun,
  };

  for (const jo of jcOps) {
    const hasLegacyPr = jo.outsource_pr_no !== null;
    const hasLegacyPo = jo.outsource_po_no !== null;

    if (!hasLegacyPr && !hasLegacyPo) {
      // Filtered out by the WHERE clause already; defensive.
      result.unresolved.push({
        jcOpId: jo.id,
        jcCode: jo.code,
        opSeq: jo.op_seq,
        status: 'no_legacy_refs',
      });
      continue;
    }

    if (jo.outsource_pr_id !== null && jo.outsource_po_line_id !== null) {
      result.jcOpsAlreadyBackfilled++;
      result.rows.push({
        jcOpId: jo.id,
        jcCode: jo.code,
        opSeq: jo.op_seq,
        status: 'already_backfilled',
        resolvedPrId: jo.outsource_pr_id,
        resolvedPoLineId: jo.outsource_po_line_id,
        ...(jo.outsource_pr_no !== null ? { legacyPrNo: jo.outsource_pr_no } : {}),
        ...(jo.outsource_po_no !== null ? { legacyPoNo: jo.outsource_po_no } : {}),
      });
      continue;
    }

    let resolvedPrId: string | null = jo.outsource_pr_id;
    let resolvedPoLineId: string | null = jo.outsource_po_line_id;

    // PR resolution: by code.
    if (hasLegacyPr && resolvedPrId === null) {
      const prRows = (await rawSql<Array<{ id: string }>>`
        SELECT id FROM public.purchase_requests
        WHERE company_id = ${companyId}::uuid
          AND code = ${jo.outsource_pr_no}
          AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as Array<{ id: string }>;
      const prId = prRows[0]?.id;
      if (prId) resolvedPrId = prId;
    }

    // PO line resolution: via inverse pointer that the PO transform set.
    if (hasLegacyPo && resolvedPoLineId === null) {
      const polRows = (await rawSql<Array<{ id: string }>>`
        SELECT id FROM public.purchase_order_lines
        WHERE source_jc_op_id = ${jo.id}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as Array<{ id: string }>;
      const polId = polRows[0]?.id;
      if (polId) resolvedPoLineId = polId;
    }

    if (resolvedPrId === jo.outsource_pr_id && resolvedPoLineId === jo.outsource_po_line_id) {
      // Nothing changed (both lookups missed). Surface as unresolved — pick
      // the more specific status when only one of the two legacy refs was
      // present.
      const status: OutsourceBackfillStatus =
        hasLegacyPr && resolvedPrId === null ? 'pr_not_in_db' : 'po_line_not_in_db';
      const r: OutsourceBackfillRow = {
        jcOpId: jo.id,
        jcCode: jo.code,
        opSeq: jo.op_seq,
        status,
        ...(jo.outsource_pr_no !== null ? { legacyPrNo: jo.outsource_pr_no } : {}),
        ...(jo.outsource_po_no !== null ? { legacyPoNo: jo.outsource_po_no } : {}),
      };
      result.rows.push(r);
      result.unresolved.push(r);
      continue;
    }

    if (!dryRun) {
      await rawSql`
        UPDATE public.jc_ops
        SET outsource_pr_id      = ${resolvedPrId}::uuid,
            outsource_po_line_id = ${resolvedPoLineId}::uuid,
            updated_by           = ${adminUserId}::uuid
        WHERE id = ${jo.id}::uuid
      `;
    }

    if (resolvedPrId !== jo.outsource_pr_id && resolvedPrId !== null) {
      result.backfilledPr++;
    }
    if (resolvedPoLineId !== jo.outsource_po_line_id && resolvedPoLineId !== null) {
      result.backfilledPoLine++;
    }

    let status: OutsourceBackfillStatus;
    if (resolvedPrId !== null && resolvedPoLineId !== null) status = 'backfilled_both';
    else if (resolvedPrId !== null) status = 'backfilled_pr_only';
    else status = 'backfilled_po_only';

    result.rows.push({
      jcOpId: jo.id,
      jcCode: jo.code,
      opSeq: jo.op_seq,
      status,
      ...(resolvedPrId !== null ? { resolvedPrId } : {}),
      ...(resolvedPoLineId !== null ? { resolvedPoLineId } : {}),
      ...(jo.outsource_pr_no !== null ? { legacyPrNo: jo.outsource_pr_no } : {}),
      ...(jo.outsource_po_no !== null ? { legacyPoNo: jo.outsource_po_no } : {}),
    });

    // If only one of the two backfills succeeded, also note the unresolved
    // half so the validator can show it.
    if (hasLegacyPr && resolvedPrId === null) {
      result.unresolved.push({
        jcOpId: jo.id,
        jcCode: jo.code,
        opSeq: jo.op_seq,
        status: 'pr_not_in_db',
        ...(jo.outsource_pr_no !== null ? { legacyPrNo: jo.outsource_pr_no } : {}),
      });
    }
    if (hasLegacyPo && resolvedPoLineId === null) {
      result.unresolved.push({
        jcOpId: jo.id,
        jcCode: jo.code,
        opSeq: jo.op_seq,
        status: 'po_line_not_in_db',
        ...(jo.outsource_po_no !== null ? { legacyPoNo: jo.outsource_po_no } : {}),
      });
    }
  }

  return result;
}
