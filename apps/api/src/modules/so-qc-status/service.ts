// SO QC Status service (QC Wave 4) — read-only.
//
// GET /so-qc-status        -> SO selector list.
// GET /so-qc-status/:soId  -> per-line QC-stage rollup (QC ops + TPI) for one SO.
// Mirrors legacy renderSOQCStatus (HTML L18347). Raw SQL over sales_order_lines
// -> job_cards (source_so_line_id) -> v_jc_op_status + op_log (is_tpi). RLS via
// base tables.

import { sql } from 'drizzle-orm';
import type {
  ListSoForQcResponse,
  SoQcLine,
  SoQcSelector,
  SoQcStatusResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function toSelector(r: Record<string, unknown>): SoQcSelector {
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    customerName: (r['customerName'] as string | null) ?? null,
    status: (r['status'] as string | null) ?? 'Open',
    soDate: dateLike(r['soDate']),
  };
}

export async function listSoForQc(user: AuthContext): Promise<ListSoForQcResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName", so.status, so.so_date AS "soDate"
      FROM public.sales_orders so
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        AND so.status <> 'cancelled'
      ORDER BY so.so_date DESC, so.code DESC
    `);
    return { sos: (rows as unknown as Array<Record<string, unknown>>).map(toSelector) };
  });
}

function overallOf(line: {
  qcOpsTotal: number;
  qcOpsPassed: number;
  qcPending: number;
  tpiCount: number;
}): SoQcLine['overall'] {
  if (line.qcOpsTotal === 0 && line.tpiCount === 0) return 'none';
  if (line.qcPending === 0 && line.qcOpsPassed >= line.qcOpsTotal) return 'passed';
  if (line.qcOpsPassed > 0 || line.tpiCount > 0) return 'in_progress';
  return 'pending';
}

export async function getSoQcStatus(soId: string, user: AuthContext): Promise<SoQcStatusResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const soRows = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName", so.status, so.so_date AS "soDate"
      FROM public.sales_orders so
      WHERE so.id = ${soId}::uuid AND so.company_id = ${companyId}::uuid AND so.deleted_at IS NULL
    `);
    const soRow = (soRows as unknown as Array<Record<string, unknown>>)[0];
    if (!soRow) throw new NotFoundError(`Sales order ${soId} not found`);

    // Per-line QC-ops aggregate (qc ops on JCs sourced from the line).
    const lineRows = await tx.execute(sql`
      SELECT
        sol.id AS "soLineId", sol.line_no AS "lineNo",
        COALESCE(i.code, sol.item_code_text) AS "itemCode", sol.part_name AS "partName",
        sol.order_qty AS "orderQty",
        COUNT(DISTINCT jc.id)::int AS "jcCount",
        COUNT(vos.jc_op_id) FILTER (WHERE vos.qc_required OR vos.op_type = 'qc')::int AS "qcOpsTotal",
        COUNT(vos.jc_op_id) FILTER (
          WHERE (vos.qc_required OR vos.op_type = 'qc') AND vos.computed_status = 'complete'
        )::int AS "qcOpsPassed",
        COALESCE(SUM(vos.qc_accepted_qty) FILTER (WHERE vos.qc_required OR vos.op_type = 'qc'), 0)::int AS "qcAccepted",
        COALESCE(SUM(vos.qc_rejected_qty) FILTER (WHERE vos.qc_required OR vos.op_type = 'qc'), 0)::int AS "qcRejected",
        COALESCE(SUM(vos.qc_pending) FILTER (WHERE vos.qc_required OR vos.op_type = 'qc'), 0)::int AS "qcPending"
      FROM public.sales_order_lines sol
      LEFT JOIN public.items i ON i.id = sol.item_id
      LEFT JOIN public.job_cards jc ON jc.source_so_line_id = sol.id AND jc.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status vos ON vos.job_card_id = jc.id
      WHERE sol.sales_order_id = ${soId}::uuid AND sol.deleted_at IS NULL
      GROUP BY sol.id, sol.line_no, i.code, sol.item_code_text, sol.part_name, sol.order_qty
      ORDER BY sol.line_no
    `);

    // Per-line TPI aggregate (op_log.is_tpi on JCs sourced from the SO's lines).
    const tpiRows = await tx.execute(sql`
      SELECT jc.source_so_line_id AS "soLineId",
        COUNT(*)::int AS "tpiCount",
        COALESCE(SUM(ol.qty), 0)::int AS "tpiAccepted",
        COALESCE(SUM(ol.reject_qty), 0)::int AS "tpiRejected"
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      JOIN public.sales_order_lines sol2 ON sol2.id = jc.source_so_line_id
      WHERE ol.company_id = ${companyId}::uuid
        AND ol.is_tpi = true
        AND sol2.sales_order_id = ${soId}::uuid
      GROUP BY jc.source_so_line_id
    `);
    const tpiByLine = new Map<string, { count: number; accepted: number; rejected: number }>();
    for (const r of tpiRows as unknown as Array<Record<string, unknown>>) {
      tpiByLine.set(r['soLineId'] as string, {
        count: Number(r['tpiCount'] ?? 0),
        accepted: Number(r['tpiAccepted'] ?? 0),
        rejected: Number(r['tpiRejected'] ?? 0),
      });
    }

    const lines: SoQcLine[] = (lineRows as unknown as Array<Record<string, unknown>>).map((r) => {
      const soLineId = r['soLineId'] as string;
      const tpi = tpiByLine.get(soLineId) ?? { count: 0, accepted: 0, rejected: 0 };
      const base = {
        qcOpsTotal: Number(r['qcOpsTotal'] ?? 0),
        qcOpsPassed: Number(r['qcOpsPassed'] ?? 0),
        qcPending: Number(r['qcPending'] ?? 0),
        tpiCount: tpi.count,
      };
      return {
        soLineId,
        lineNo: Number(r['lineNo']),
        itemCode: (r['itemCode'] as string | null) ?? null,
        partName: (r['partName'] as string | null) ?? null,
        orderQty: Number(r['orderQty'] ?? 0),
        jcCount: Number(r['jcCount'] ?? 0),
        qcOpsTotal: base.qcOpsTotal,
        qcOpsPassed: base.qcOpsPassed,
        qcAccepted: Number(r['qcAccepted'] ?? 0),
        qcRejected: Number(r['qcRejected'] ?? 0),
        qcPending: base.qcPending,
        tpiCount: tpi.count,
        tpiAccepted: tpi.accepted,
        tpiRejected: tpi.rejected,
        overall: overallOf(base),
      };
    });

    return { so: toSelector(soRow), lines };
  });
}
