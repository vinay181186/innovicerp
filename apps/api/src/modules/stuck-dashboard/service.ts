// Stuck Activity Dashboard service. Mirror of legacy renderStuckDashboard
// (L18017). Scans active SOs and flags any phase running past its day
// threshold. Phase-level rules use the shared SO phase-data engine; the
// Production-Op / QC-Pending rules use the v_jc_op_status view (the SQL mirror
// of the legacy calcEngine enrichedOps). Pure rule helpers live in ./rules.

import type { StuckDashboardQuery, StuckDashboardResponse } from '@innovic/shared';
import { DEFAULT_STUCK_THRESHOLDS, stuckDashboardQuerySchema } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { loadSoPhaseData } from '../../lib/so-phase-data';
import { pageStuckItems } from './paging';
import { type OpStuckCandidate, classifyOpStuck, derivePhaseStuckItems } from './rules';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type OpRow = {
  so_id: string;
  so_no: string;
  customer: string | null;
  jc_no: string;
  op_seq: number;
  operation: string;
  available: string | number;
  qc_pending: string | number;
  completed_qty: string | number;
  jc_order_qty: string | number;
  last_entry: string | null;
  jc_date: string | null;
};

async function loadOpCandidates(tx: DbTransaction, companyId: string): Promise<OpStuckCandidate[]> {
  const cid = `'${companyId}'::uuid`;
  const res = await tx.execute(
    sql.raw(`
      SELECT
        so.id AS so_id, so.code AS so_no,
        COALESCE(cl.name, so.customer_name) AS customer,
        jc.code AS jc_no, vs.op_seq, o.operation,
        vs.available, vs.qc_pending, vs.completed_qty, jc.order_qty AS jc_order_qty,
        (SELECT MAX(ol.log_date) FROM op_log ol WHERE ol.jc_op_id = vs.jc_op_id) AS last_entry,
        jc.jc_date
      FROM v_jc_op_status vs
      JOIN jc_ops o ON o.id = vs.jc_op_id
      JOIN job_cards jc ON jc.id = vs.job_card_id
      JOIN sales_order_lines sl ON sl.id = jc.source_so_line_id
      JOIN sales_orders so ON so.id = sl.sales_order_id
      LEFT JOIN clients cl ON cl.id = so.client_id
      WHERE vs.company_id = ${cid}
        AND so.deleted_at IS NULL AND so.status NOT IN ('closed', 'cancelled')
        AND jc.deleted_at IS NULL AND o.deleted_at IS NULL
        AND vs.computed_status <> 'complete'
        AND (vs.available > 0 OR vs.qc_pending > 0)
    `),
  );
  return (res as unknown as OpRow[])
    .filter((r) => Number(r.completed_qty) < Number(r.jc_order_qty) || Number(r.qc_pending) > 0)
    .map((r) => ({
      soId: r.so_id,
      soNo: r.so_no,
      customer: r.customer,
      jcNo: r.jc_no,
      opSeq: Number(r.op_seq) || 0,
      operation: r.operation,
      available: Number(r.available) || 0,
      qcPending: Number(r.qc_pending) || 0,
      lastEntry: r.last_entry,
      jcDate: r.jc_date,
    }));
}

export async function getStuckDashboard(
  user: AuthContext,
  raw: StuckDashboardQuery = {},
): Promise<StuckDashboardResponse> {
  const input = stuckDashboardQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const thr = DEFAULT_STUCK_THRESHOLDS;
  const today = new Date().toISOString().substring(0, 10);

  return withUserContext(user, async (tx) => {
    const phaseData = await loadSoPhaseData(tx, companyId);
    const items = derivePhaseStuckItems(phaseData, thr, today);

    // Op-level rules: only for SOs where production started but QC not all done
    // (legacy gate L18067 `first_op_start && !last_qc_end`).
    const opGateSoIds = new Set(
      phaseData.filter((d) => d.phases.firstOpStart && !d.phases.lastQcEnd).map((d) => d.soId),
    );
    const candidates = await loadOpCandidates(tx, companyId);
    for (const c of candidates) {
      if (!opGateSoIds.has(c.soId)) continue;
      const item = classifyOpStuck(c, thr, today);
      if (item) items.push(item);
    }

    // ADR-207 — the Internal SO No. beside every SO No., read live from
    // sales_orders in one query (phase rows come from the shared phase engine).
    const soIds = [...new Set(items.map((i) => i.soId))];
    if (soIds.length > 0) {
      const intRows = (await tx.execute(sql`
        SELECT so.id::text AS id, so.internal_so_no AS internal
        FROM sales_orders so
        WHERE so.company_id = ${companyId}::uuid
          AND so.id IN (${sql.join(
            soIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
      `)) as unknown as Array<{ id: string; internal: string | null }>;
      const internalById = new Map(intRows.map((r) => [r.id, r.internal]));
      for (const it of items) it.soInternalNo = internalById.get(it.soId) ?? null;
    }

    // Sort by most-over-threshold (legacy L18107).
    items.sort((a, b) => b.days - b.threshold - (a.days - a.threshold));

    // One page (search + Sort & Filter on the server, ADR-201); the KPI strip
    // below stays over every stuck activity.
    const { page, total } = await pageStuckItems(tx, items, input);
    const stages = new Set(items.map((i) => i.stage));
    return {
      items: page,
      total,
      summary: {
        totalStuck: items.length,
        criticalStuck: items.filter((i) => i.days - i.threshold > 5).length,
        stagesAffected: stages.size,
      },
      thresholds: thr,
    };
  });
}
