// ADR-289 — stock comes back to the SAME Drawing Rev bucket it left.
//
// An 'out' that names no Rev (Item Issue, JW DC Outward) is split by
// postStockMove across the blank bucket and the Rev buckets and returns every
// ledger row in `mv.rows`. recordOutParts keeps those rows per source line
// (stock_out_parts, 0247); giveBackToParts is the ONE writer of
// stock_out_parts.returned_qty (§20.1) and posts the 'in' moves of a Return /
// Cancel / JW DC receipt back into those buckets — last taken, first given
// back, never more into a bucket than it gave minus what already came back.
//
// Lock order: the caller holds its own parent lock (the slip / the outward
// challan); here the ITEM row is locked first (lockItemForStock — the lock
// every stock move takes), then the part rows FOR UPDATE ordered by id, then
// the moves are posted under that same item lock (§20.3).
//
// Lines made before 0247 have no parts: their stock goes back to the bucket of
// the single ledger row the line kept (store_transaction_id), else blank.

import { sql } from 'drizzle-orm';
import { stockOutParts } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import {
  lockItemForStock,
  postStockMove,
  roundQty,
  type StockMoveInput,
  type StockMoveResult,
} from './stock-ledger';

export type StockPartSource = { storeIssueLineId: string } | { jwDcOutwardLineId: string };

function sourceCols(s: StockPartSource): {
  storeIssueLineId: string | null;
  jwDcOutwardLineId: string | null;
} {
  return 'storeIssueLineId' in s
    ? { storeIssueLineId: s.storeIssueLineId, jwDcOutwardLineId: null }
    : { storeIssueLineId: null, jwDcOutwardLineId: s.jwDcOutwardLineId };
}

/** Keep every bucket one un-named 'out' took (one row per ledger row). */
export async function recordOutParts(
  tx: DbTransaction,
  args: {
    companyId: string;
    userId: string;
    source: StockPartSource;
    itemId: string;
    rows: StockMoveResult['rows'];
  },
): Promise<void> {
  if (args.rows.length === 0) return;
  const cols = sourceCols(args.source);
  await tx.insert(stockOutParts).values(
    args.rows.map((r, i) => ({
      companyId: args.companyId,
      ...cols,
      takeOrder: i + 1,
      storeTransactionId: r.id,
      itemId: args.itemId,
      itemRevisionId: r.itemRevisionId,
      qty: roundQty(r.qty),
      createdBy: args.userId,
      updatedBy: args.userId,
    })),
  );
}

export interface GiveBackResult {
  itemRevisionId: string | null;
  qty: number;
  mv: StockMoveResult;
}

/**
 * Put `move.qty` back into the buckets the source line(s) took it from.
 * `sources` in the order to give back across (e.g. several outward lines);
 * inside one source, last taken first. One postStockMove 'in' per bucket,
 * itemRevisionId always named (null = blank bucket). Returns the moves in
 * the order posted (never empty for qty > 0).
 */
