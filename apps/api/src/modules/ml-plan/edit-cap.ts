// Multi-Level Plan (ADR-225 phase 4) — the To Raise cap on EDIT.
//
// Raise orders caps a row's orders at its Net Need under the Multi-Level
// Plan's row lock (orders.ts). Every OTHER writer of such a document's qty —
// the plan edit (plans/service.ts updatePlanTx, plan_qty) and the PR edit
// (purchase-requests/service.ts updatePurchaseRequestTx, qty) — calls this,
// so Raised ≤ Net Need holds whichever screen changes the number
// (CLAUDE.md §20.3). The top row's plan also keeps its SO line cap; both
// apply.
//
// Lock order: the caller has locked its own plan / PR row; this takes the
// ml_plans row next. Raise orders takes the ml_plans row and only INSERTS
// plans / PRs (it never locks an existing one), so the two cannot wait on
// each other in a circle.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { readRaisedOnNodeExcluding } from './order-reads';
import { milliToText, toMilli } from './snapshot-math';

/** "5" for a whole number, "2.500" otherwise. */
const qtyWord = (milli: bigint): string =>
  milli % 1000n === 0n ? (milli / 1000n).toString() : milliToText(milli);

/**
 * Refuse (409) an edit that would take the row's Raised past its Net Need.
 * No-op for a document not raised from a Multi-Level Plan, or when the qty
 * does not go UP (a cut can never break the cap).
 */
export async function assertMlNodeCapOnEdit(
  tx: DbTransaction,
  companyId: string,
  args: {
    mlPlanNodeId: string | null | undefined;
    doc: { kind: 'plan' | 'pr'; id: string };
    oldQty: number | string;
    newQty: number | string;
  },
): Promise<void> {
  if (!args.mlPlanNodeId) return;
  const newMilli = toMilli(args.newQty);
  if (newMilli <= toMilli(args.oldQty)) return;

  const nodes = (await tx.execute(sql`
    SELECT n.ml_plan_id, n.net_need_qty::text AS net, i.code AS item_code
    FROM public.ml_plan_nodes n
    LEFT JOIN public.items i ON i.id = n.item_id
    WHERE n.id = ${args.mlPlanNodeId}::uuid AND n.company_id = ${companyId}::uuid
    LIMIT 1
  `)) as unknown as Array<{ ml_plan_id: string; net: string; item_code: string | null }>;
  const node = nodes[0];
  if (!node) return;
  // The parent's lock, in its own statement; the sum below is the NEXT
  // statement, so it sees whatever a raise holding the lock committed.
  const locked = (await tx.execute(sql`
    SELECT mp.code FROM public.ml_plans mp
    WHERE mp.id = ${node.ml_plan_id}::uuid AND mp.company_id = ${companyId}::uuid
    FOR UPDATE
  `)) as unknown as Array<{ code: string }>;
  const code = locked[0]?.code ?? 'the Multi-Level Plan';

  const others = toMilli(
    await readRaisedOnNodeExcluding(tx, companyId, args.mlPlanNodeId, args.doc),
  );
  const left = toMilli(node.net) - others;
  if (newMilli > left) {
    throw new ConflictError(
      `${node.item_code ?? 'This item'}: only ${qtyWord(left > 0n ? left : 0n)} left to raise on ${code}.`,
    );
  }
}

/**
 * A document raised from a Multi-Level Plan row is FOR that row's item: its
 * item cannot change (its qty keeps counting toward the row's Raised, so a
 * different item would be counted as this one). 409 when it would.
 */
export async function assertMlNodeItemUnchanged(
  tx: DbTransaction,
  companyId: string,
  args: {
    mlPlanNodeId: string | null | undefined;
    docCode: string;
    oldItemId: string | null;
    newItemId: string | null;
    oldItemCodeText: string | null;
    newItemCodeText: string | null | undefined;
  },
): Promise<void> {
  if (!args.mlPlanNodeId) return;
  const itemMoved = args.newItemId !== args.oldItemId;
  const textMoved =
    args.newItemCodeText !== undefined &&
    (args.newItemCodeText ?? '').trim() !== (args.oldItemCodeText ?? '').trim();
  if (!itemMoved && !textMoved) return;
  const rows = (await tx.execute(sql`
    SELECT mp.code AS plan_code, i.code AS item_code
    FROM public.ml_plan_nodes n
    JOIN public.ml_plans mp ON mp.id = n.ml_plan_id
    LEFT JOIN public.items i ON i.id = n.item_id
    WHERE n.id = ${args.mlPlanNodeId}::uuid AND n.company_id = ${companyId}::uuid
    LIMIT 1
  `)) as unknown as Array<{ plan_code: string; item_code: string | null }>;
  const r = rows[0];
  throw new ConflictError(
    `${args.docCode} was raised for ${r?.item_code ?? args.oldItemCodeText ?? 'its item'} by ` +
      `${r?.plan_code ?? 'a Multi-Level Plan'} — the item cannot change.`,
  );
}
