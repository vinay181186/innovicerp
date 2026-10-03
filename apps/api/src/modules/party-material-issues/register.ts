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
  /** Pieces the first operation has CONSUMED — worked in-house PLUS sent out
   *  to an OSP vendor:
   *    Σ (qty + reject_qty) of the first op's 'complete' op_log rows
   *  + the first op's outsource_sent_qty.
   *  Rejects count — a rejected piece used up its material exactly like a good
   *  one (ADR-183, the same rule op-entry caps the first op with). Reversal
   *  rows (ADR-197) carry negative qty, so the sum nets them.
   *
   *  The outsource term (ADR-208) is why this is "consumed" and not merely
   *  "worked". When the FIRST operation is outsourced, the pieces leave on an
   *  OSP Outward DC, which is deliberately stock-neutral (ADR-067) and only
   *  bumps jc_ops.outsource_sent_qty — an outsourced op can never carry a
   *  'complete' op_log row (op-entry refuses in-house logging on an OSP op and
   *  Incoming QC mirrors its row onto the NEXT op as log_type 'qc'). Without
   *  this term `used` stayed 0 for ever and the caps below it let a storekeeper
   *  return or cancel an issue whose pieces are standing at the vendor. It is
   *  exactly what v_jc_op_status.available already subtracts for a plain op
   *  (completed + outsource_sent_qty), so the Job Card and the register agree.
   *
   *  The two terms never count the same PIECE: nothing writes a 'complete' row
   *  for a piece that came back from a vendor — op-entry refuses in-house
   *  logging on an OSP op, OSP returns land in GRN lines and the NEXT op's 'qc'
   *  rows, and NC re-injections are excluded by the log_no filter below. So a
   *  dual-lane op (ADR-081) adds two sets of different pieces.
   *
   *  They are NOT, however, bounded by the issued qty, and this is a KNOWN
   *  LIMIT, not an oversight — an earlier version of this comment claimed an
   *  invariant that does not hold. The outward gate computes
   *  `sendable = inputAvail − inHouseCompleted − outsourceSentQty` with
   *  `inHouseCompleted = SUM(qty)` only (delivery-challans/cascades.ts), so it
   *  ignores reject_qty while this figure counts it. On a dual-lane op with
   *  rejects, `used` can therefore exceed netIssued and BOTH reversals below
   *  will refuse for good. That is the safe direction — refuse, never permit —
   *  and it is the same stance party-grn cancel takes ("a counter that would go
   *  negative means the books disagree, and that must stop the cancel"), but
   *  the storekeeper's only explanation is the refusal text. Tightening the
   *  outward gate to subtract reject_qty would change what every OSP send is
   *  allowed to ship, for SO jobs as well, so it is a separate decision and is
   *  recorded as an open item on ADR-208 rather than slipped in here. */
  used: number;
}

export async function jcMaterial(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
  opts: { lockFirstOp?: boolean } = {},
): Promise<JcMaterial> {
  // Return-to-store / cancel must not race an operator logging work on the
  // first op (op-entry locks that jc_ops row) — take the same row lock first.
  if (opts.lockFirstOp) {
    await tx.execute(sql`
      SELECT id FROM public.jc_ops
       WHERE job_card_id = ${jobCardId}::uuid AND deleted_at IS NULL
       ORDER BY op_seq LIMIT 1
       FOR UPDATE
    `);
  }
  const rows = (await tx.execute(sql`
    WITH first_op AS (
      SELECT o.id, o.outsource_sent_qty FROM public.jc_ops o
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
      (COALESCE((
        SELECT SUM(l.qty + l.reject_qty)
          FROM public.op_log l
         WHERE l.jc_op_id = (SELECT id FROM first_op)
           -- Same rule as the JC Customer Material panel (job-cards
           -- JC_CUSTOMER_MATERIAL_SELECT): 'complete' rows (reversals carry the
           -- same type, negated, so they net), NC re-injections excluded — the
           -- caps and the "On JC" figure the user sees must agree.
           AND l.log_type = 'complete'
           AND l.log_no NOT LIKE '%LOG-NC-%'
      ), 0)
      -- ADR-208: pieces sent OUT from the first op are consumed too. The OSP
      -- Outward DC is stock-neutral (ADR-067) and only bumps this column, and
      -- an outsourced op can never carry a 'complete' op_log row — so without
      -- this term the caps let a storekeeper return or cancel material that is
      -- standing at the vendor. Same term as v_jc_op_status.available. Read
      -- inside the lockFirstOp row lock above (CLAUDE.md §20.3): the lock is on
      -- the very jc_ops row this reads. The panel copy in job-cards
      -- JC_CUSTOMER_MATERIAL_SELECT ("cmJcUsed") must stay identical.
      + COALESCE((SELECT outsource_sent_qty FROM first_op), 0))::int AS used
  `)) as unknown as Array<{ netIssued: number; used: number }>;
  return {
    netIssued: Number(rows[0]?.netIssued ?? 0),
    used: Number(rows[0]?.used ?? 0),
  };
}