export async function giveBackToParts(
  tx: DbTransaction,
  args: {
    sources: StockPartSource[];
    /** The line's single kept ledger row — used only when no parts exist. */
    fallbackTxnId: string | null;
    /** Several lines made before 0247 (no parts): walk them in order, each
     *  giving back into its own kept ledger row's bucket up to `room` (what
     *  that line sent minus what already came back). Used instead of
     *  fallbackTxnId when given. */
    fallbackLines?: Array<{ txnId: string | null; room: number }>;
    move: Omit<StockMoveInput, 'txnType' | 'itemRevisionId'>;
  },
): Promise<GiveBackResult[]> {
  const { move } = args;
  const companyId = move.companyId;
  const qty = roundQty(move.qty);
  if (!(qty > 0)) return [];
  await lockItemForStock(tx, companyId, move.itemId);

  const issueIds = args.sources.flatMap((s) =>
    'storeIssueLineId' in s ? [s.storeIssueLineId] : [],
  );
  const jwIds = args.sources.flatMap((s) =>
    'jwDcOutwardLineId' in s ? [s.jwDcOutwardLineId] : [],
  );
  const rank = new Map<string, number>();
  args.sources.forEach((s, i) => {
    rank.set('storeIssueLineId' in s ? s.storeIssueLineId : s.jwDcOutwardLineId, i);
  });
  const parts =
    issueIds.length + jwIds.length === 0
      ? []
      : ((await tx.execute(sql`
          SELECT p.id, COALESCE(p.store_issue_line_id, p.jw_dc_outward_line_id) AS src,
                 p.take_order AS "takeOrder", p.qty, p.returned_qty AS "returnedQty",
                 CASE WHEN ir.id IS NOT NULL THEN p.item_revision_id END AS "revId"
            FROM public.stock_out_parts p
            LEFT JOIN public.item_revisions ir
              ON ir.id = p.item_revision_id AND ir.item_id = p.item_id AND ir.deleted_at IS NULL
           WHERE p.company_id = ${companyId}::uuid
             AND p.item_id = ${move.itemId}::uuid
             AND p.deleted_at IS NULL
             AND (p.store_issue_line_id = ANY(${sql.param(issueIds)}::uuid[])
                  OR p.jw_dc_outward_line_id = ANY(${sql.param(jwIds)}::uuid[]))
           ORDER BY p.id
           FOR UPDATE OF p
        `)) as unknown as Array<{
          id: string;
          src: string;
          takeOrder: number;
          qty: string | number;
          returnedQty: string | number;
          revId: string | null;
        }>);
  parts.sort(
    (a, b) =>
      (rank.get(a.src) ?? 0) - (rank.get(b.src) ?? 0) || Number(b.takeOrder) - Number(a.takeOrder),
  );

  // Plan: per bucket how much, per part how much more has come back.
  const buckets = new Map<string | null, number>();
  const partInc: Array<{ id: string; inc: number }> = [];
  let left = qty;
  for (const p of parts) {
    if (left <= 0) break;
    const room = roundQty(Number(p.qty) - Number(p.returnedQty));
    if (room <= 0) continue;
    const t = roundQty(Math.min(room, left));
    buckets.set(p.revId, roundQty((buckets.get(p.revId) ?? 0) + t));
    partInc.push({ id: p.id, inc: t });
    left = roundQty(left - t);
  }
  if (left > 0) {
    // No parts (a line made before 0247): the bucket of its one kept ledger
    // row, else blank. Parts all given back already: blank, as before 0247.
    let revId: string | null = null;
    if (parts.length === 0 && args.fallbackLines && args.fallbackLines.length > 0) {
      const ids = args.fallbackLines.flatMap((f) => (f.txnId ? [f.txnId] : []));
      const revs =
        ids.length === 0
          ? []
          : ((await tx.execute(sql`
              SELECT st.id, st.item_revision_id AS "revId"
                FROM public.store_transactions st
                JOIN public.item_revisions ir
                  ON ir.id = st.item_revision_id AND ir.item_id = st.item_id
                 AND ir.deleted_at IS NULL
               WHERE st.id = ANY(${sql.param(ids)}::uuid[])
                 AND st.item_id = ${move.itemId}::uuid
            `)) as unknown as Array<{ id: string; revId: string | null }>);
      const revOf = new Map(revs.map((r) => [r.id, r.revId]));
      for (const f of args.fallbackLines) {
        if (left <= 0) break;
        const room = roundQty(f.room);
        if (room <= 0) continue;
        const t = roundQty(Math.min(room, left));
        const rid = f.txnId ? (revOf.get(f.txnId) ?? null) : null;
        buckets.set(rid, roundQty((buckets.get(rid) ?? 0) + t));
        left = roundQty(left - t);
      }
      // Anything beyond what the lines sent: blank, as before 0247.
    } else if (parts.length === 0 && args.fallbackTxnId) {
      const r = (await tx.execute(sql`
        SELECT st.item_revision_id AS "revId"
          FROM public.store_transactions st
          JOIN public.item_revisions ir
            ON ir.id = st.item_revision_id AND ir.item_id = st.item_id AND ir.deleted_at IS NULL
         WHERE st.id = ${args.fallbackTxnId}::uuid AND st.item_id = ${move.itemId}::uuid
      `)) as unknown as Array<{ revId: string | null }>;
      revId = r[0]?.revId ?? null;
    }
    if (left > 0) buckets.set(revId, roundQty((buckets.get(revId) ?? 0) + left));
  }

  const out: GiveBackResult[] = [];
  for (const [revId, q] of buckets) {
    const mv = await postStockMove(tx, { ...move, qty: q, txnType: 'in', itemRevisionId: revId });
    out.push({ itemRevisionId: revId, qty: q, mv });
  }
  for (const p of partInc) {
    await tx.execute(sql`
      UPDATE public.stock_out_parts
         SET returned_qty = returned_qty + ${p.inc}, updated_by = ${move.userId}::uuid,
             updated_at = now()
       WHERE id = ${p.id}::uuid
    `);
  }
  return out;
}
