// ADR-324 line undo (P1) — "Undo decision" on an NC, as a Cancel Request of
// type nc_disposition (doc_id = the NC id). P1 covers customer-material NCs
// (raised at Party GRN Incoming QC on a JWSO Party GRN) only.
//
//   use_as_is          → the pieces go back from Accepted to Deviated through
//                        the inverse of the Use As Is writer
//                        (party-grn/deviation.ts undoPartyGrnUseAsIs: register
//                        reversal / out, received_qty down);
//   scrap              → nothing was ever posted, nothing to take back;
//   return_to_customer → nothing posted; refused while any piece went back on
//                        a live Customer Material Return.
// Then the NC is back to NC Raised ('pending') with its decision fields
// cleared, written conditionally on the status + disposition read under the
// NC lock (§20.2). A split sibling NC (split_from_nc_id) is left alone — it is
// its own NC with its own decision.
//
// DOCUMENTED EXCEPTION to NC_STATUS_MOVES (packages/shared status-moves.ts):
// moving a decided NC (closed / disposed) back to 'pending' is not a move the
// map allows, and the map is NOT widened for it. The decision is undone only
// here, by an approved Undo decision request, after its effects were taken
// back in the same transaction — the same shape as
// customer-material-returns rebalanceReturnToCustomerNcs re-opening a closed
// NC when the return it rested on is cancelled.
//
// LOCK ORDER = the disposition's own: the NC (lock), then the JWSO line, then
// the Party GRN line, then the material (all inside undoPartyGrnUseAsIs).

