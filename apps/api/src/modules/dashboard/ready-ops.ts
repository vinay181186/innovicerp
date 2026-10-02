// Operator home "Ready for You" — one 25-row page + the count over EVERY
// ready op (ADR-201). Used by the home read (page 1) and by
// GET /dashboard/operator-ready (pages 2+).

import type { ReadyOpRow } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

type Row = Record<string, string | number | null>;
async function q(tx: DbTransaction, text: string): Promise<Row[]> {
  return (await tx.execute(sql.raw(text))) as unknown as Row[];
}
const num = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;

/** Ready-for-you page size on the operator home (ADR-201: 25 a page). */
export const READY_PAGE_SIZE = 25;

// Ready for work — available>0, not running, not outsource/qc. ONE FROM/WHERE
// for the page and its count, so the pager's total always matches the rows.
const READY_FROM = (cid: string): string => `
     FROM v_jc_op_status vs
     JOIN jc_ops o ON o.id = vs.jc_op_id AND o.deleted_at IS NULL
     JOIN job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
     LEFT JOIN machines m ON m.id = o.machine_id
     LEFT JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
     LEFT JOIN job_work_order_lines rev_jwl ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
     WHERE vs.company_id='${cid}'::uuid AND vs.available > 0
       AND vs.computed_status IN ('available','in_progress')
       AND vs.op_type NOT IN ('outsource','qc')`;

/** One page of the operator's "Ready for You" table, soonest due first, plus
 *  the count over EVERY ready op (the strip's "Ready to Work" figure). */
export async function readyOpsPage(
  tx: DbTransaction,
  cid: string,
  today: string,
  limit: number,
  offset: number,
): Promise<{ items: ReadyOpRow[]; total: number }> {
  const lim = Math.max(1, Math.floor(limit));
  const off = Math.max(0, Math.floor(offset));
  const readyRows = await q(
    tx,
    `SELECT jc.code AS jc_code, o.op_seq, o.operation, m.code AS machine,
        sol.item_code_text AS item_code,
        -- The part's NAME, taken off the SO line and NOT off the item master.
        -- The code above is sol.item_code_text, so the name has to come from the
        -- same row or the tile could pair one order's code with a different
        -- item's name -- the SO line carries its own free-typed code and part
        -- name, and nothing forces either to match items.code / items.name for
        -- jc.item_id. part_name is NOT NULL on the line, so wherever the code
        -- prints, the name prints with it, and on a JW-sourced or standalone
        -- card (no SO line at all) both go null together and the tile shows
        -- neither. That is the only pairing that cannot lie.
        sol.part_name AS item_name,
        -- The customer's drawing revision off the same SO line the item code
        -- already comes from, so the operator reads CODE/REV on one line. The
        -- sol join below is a LEFT JOIN, so a JW-sourced or standalone card
        -- still lists, with a null revision. Cast to text because the contract
        -- types it as a string and the column is only text on a database that
        -- has had migration 0119; without it, it is still an integer.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS item_revision,
        vs.available, jc.due_date
     ${READY_FROM(cid)}
     -- jc.code + op seq + op id last: a unique tail so paging never skips or repeats.
     ORDER BY COALESCE(jc.due_date,'9999-12-31') ASC, vs.available DESC, jc.code, o.op_seq, o.id
     LIMIT ${lim} OFFSET ${off}`,
  );
  const totalRows = await q(tx, `SELECT COUNT(*)::int AS c ${READY_FROM(cid)}`);
  const items: ReadyOpRow[] = readyRows.map((r) => ({
    jcCode: String(r['jc_code'] ?? ''),
    opSeq: num(r['op_seq']),
    operation: String(r['operation'] ?? ''),
    machine: (r['machine'] as string) ?? null,
    itemCode: (r['item_code'] as string) ?? null,
    itemRevision: (r['item_revision'] as string) ?? null,
    itemName: (r['item_name'] as string) ?? null,
    available: num(r['available']),
    dueDate: (r['due_date'] as string) ?? null,
    isOverdue: !!r['due_date'] && String(r['due_date']) < today,
  }));
  return { items, total: num(totalRows[0]?.['c']) };
}
