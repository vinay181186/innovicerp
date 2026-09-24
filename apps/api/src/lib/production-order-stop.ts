// Short-closed Production Order guard — the ONE place "this order is dead,
// nothing more may be done on it" is enforced (ADR-182).
//
// A short close stops an order at ANY stage. It is NOT ADR-179's "close short",
// which finishes a COMPLETE job card and writes off its losses. A short-closed
// order is DEAD: every server-side write that touches its Job Card refuses —
// op start / production log, QC log, Incoming QC, GRN, outward DC, customer
// dispatch, NC, rework / recovery child, JC edit / delete, and the order's own
// close / reverse-close. The UI hides the buttons too, but the server is the
// rule.
//
// Pieces already credited to stock stay credited: a short close never touches
// the close ledger. It only stops further work.
//
// Rework / repair children: a child JC never carries production_order_id
// itself, so the check walks up `parent_job_card_id` — the SAME recursive walk
// the ADR-170 stock OFF switch uses (jobCardOrderChainCte, depth ≤ 10), shared
// so the two can never disagree about which orders a card belongs to.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';
import { jobCardOrderChainCte } from './production-order-link';

/** What a stopped order looks like to the guard. */
export interface StoppedProductionOrder {
  /** production_orders.code — IN-PRO-#####. */
  code: string;
  /** Short-close date, already rendered YYYY-MM-DD in IST. */
  shortClosedOn: string | null;
  /** The Job Card the caller asked about (not necessarily the order's own). */
  jcCode: string;
}

/**
 * The refusal sentence. Pure, so it is unit-testable without a database and so
 * every caller refuses in exactly the same words.
 *
 *   "Production Order IN-PRO-00007 was short closed on 2026-09-24 — no further
 *    work is allowed on Job Card IN-JC-26-00055."
 *
 * A missing date reads "was short closed" with no date rather than the word
 * "null" — the CHECK makes short_closed_at mandatory, so this only guards
 * against a hand-edited row.
 */
export function productionOrderStoppedMessage(o: StoppedProductionOrder): string {
  const when = o.shortClosedOn ? ` on ${o.shortClosedOn}` : '';
  return (
    `Production Order ${o.code} was short closed${when} — ` +
    `no further work is allowed on Job Card ${o.jcCode}.`
  );
}

/**
 * The decision, split out from the database read so it can be tested on its
 * own: null when the Job Card is free to be worked on, otherwise the sentence
 * above. `stopped` is the short-closed order found up the card's chain, or null
 * when there is none.
 */
export function productionOrderStopError(stopped: StoppedProductionOrder | null): string | null {
  return stopped ? productionOrderStoppedMessage(stopped) : null;
}

/**
 * The short-closed Production Order this Job Card (or any ancestor of it)
 * belongs to, or null when there is none. Soft-deleted cards and orders are
 * ignored; a card with no order anywhere up its chain — every pre-ADR-170 Job
 * Card — yields null and behaves exactly as before.
 */
export async function findStoppedProductionOrder(
  tx: DbTransaction,
  jobCardId: string,
): Promise<StoppedProductionOrder | null> {
  const rows = (await tx.execute(sql`
    ${jobCardOrderChainCte(jobCardId)}
    SELECT po.code AS po_code,
           to_char(po.short_closed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS short_closed_on,
           (SELECT jc.code FROM public.job_cards jc WHERE jc.id = ${jobCardId}::uuid) AS jc_code
    FROM chain
    JOIN public.production_orders po ON po.id = chain.production_order_id
    WHERE po.deleted_at IS NULL
      AND po.status = 'short_closed'
    ORDER BY chain.depth
    LIMIT 1
  `)) as unknown as Array<{
    po_code: string;
    short_closed_on: string | null;
    jc_code: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    code: r.po_code,
    shortClosedOn: r.short_closed_on ?? null,
    jcCode: r.jc_code ?? jobCardId,
  };
}

/**
 * Refuse every further write on a short-closed order's Job Card (ADR-182).
 * Call it FIRST — after the access gate, before any write — so nothing is
 * half-written before the refusal.
 */
export async function assertProductionOrderNotShortClosed(
  tx: DbTransaction,
  jobCardId: string,
): Promise<void> {
  const message = productionOrderStopError(await findStoppedProductionOrder(tx, jobCardId));
  if (message) throw new ValidationError(message);
}

/*
 * There is deliberately NO guard keyed on a SALES-ORDER line (ADR-182 review).
 * One SO line's plan may now be covered by SEVERAL Production Orders, so
 * refusing the whole line because ONE of its orders was stopped would make the
 * good pieces made under its siblings permanently un-dispatchable. Customer
 * Dispatch instead leaves a stopped order's Job Card OUT of the readiness sum
 * (customer-dispatches/service.ts loadDispatchable), so the abandoned pieces
 * are simply never offered and the siblings' pieces still ship.
 */

/**
 * The same guard keyed on a purchase-order LINE — the shape the outward
 * delivery challan has in hand. An OSP line points back at its jc_op two ways,
 * the same two the GRN cascade uses (`jc_ops.outsource_po_line_id`, stamped
 * once the outward DC is issued, and `purchase_order_lines.source_jc_op_id`,
 * stamped when the line is raised from the OSP purchase request). A line that
 * resolves to no op — an ordinary purchase — is never blocked.
 */
export async function assertProductionOrderNotShortClosedForPoLine(
  tx: DbTransaction,
  poLineId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT o.job_card_id
      FROM public.jc_ops o
     WHERE o.deleted_at IS NULL
       AND o.outsource_po_line_id = ${poLineId}::uuid
    UNION
    SELECT o.job_card_id
      FROM public.purchase_order_lines pol
      JOIN public.jc_ops o ON o.id = pol.source_jc_op_id
     WHERE pol.id = ${poLineId}::uuid
       AND pol.deleted_at IS NULL
       AND o.deleted_at IS NULL
  `)) as unknown as Array<{ job_card_id: string | null }>;
  for (const r of rows) {
    if (r.job_card_id) await assertProductionOrderNotShortClosed(tx, r.job_card_id);
  }
}

/**
 * The same guard keyed on a jc_op instead of a Job Card — the shape a caller
 * that has not loaded the op yet has in hand (op-entry `generateOspPr`, which
 * hands the op id straight to the OSP cascade). Resolves the op's card, then
 * defers to the walk above. A missing / deleted op is left to the caller's own
 * not-found handling. Callers that ALREADY hold the card id (most of Op Entry,
 * via loadJcOp) call `assertProductionOrderNotShortClosed` directly instead —
 * one round trip fewer, same answer.
 */
export async function assertProductionOrderNotShortClosedForOp(
  tx: DbTransaction,
  jcOpId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT o.job_card_id FROM public.jc_ops o
    WHERE o.id = ${jcOpId}::uuid AND o.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ job_card_id: string | null }>;
  const jobCardId = rows[0]?.job_card_id;
  if (!jobCardId) return;
  await assertProductionOrderNotShortClosed(tx, jobCardId);
}
