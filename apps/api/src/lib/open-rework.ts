// Per-op "still out on a rework/repair child" qty for the pure calc-engine.
//
// QC-NC audit 2026-09-21, gap 6: v_jc_op_status (0124 rework_child_open) holds
// an op away from `complete` while any rework/repair child raised on it is
// still open, so a JC never auto-closes with pieces out for recovery. The pure
// calc-engine that SO Status / SO Overview build their rollups from has no NC
// rows and read the op complete regardless. This loader is the one query that
// feeds enrichOps its optional `openReworkByOp` map — the same shape as
// lib/osp-accepted.ts feeds `ospAcceptedByOp` (ADR-167).
//
// Same rule as the view: Σ (rejected − cleared − failed) over NCs whose
// disposition raised a child card and that are not closed, keyed on the op the
// NC was raised on. The view keys on (job_card_id, op_seq); jc_op_id names the
// same op and is what the calc-engine ops carry.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** Σ open rework/repair-child qty keyed by jc_ops.id, for every op on the
 *  given job cards that has such an NC. Ops with nothing open are absent
 *  (read with `?? 0`). Empty input → empty map, no query. */
export async function loadOpenReworkByOp(
  tx: DbTransaction,
  companyId: string,
  jobCardIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobCardIds.length === 0) return out;
  const rows = await tx.execute(sql`
    SELECT nc.jc_op_id AS "jcOpId",
           GREATEST(0, SUM(nc.rejected_qty - nc.cleared_qty - nc.failed_qty))::int AS "openQty"
    FROM public.nc_register nc
    WHERE nc.company_id = ${companyId}::uuid
      AND nc.job_card_id IN (${sql.join(
        jobCardIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      AND nc.jc_op_id IS NOT NULL
      AND nc.status IN ('under_rework', 'under_repair')
      AND nc.child_job_card_id IS NOT NULL
      AND nc.deleted_at IS NULL
    GROUP BY nc.jc_op_id
  `);
  for (const r of rows as unknown as Array<{ jcOpId: string; openQty: number | string }>) {
    const qty = Number(r.openQty ?? 0);
    if (qty > 0) out.set(r.jcOpId, qty);
  }
  return out;
}
