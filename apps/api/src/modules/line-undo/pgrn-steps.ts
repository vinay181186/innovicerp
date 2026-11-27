// ADR-324 line undo — the Party GRN part of a JWSO line's Undo list and the
// Customer Material Issue "return to store" step.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { type BuiltStep, cancelStep, ids, q } from './step-kit';

/** The Party GRN part: per line NC decisions → Reverse QC → remove line. */
export async function partyGrnSteps(
  tx: DbTransaction,
  companyId: string,
  jwLineId: string,
): Promise<BuiltStep[]> {
  const lines = await q<{
    id: string;
    lineNo: number;
    grnId: string;
    grnCode: string;
    acceptedQty: number;
    rejectedQty: number;
    qcAt: unknown;
    liveLines: number;
  }>(
    tx,
    sql`
      SELECT pgl.id, pgl.line_no AS "lineNo", pg.id AS "grnId", pg.code AS "grnCode",
             pgl.accepted_qty::int AS "acceptedQty", pgl.rejected_qty::int AS "rejectedQty",
             pgl.qc_at AS "qcAt",
             (SELECT count(*)::int FROM public.party_grn_lines x
               WHERE x.party_grn_id = pg.id AND x.deleted_at IS NULL) AS "liveLines"
        FROM public.party_grn_lines pgl
        JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
       WHERE pgl.jw_line_id = ${jwLineId}::uuid AND pgl.company_id = ${companyId}::uuid
         AND pgl.deleted_at IS NULL
       ORDER BY pg.created_at DESC, pgl.line_no DESC
    `,
  );
  if (lines.length === 0) return [];
  const ncs = await q<{ id: string; code: string; lineId: string; disposition: string }>(
    tx,
    sql`
      SELECT id, code, party_grn_line_id AS "lineId", disposition::text AS disposition
        FROM public.nc_register
       WHERE party_grn_line_id IN (${ids(lines.map((l) => l.id))})
         AND company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND status <> 'pending' AND disposition IS NOT NULL
       ORDER BY created_at DESC, code DESC
    `,
  );
  const out: BuiltStep[] = [];
  // Lines of one GRN already listed for removal — the last one left cancels the GRN.
  const removed = new Map<string, number>();
  for (const l of lines) {
    const code = `${l.grnCode} Ln ${l.lineNo}`;
    const href = `/party-grn/${l.grnId}`;
    for (const nc of ncs.filter((n) => n.lineId === l.id)) {
      out.push(
        cancelStep(
          'nc_disposition',
          nc.id,
          nc.code,
          `/nc-register/${nc.id}`,
          `Undo the decision — ${nc.code} goes back to NC Raised`,
          'Undo decision',
        ),
      );
    }
    const touched = l.qcAt != null || l.acceptedQty > 0 || l.rejectedQty > 0;
    if (touched) {
      out.push(
        cancelStep(
          'party_grn_line_qc',
          l.id,
          code,
          href,
          `Reverse QC — ${l.acceptedQty} accepted leave the customer material register; the line waits for QC again`,
          'Reverse QC',
        ),
      );
    }
    const before = removed.get(l.grnId) ?? 0;
    if (l.liveLines - before <= 1) {
      out.push(
        cancelStep('party_grn', l.grnId, l.grnCode, href, `Cancel the Party GRN — ${code} is its last line`),
      );
    } else {
      out.push(
        cancelStep('party_grn_line', l.id, code, href, 'Remove the line from the Party GRN', 'Remove line'),
      );
    }
    removed.set(l.grnId, before + 1);
  }
  return out;
}

export function pmiStep(m: { id: string; code: string; left: number }): BuiltStep {
  return {
    step: {
      key: `return_party_issue:${m.id}`,
      kind: 'return_party_issue',
      docType: null,
      docId: m.id,
      docLabel: 'Customer Material Issue',
      docCode: m.code,
      whatHappens: `Return ${m.left} pcs to the customer material store`,
      actionLabel: 'Return to store',
      href: `/party-material?search=${encodeURIComponent(m.code)}`,
      needsApproval: false,
      state: 'todo',
      manualReason: null,
    },
    run: { kind: 'return_party_issue', issueId: m.id, qty: m.left },
  };
}