import {
  ActivityAction,
  type CancelBlocker,
  type CancelEffect,
  NC_DISPOSITION_LABELS,
  NC_STATUS_LABELS,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { labelOf } from '../../lib/status-labels';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import type { CancelHandler } from '../cancel-requests/registry';
import { undoPartyGrnUseAsIs } from '../party-grn/deviation';
import { jwLineRegisterBalance } from '../party-grn/service';

interface NcRow {
  id: string;
  code: string;
  status: string;
  disposition: string | null;
  partyGrnLineId: string | null;
  clearedQty: number;
  rtvSentQty: number;
  deleted: boolean;
  lineNo: number | null;
  lineDead: boolean | null;
  jwLineId: string | null;
  partyMaterialId: string | null;
  grnId: string | null;
  grnCode: string | null;
  grnDead: boolean | null;
  salesOrderId: string | null;
}

async function readNc(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
  forUpdate: boolean,
): Promise<NcRow | null> {
  const rows = (await tx.execute(sql`
    SELECT nc.id, nc.code, nc.status::text AS status, nc.disposition::text AS disposition,
           nc.party_grn_line_id AS "partyGrnLineId",
           nc.cleared_qty::float8 AS "clearedQty", nc.rtv_sent_qty::float8 AS "rtvSentQty",
           (nc.deleted_at IS NOT NULL) AS deleted,
           pgl.line_no AS "lineNo", (pgl.deleted_at IS NOT NULL) AS "lineDead",
           pgl.jw_line_id AS "jwLineId", pgl.party_material_id AS "partyMaterialId",
           pg.id AS "grnId", pg.code AS "grnCode",
           (pg.deleted_at IS NOT NULL OR pg.cancelled_at IS NOT NULL) AS "grnDead",
           pg.sales_order_id AS "salesOrderId"
      FROM public.nc_register nc
      LEFT JOIN public.party_grn_lines pgl ON pgl.id = nc.party_grn_line_id
      LEFT JOIN public.party_grn pg ON pg.id = pgl.party_grn_id
     WHERE nc.id = ${ncId}::uuid AND nc.company_id = ${companyId}::uuid
     ${forUpdate ? sql`FOR UPDATE OF nc` : sql``}
  `)) as unknown as NcRow[];
  const r = rows[0];
  if (!r) return null;
  return { ...r, clearedQty: Number(r.clearedQty), rtvSentQty: Number(r.rtvSentQty) };
}

async function ncUndoBlockers(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
): Promise<CancelBlocker[]> {
  const nc = await readNc(tx, companyId, ncId, false);
  if (!nc) throw new NotFoundError('NC not found. Refresh the page.');
  const href = `/nc-register/${nc.id}`;
  const self = (reason: string): CancelBlocker[] => [
    { docLabel: 'NC', docNo: nc.code, href, reason },
  ];
  if (!nc.partyGrnLineId) {
    return self('Undo decision is available for customer-material NCs only for now');
  }
  if (nc.status === 'pending' || !nc.disposition) return self('no decision to undo');
  if (nc.grnDead || nc.lineDead) {
    return [
      {
        docLabel: 'Party GRN',
        docNo: nc.grnCode ?? 'Party GRN',
        href: nc.grnId ? `/party-grn/${nc.grnId}` : null,
        reason: 'it is cancelled',
      },
    ];
  }
  if (nc.salesOrderId || !nc.jwLineId) {
    return self('Undo decision is available for JWSO customer material only for now');
  }

  const out: CancelBlocker[] = [];
  if (nc.disposition === 'return_to_customer') {
    const cmrs = (await tx.execute(sql`
      SELECT r.code, SUM(cl.qty)::int AS qty
        FROM public.customer_material_return_lines cl
        JOIN public.customer_material_returns r ON r.id = cl.return_id
       WHERE cl.party_grn_line_id = ${nc.partyGrnLineId}::uuid
         AND cl.kind = 'rejected' AND cl.deleted_at IS NULL
         AND r.company_id = ${companyId}::uuid
         AND r.deleted_at IS NULL AND r.status <> 'cancelled'
       GROUP BY r.code
       ORDER BY r.code
    `)) as unknown as Array<{ code: string; qty: number }>;
    for (const c of cmrs) {
      out.push({
        docLabel: 'Customer Material Return',
        docNo: c.code,
        href: '/customer-material-returns',
        reason: `cancel Customer Material Return ${c.code} first (${Number(c.qty)} pcs sent back)`,
      });
    }
    if (cmrs.length === 0 && nc.rtvSentQty > 0) {
      out.push(
        ...self(
          `its Sent back count (${nc.rtvSentQty}) has no live Customer Material Return behind ` +
            'it — the count is out of step; report this to the administrator',
        ),
      );
    }
  }
  if (nc.disposition === 'use_as_is' && nc.partyMaterialId) {
    const balance = await jwLineRegisterBalance(tx, nc.jwLineId, nc.partyMaterialId);
    if (balance < nc.clearedQty) {
      const tail = `— undo needs ${nc.clearedQty} back, only ${balance} left in the register`;
      const issues = (await tx.execute(sql`
        SELECT mi.code, mi.jc_code_text AS "jcCode",
               (mi.qty - mi.returned_to_store_qty)::int AS net
          FROM public.party_material_issues mi
         WHERE mi.jw_line_id = ${nc.jwLineId}::uuid
           AND mi.party_material_id = ${nc.partyMaterialId}::uuid
           AND mi.company_id = ${companyId}::uuid
           AND mi.deleted_at IS NULL
           AND mi.qty - mi.returned_to_store_qty > 0
         ORDER BY mi.code
      `)) as unknown as Array<{ code: string; jcCode: string | null; net: number }>;
      const returns = (await tx.execute(sql`
        SELECT r.code, SUM(cl.qty)::int AS qty
          FROM public.customer_material_return_lines cl
          JOIN public.customer_material_returns r ON r.id = cl.return_id
         WHERE cl.jw_line_id = ${nc.jwLineId}::uuid
           AND cl.party_material_id = ${nc.partyMaterialId}::uuid
           AND cl.kind = 'good' AND cl.deleted_at IS NULL
           AND r.company_id = ${companyId}::uuid
           AND r.deleted_at IS NULL AND r.status <> 'cancelled'
         GROUP BY r.code
         ORDER BY r.code
      `)) as unknown as Array<{ code: string; qty: number }>;
      for (const mi of issues) {
        out.push({
          docLabel: 'Customer Material Issue',
          docNo: mi.code,
          href: null,
          reason: `issued ${Number(mi.net)} to ${mi.jcCode ?? 'a Job Card'} ${tail}`,
        });
      }
      for (const r of returns) {
        out.push({
          docLabel: 'Customer Material Return',
          docNo: r.code,
          href: '/customer-material-returns',
          reason: `returned ${Number(r.qty)} to the customer ${tail}`,
        });
      }
      if (issues.length === 0 && returns.length === 0) {
        out.push(
          ...self(`the register holds only ${balance} ${tail} — report this to the administrator`),
        );
      }
    }
  }
  return out;
}

async function ncUndoEffects(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
): Promise<CancelEffect[]> {
  const nc = await readNc(tx, companyId, ncId, false);
  if (!nc || !nc.disposition) return [];
  const out: CancelEffect[] = [];
  const at = nc.grnCode && nc.lineNo != null ? `${nc.grnCode} Ln ${nc.lineNo}` : nc.code;
  if (nc.disposition === 'use_as_is' && nc.clearedQty > 0) {
    out.push({
      kind: 'stock',
      text: `${at} — ${nc.clearedQty} used as is leave the customer material register and go back to Deviated`,
      qty: -nc.clearedQty,
    });
  }
  out.push({
    kind: 'note',
    text: `${nc.code} goes back to ${labelOf(NC_STATUS_LABELS, 'pending')} — decide it again`,
    qty: null,
  });
  return out;
}

/** The Undo decision worker — in the approver's transaction. */
export async function undoNcDispositionTx(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to undo a decision.');
  const nc = await readNc(tx, companyId, ncId, true);
  if (!nc || nc.deleted) throw new NotFoundError('NC not found. Refresh the page.');
  const blockers = await ncUndoBlockers(tx, companyId, ncId);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(nc.code, blockers), { blockers });
  if (nc.grnId) await assertNoPendingCancel(tx, 'party_grn', nc.grnId);

  if (nc.disposition === 'use_as_is' && nc.clearedQty > 0) {
    await undoPartyGrnUseAsIs(
      tx,
      {
        companyId,
        partyGrnLineId: nc.partyGrnLineId!,
        qty: nc.clearedQty,
        ncCode: nc.code,
        reason: trimmed,
      },
      user,
    );
  }

  // §20.2 — only the decision that was read under the NC lock is undone.
  const reset = (await tx.execute(sql`
    UPDATE public.nc_register
       SET status = 'pending',
           disposition = NULL, disposition_date = NULL, disposition_by_text = NULL,
           disposition_by = NULL, disposition_at = NULL, disposition_remarks = NULL,
           cleared_qty = 0, failed_qty = 0, scrap_cost = 0, rtv_sent_qty = 0,
           closed_at = NULL, closed_by = NULL,
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${nc.id}::uuid AND deleted_at IS NULL
       AND status::text = ${nc.status} AND disposition::text = ${nc.disposition}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (reset.length === 0) {
    throw new ConflictError(`NC ${nc.code} changed a moment ago. Refresh the page.`);
  }

  const decision = labelOf(NC_DISPOSITION_LABELS, nc.disposition);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Reverse,
      entity: 'NonConformance',
      entityId: nc.id,
      refId: nc.code,
      qty: nc.disposition === 'use_as_is' ? nc.clearedQty : null,
      reason: trimmed,
      changes: [
        {
          field: 'status',
          label: 'Status',
          before: labelOf(NC_STATUS_LABELS, nc.status),
          after: labelOf(NC_STATUS_LABELS, 'pending'),
        },
      ],
      detail: `${nc.code} decision (${decision}) undone — ${trimmed}`,
    },
    companyId,
    user,
  );
}

export const ncDispositionCancelHandler: CancelHandler = {
  docType: 'nc_disposition',
  // NC edits are staged under this entity (doc_id = the NC id).
  editEntity: 'NonConformance',
  async lock(tx, companyId, docId, forUpdate) {
    const nc = await readNc(tx, companyId, docId, forUpdate);
    // "Cancelled" here = the NC itself is gone; a pending NC is refused by
    // the blockers ("no decision to undo"), not as already cancelled.
    return nc ? { code: nc.code, cancelled: nc.deleted } : null;
  },
  blockers: ncUndoBlockers,
  effects: ncUndoEffects,
  async run(tx, companyId, docId, reason, actor) {
    await undoNcDispositionTx(tx, companyId, docId, reason, actor);
  },
};
