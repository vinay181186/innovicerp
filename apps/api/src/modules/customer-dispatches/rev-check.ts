// ADR-292 — Dispatch ships only a Drawing Rev the order accepts.
//
// Allowed Revs for an SO line = the line's own Rev
//   ∪ the Revs of the live Job Cards made for that line (job_cards.source_so_line_id)
//   ∪ Revs with an approved substitution for that line (rev_substitutions).
// A Rev allowed only by substitution uses it up (consumeSubstitution) in the
// dispatch's own transaction, recorded against the dispatch line; the reverse
// (cancel / edit) gives back exactly that line's use — not re-derived from the
// line's Rev, which may have changed since (0251).
// A line with no Drawing Rev of its own is not Rev-controlled (old orders):
// any bucket ships, exactly as before.

import { itemRevLabel } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { consumeSubstitution, giveBackSubstitution } from '../../lib/rev-substitution';
import { bucketLabel } from '../../lib/stock-reservation';

interface LineRevCtx {
  makeItem: boolean;
  itemCode: string;
  lineRevId: string | null;
  lineRev: string | null;
  /** Rev ids of the live Job Cards made for the line ('' = a card with no Rev). */
  jcRevKeys: string[];
}

async function readLineRevCtx(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
): Promise<LineRevCtx | null> {
  const rows = (await tx.execute(sql`
    SELECT (i.procurement_type::text = 'make') AS make_item,
           COALESCE(i.code, l.item_code_text, '') AS item_code,
           l.item_revision_id AS line_rev_id, lr.rev AS line_rev,
           ARRAY(SELECT DISTINCT COALESCE(jc.item_revision_id::text, '')
                   FROM public.job_cards jc
                  WHERE jc.company_id = l.company_id AND jc.source_so_line_id = l.id
                    AND jc.deleted_at IS NULL) AS jc_rev_keys
      FROM public.sales_order_lines l
      LEFT JOIN public.items i ON i.id = l.item_id
      LEFT JOIN public.item_revisions lr ON lr.id = l.item_revision_id
     WHERE l.id = ${soLineId}::uuid AND l.company_id = ${companyId}::uuid`)) as unknown as Array<{
    make_item: boolean | null;
    item_code: string;
    line_rev_id: string | null;
    line_rev: string | null;
    jc_rev_keys: string[] | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    makeItem: r.make_item === true,
    itemCode: r.item_code,
    lineRevId: r.line_rev_id,
    lineRev: r.line_rev,
    jcRevKeys: r.jc_rev_keys ?? [],
  };
}

/**
 * Called for every dispatch row as it ships ('out') or is reversed ('in').
 * 'out': refuses a Rev outside the allowed set; a Rev allowed only by
 * substitution consumes it. 'in': gives back what this dispatch line used.
 */
export async function applyDispatchRev(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  line: {
    /** customer_dispatch_lines.id — the source the substitution use is recorded on. */
    dispatchLineId: string;
    salesOrderLineId: string | null;
    qty: number;
    itemRevisionId: string | null;
  },
  dir: 'out' | 'in',
): Promise<void> {
  if (line.qty <= 0) return;
  const source = { type: 'dispatch_line' as const, id: line.dispatchLineId };
  if (dir === 'in') {
    // What this line used, given back exactly (0 when it used none).
    await giveBackSubstitution(tx, { companyId, userId, source, qty: line.qty });
    return;
  }
  if (!line.salesOrderLineId) return;
  const ctx = await readLineRevCtx(tx, companyId, line.salesOrderLineId);
  if (!ctx || !ctx.makeItem || !ctx.lineRevId) return;
  const rev = line.itemRevisionId;
  if (rev === ctx.lineRevId) return;
  if (ctx.jcRevKeys.includes(rev ?? '')) return;
  const askedLabel = itemRevLabel(ctx.itemCode, ctx.lineRev);
  if (!rev) {
    // Blank (no-Rev) stock cannot be substituted (a substitution names its Rev).
    throw new ConflictError(
      `Revision mismatch with the order: ${bucketLabel(ctx.itemCode, null)} is not the order's Drawing Rev (${askedLabel}). ` +
        "Set the Drawing Rev on that stock first, or ship the order's Rev.",
    );
  }
  const scope = { salesOrderLineId: line.salesOrderLineId };
  const revText = (await tx.execute(sql`
    SELECT rev FROM public.item_revisions WHERE id = ${rev}::uuid`)) as unknown as Array<{
    rev: string;
  }>;
  const usedLabel = itemRevLabel(ctx.itemCode, revText[0]?.rev ?? '?');
  await consumeSubstitution(tx, {
    companyId,
    userId,
    scope,
    fromRevId: rev,
    toRevId: ctx.lineRevId,
    qty: line.qty,
    source,
    usedLabel,
    askedLabel,
  });
}
