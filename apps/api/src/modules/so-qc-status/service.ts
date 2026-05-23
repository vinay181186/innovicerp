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
  grnTotal: number;
  grnDone: number;
  docCount: number;
}): SoQcLine['overall'] {
  const hasAny =
    line.qcOpsTotal > 0 || line.tpiCount > 0 || line.grnTotal > 0 || line.docCount > 0;
  if (!hasAny) return 'none';
  const opsDone = line.qcPending === 0 && line.qcOpsPassed >= line.qcOpsTotal;
  const grnDone = line.grnDone >= line.grnTotal;
  // Docs in our model always carry a file once registered, so any present docs
  // count as satisfied; a line with zero docs doesn't gate "passed".
  if (opsDone && grnDone) return 'passed';
  if (line.qcOpsPassed > 0 || line.tpiCount > 0 || line.grnDone > 0 || line.docCount > 0) {
    return 'in_progress';
  }
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

    // Per-line GRN-QC aggregate. A GRN line attributes to an SO line via its
    // PO line: directly (purchase_order_lines.source_so_line_id, e.g. a direct
    // material purchase) OR via the outsource path (source_jc_op_id -> jc_ops
    // -> job_cards.source_so_line_id). "Done" = qc_status 'completed'.
    const grnRows = await tx.execute(sql`
      SELECT
        COALESCE(pol.source_so_line_id, jcx.source_so_line_id) AS "soLineId",
        COUNT(*)::int AS "grnTotal",
        COUNT(*) FILTER (WHERE gl.qc_status = 'completed')::int AS "grnDone",
        COALESCE(SUM(gl.received_qty), 0)::int AS "grnReceived",
        COALESCE(SUM(gl.qc_accepted_qty), 0)::int AS "grnAccepted",
        COALESCE(SUM(gl.qc_rejected_qty), 0)::int AS "grnRejected"
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes grn
        ON grn.id = gl.goods_receipt_note_id AND grn.deleted_at IS NULL
      JOIN public.purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
      LEFT JOIN public.jc_ops jo ON jo.id = pol.source_jc_op_id
      LEFT JOIN public.job_cards jcx ON jcx.id = jo.job_card_id AND jcx.deleted_at IS NULL
      JOIN public.sales_order_lines sol3
        ON sol3.id = COALESCE(pol.source_so_line_id, jcx.source_so_line_id)
       AND sol3.deleted_at IS NULL
      WHERE gl.company_id = ${companyId}::uuid
        AND gl.deleted_at IS NULL
        AND sol3.sales_order_id = ${soId}::uuid
      GROUP BY 1
    `);
    const grnByLine = new Map<
      string,
      { total: number; done: number; received: number; accepted: number; rejected: number }
    >();
    for (const r of grnRows as unknown as Array<Record<string, unknown>>) {
      grnByLine.set(r['soLineId'] as string, {
        total: Number(r['grnTotal'] ?? 0),
        done: Number(r['grnDone'] ?? 0),
        received: Number(r['grnReceived'] ?? 0),
        accepted: Number(r['grnAccepted'] ?? 0),
        rejected: Number(r['grnRejected'] ?? 0),
      });
    }

    // Per-line QC Documents — qc_documents registered against the line's JCs.
    const docRows = await tx.execute(sql`
      SELECT jc.source_so_line_id AS "soLineId", COUNT(*)::int AS "docCount"
      FROM public.qc_documents qd
      JOIN public.job_cards jc ON jc.id = qd.job_card_id AND jc.deleted_at IS NULL
      JOIN public.sales_order_lines sol4
        ON sol4.id = jc.source_so_line_id AND sol4.deleted_at IS NULL
      WHERE qd.company_id = ${companyId}::uuid
        AND qd.deleted_at IS NULL
        AND sol4.sales_order_id = ${soId}::uuid
      GROUP BY jc.source_so_line_id
    `);
    const docByLine = new Map<string, number>();
    for (const r of docRows as unknown as Array<Record<string, unknown>>) {
      docByLine.set(r['soLineId'] as string, Number(r['docCount'] ?? 0));
    }

    const lines: SoQcLine[] = (lineRows as unknown as Array<Record<string, unknown>>).map((r) => {
      const soLineId = r['soLineId'] as string;
      const tpi = tpiByLine.get(soLineId) ?? { count: 0, accepted: 0, rejected: 0 };
      const grn = grnByLine.get(soLineId) ?? {
        total: 0,
        done: 0,
        received: 0,
        accepted: 0,
        rejected: 0,
      };
      const docCount = docByLine.get(soLineId) ?? 0;
      const base = {
        qcOpsTotal: Number(r['qcOpsTotal'] ?? 0),
        qcOpsPassed: Number(r['qcOpsPassed'] ?? 0),
        qcPending: Number(r['qcPending'] ?? 0),
        tpiCount: tpi.count,
        grnTotal: grn.total,
        grnDone: grn.done,
        docCount,
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
        grnTotal: grn.total,
        grnDone: grn.done,
        grnReceived: grn.received,
        grnAccepted: grn.accepted,
        grnRejected: grn.rejected,
        docCount,
        overall: overallOf(base),
      };
    });

    return { so: toSelector(soRow), lines };
  });
}
