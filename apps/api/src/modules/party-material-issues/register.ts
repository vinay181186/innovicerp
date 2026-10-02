// ADR-203 — the customer-material figures that cap an Issue to JC, a Return to
// store and a Customer Material Return. Read-only sums; every caller holds the
// JWSO line's row lock (lockJwLine) BEFORE calling, so the figures cannot move
// between the read and the write (CLAUDE.md §20.3). All issues to a Job Card
// sit on the Job Card's source line, so the line lock also serialises the
// per-Job-Card figures.
//
// Line register balance (what is still in the customer-material register for
// one JWSO line):
//     accepted at Incoming QC (live Party GRN lines on the line)
//   − net issued to Job Cards (issue qty − returned to store, live issues)
//   − good pieces returned to the customer (non-cancelled CMR lines, kind good)
//
// Accepted is summed WITHOUT a qc_at filter on purpose: a line still waiting
// for QC carries accepted = 0 (CHECK party_grn_lines_qc_split_check), and the
// receipts booked before QC existed carry accepted = received with qc_at NULL
// (migration 0173 grandfathered them) — those pieces did enter the register.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

export interface JwLineRegister {
  accepted: number;
  netIssued: number;
  goodReturned: number;
  /** accepted − netIssued − goodReturned (never clamped — a negative is shown as is). */
  balance: number;
}

export async function jwLineRegister(
  tx: DbTransaction,
  companyId: string,
  jwLineId: string,
): Promise<JwLineRegister> {
  const rows = (await tx.execute(sql`
    SELECT
      COALESCE((
        SELECT SUM(pgl.accepted_qty)
          FROM public.party_grn_lines pgl
          JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
         WHERE pgl.jw_line_id = ${jwLineId}::uuid
           AND pgl.company_id = ${companyId}::uuid
           AND pgl.deleted_at IS NULL
      ), 0)::int AS accepted,
      COALESCE((
        SELECT SUM(mi.qty - mi.returned_to_store_qty)
          FROM public.party_material_issues mi
         WHERE mi.jw_line_id = ${jwLineId}::uuid
           AND mi.company_id = ${companyId}::uuid
           AND mi.deleted_at IS NULL
      ), 0)::int AS "netIssued",
      COALESCE((
        SELECT SUM(cl.qty)
          FROM public.customer_material_return_lines cl
          JOIN public.customer_material_returns c
            ON c.id = cl.return_id AND c.deleted_at IS NULL AND c.status <> 'cancelled'
         WHERE cl.jw_line_id = ${jwLineId}::uuid
           AND cl.company_id = ${companyId}::uuid
           AND cl.kind = 'good'
           AND cl.deleted_at IS NULL
      ), 0)::int AS "goodReturned"
  `)) as unknown as Array<{ accepted: number; netIssued: number; goodReturned: number }>;
  const r = rows[0];
  const accepted = Number(r?.accepted ?? 0);
  const netIssued = Number(r?.netIssued ?? 0);
  const goodReturned = Number(r?.goodReturned ?? 0);
  return { accepted, netIssued, goodReturned, balance: accepted - netIssued - goodReturned };
}

export interface JcMaterial {
  /** Σ (issue qty − returned to store) over the Job Card's live issues. */
  netIssued: number;
  /** Pieces the first operation has worked: Σ (qty + reject_qty) of its op_log
   *  rows. Rejects count — a rejected piece used up its material exactly like
   *  a good one (ADR-183, the same rule op-entry caps the first op with).
   *  Reversal rows (ADR-197) carry negative qty, so the sum nets them. */
  used: number;
}

export async function jcMaterial(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
): Promise<JcMaterial> {
  const rows = (await tx.execute(sql`
    WITH first_op AS (
      SELECT o.id FROM public.jc_ops o
       WHERE o.job_card_id = ${jobCardId}::uuid AND o.deleted_at IS NULL
       ORDER BY o.op_seq
       LIMIT 1
    )
    SELECT
      COALESCE((
        SELECT SUM(mi.qty - mi.returned_to_store_qty)
          FROM public.party_material_issues mi
         WHERE mi.job_card_id = ${jobCardId}::uuid
           AND mi.company_id = ${companyId}::uuid
           AND mi.deleted_at IS NULL
      ), 0)::int AS "netIssued",
      COALESCE((
        SELECT SUM(l.qty + l.reject_qty)
          FROM public.op_log l
         WHERE l.jc_op_id = (SELECT id FROM first_op)
      ), 0)::int AS used
  `)) as unknown as Array<{ netIssued: number; used: number }>;
  return {
    netIssued: Number(rows[0]?.netIssued ?? 0),
    used: Number(rows[0]?.used ?? 0),
  };
}
