// SO QC Status service (QC Wave 4 + 2026-05-27 legacy-parity rebuild) — read-only.
//
// GET /so-qc-status        -> SO selector list.
// GET /so-qc-status/:soId  -> per-line QC-stage rollup (QC ops + TPI + GRN-QC +
//                             Docs) for one SO, with per-JC/per-op stage rows,
//                             an overall % and expandable detail arrays.
// Mirrors legacy renderSOQCStatus (HTML L18347). Raw SQL over sales_order_lines
// -> job_cards (source_so_line_id) -> v_jc_op_status + jc_ops + op_log (is_tpi),
// goods_receipt_note_lines, qc_documents. RLS via base tables.
//
// Deferred: per-GRN-line / per-TPI "Report View" download link (owned by a
// separate QC-report-attachment task) — detail arrays omit it.

import { sql } from 'drizzle-orm';
import type {
  ListSoForQcResponse,
  SoQcDocDetail,
  SoQcGrnDetail,
  SoQcJcStage,
  SoQcLine,
  SoQcSelector,
  SoQcStageOp,
  SoQcStageStatus,
  SoQcStatusResponse,
  SoQcTpiDetail,
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

function num(v: unknown): number {
  return Number(v ?? 0);
}

function rows(r: unknown): Array<Record<string, unknown>> {
  return r as unknown as Array<Record<string, unknown>>;
}

function toSelector(r: Record<string, unknown>): SoQcSelector {
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    customerName: (r['customerName'] as string | null) ?? null,
    status: (r['status'] as string | null) ?? 'Open',
    soDate: dateLike(r['soDate']),
    dueDate: dateLike(r['dueDate']),
    type: (r['type'] as string | null) ?? null,
  };
}

export async function listSoForQc(user: AuthContext): Promise<ListSoForQcResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName", so.status,
             so.so_date AS "soDate", so.type
      FROM public.sales_orders so
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        AND so.status <> 'cancelled'
      ORDER BY so.so_date DESC, so.code DESC
    `);
    return { sos: rows(rs).map(toSelector) };
  });
}

// Stage status per QC op (legacy L18412). orderQty is the op's input quantity
// (v_jc_op_status.input_avail for QC ops). accepted/rejected from the view.
function stageStatus(
  orderQty: number,
  accepted: number,
  rejected: number,
  attempts: number,
): SoQcStageStatus {
  if (orderQty > 0 && accepted >= orderQty) return rejected > 0 ? 'passed_rej' : 'passed';
  const pending = Math.max(0, orderQty - accepted - rejected);
  if (attempts > 0 && pending > 0) return 'in_progress';
  if (attempts > 0) return rejected > 0 ? 'passed_rej' : 'passed';
  return 'no_pass';
}

// Overall % across all stage items (legacy L18472-18477).
function overallPctOf(line: {
  qcOpsTotal: number;
  qcOpsPassed: number;
  grnTotal: number;
  grnDone: number;
  tpiCount: number;
  docCount: number;
  docUploaded: number;
}): number {
  const totalItems =
    line.qcOpsTotal + line.grnTotal + (line.tpiCount > 0 ? 1 : 0) + line.docCount;
  const doneItems = line.qcOpsPassed + line.grnDone + line.tpiCount + line.docUploaded;
  return totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
}

function overallOf(line: {
  hasAnyQc: boolean;
  qcOpsTotal: number;
  qcOpsPassed: number;
  qcPending: number;
  tpiCount: number;
  grnTotal: number;
  grnDone: number;
  docCount: number;
}): SoQcLine['overall'] {
  if (!line.hasAnyQc) return 'none';
  const opsDone = line.qcPending === 0 && line.qcOpsPassed >= line.qcOpsTotal;
  const grnDone = line.grnDone >= line.grnTotal;
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
      SELECT so.id, so.code, so.customer_name AS "customerName", so.status,
             so.so_date AS "soDate", so.type
      FROM public.sales_orders so
      WHERE so.id = ${soId}::uuid AND so.company_id = ${companyId}::uuid AND so.deleted_at IS NULL
    `);
    const soRow = rows(soRows)[0];
    if (!soRow) throw new NotFoundError(`Sales order ${soId} not found`);

    // SO header carries due date too. sales_orders has no due_date; the legacy
    // SO header reads it from the SO record. Our model holds due dates on the
    // SO *lines*; surface the earliest line due date as the SO due date.
    const dueRows = await tx.execute(sql`
      SELECT MIN(sol.due_date) AS "dueDate"
      FROM public.sales_order_lines sol
      WHERE sol.sales_order_id = ${soId}::uuid AND sol.deleted_at IS NULL
    `);
    const soDueDate = dateLike(rows(dueRows)[0]?.['dueDate']);

    // ── Per-line QC-ops aggregate (qc ops on JCs sourced from the line) ──
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

    // ── Per-JC / per-QC-op stage rows (legacy jcQCData / L18510-18530). One row
    // per QC op on each JC sourced from a line of this SO. attempts = # of QC
    // op_log entries for that jc_op (drives the [Nx] attempt-count badge). ──
    const stageRows = await tx.execute(sql`
      SELECT
        jc.source_so_line_id AS "soLineId",
        jc.id AS "jobCardId", jc.code AS "jcCode",
        jo.id AS "jcOpId", jo.op_seq AS "opSeq", jo.operation,
        vos.input_avail AS "orderQty",
        vos.qc_accepted_qty AS "accepted",
        vos.qc_rejected_qty AS "rejected",
        vos.qc_pending AS "pending",
        COALESCE(att.attempts, 0)::int AS "attempts"
      FROM public.job_cards jc
      JOIN public.sales_order_lines sol2
        ON sol2.id = jc.source_so_line_id AND sol2.deleted_at IS NULL
      JOIN public.jc_ops jo ON jo.job_card_id = jc.id AND jo.deleted_at IS NULL
        AND (jo.qc_required OR jo.op_type = 'qc')
      LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
      LEFT JOIN (
        SELECT jc_op_id, COUNT(*)::int AS attempts
        FROM public.op_log
        WHERE log_type = 'qc' AND company_id = ${companyId}::uuid
        GROUP BY jc_op_id
      ) att ON att.jc_op_id = jo.id
      WHERE jc.deleted_at IS NULL
        AND sol2.sales_order_id = ${soId}::uuid
      ORDER BY jc.code, jo.op_seq
    `);
    // Group stage rows -> per line -> per JC (preserving JC + op order).
    const stagesByLine = new Map<string, SoQcJcStage[]>();
    for (const r of rows(stageRows)) {
      const lineId = r['soLineId'] as string;
      const jobCardId = r['jobCardId'] as string;
      const jcCode = r['jcCode'] as string;
      const orderQty = num(r['orderQty']);
      const accepted = num(r['accepted']);
      const rejected = num(r['rejected']);
      const pending = num(r['pending']);
      const attempts = num(r['attempts']);
      const op: SoQcStageOp = {
        opSeq: num(r['opSeq']),
        operation: (r['operation'] as string) ?? 'QC',
        orderQty,
        accepted,
        rejected,
        pending,
        attempts,
        status: stageStatus(orderQty, accepted, rejected, attempts),
      };
      let jcs = stagesByLine.get(lineId);
      if (!jcs) {
        jcs = [];
        stagesByLine.set(lineId, jcs);
      }
      let jc = jcs.find((g) => g.jobCardId === jobCardId);
      if (!jc) {
        jc = { jobCardId, jcCode, ops: [] };
        jcs.push(jc);
      }
      jc.ops.push(op);
    }

    // ── Per-line TPI aggregate + detail (op_log.is_tpi on JCs sourced from
    // the SO's lines). ──
    const tpiRows = await tx.execute(sql`
      SELECT
        jc.source_so_line_id AS "soLineId",
        jc.code AS "jcCode",
        ol.tpi_organization AS "organization",
        ol.tpi_inspector AS "inspector",
        ol.qty AS "accepted",
        ol.reject_qty AS "rejected",
        ol.log_date AS "date"
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      JOIN public.sales_order_lines sol2 ON sol2.id = jc.source_so_line_id
      WHERE ol.company_id = ${companyId}::uuid
        AND ol.is_tpi = true
        AND sol2.sales_order_id = ${soId}::uuid
      ORDER BY jc.code, ol.log_date
    `);
    const tpiByLine = new Map<string, SoQcTpiDetail[]>();
    for (const r of rows(tpiRows)) {
      const lineId = r['soLineId'] as string;
      const rejected = num(r['rejected']);
      const detail: SoQcTpiDetail = {
        jcCode: (r['jcCode'] as string) ?? '',
        organization: (r['organization'] as string | null) ?? null,
        inspector: (r['inspector'] as string | null) ?? null,
        accepted: num(r['accepted']),
        rejected,
        date: dateLike(r['date']),
        status: rejected > 0 ? 'partial' : 'passed',
      };
      const arr = tpiByLine.get(lineId);
      if (arr) arr.push(detail);
      else tpiByLine.set(lineId, [detail]);
    }

    // ── Per-line GRN-QC aggregate + detail. A GRN line attributes to an SO
    // line via its PO line: directly (purchase_order_lines.source_so_line_id)
    // OR via the outsource path (source_jc_op_id -> jc_ops ->
    // job_cards.source_so_line_id). "Done" = qc_status 'completed'. ──
    const grnRows = await tx.execute(sql`
      SELECT
        COALESCE(pol.source_so_line_id, jcx.source_so_line_id) AS "soLineId",
        grn.code AS "grnNo",
        COALESCE(gi.code, gl.item_code_text) AS "itemCode",
        COALESCE(v.name, grn.vendor_code_text) AS "vendorName",
        gl.received_qty AS "receivedQty",
        gl.qc_accepted_qty AS "accepted",
        gl.qc_rejected_qty AS "rejected",
        (gl.received_qty - gl.qc_accepted_qty - gl.qc_rejected_qty) AS "pending",
        gl.qc_status AS "qcStatus"
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes grn
        ON grn.id = gl.goods_receipt_note_id AND grn.deleted_at IS NULL
      JOIN public.purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
      LEFT JOIN public.jc_ops jo ON jo.id = pol.source_jc_op_id
      LEFT JOIN public.job_cards jcx ON jcx.id = jo.job_card_id AND jcx.deleted_at IS NULL
      LEFT JOIN public.items gi ON gi.id = gl.item_id
      LEFT JOIN public.vendors v ON v.id = grn.vendor_id
      JOIN public.sales_order_lines sol3
        ON sol3.id = COALESCE(pol.source_so_line_id, jcx.source_so_line_id)
       AND sol3.deleted_at IS NULL
      WHERE gl.company_id = ${companyId}::uuid
        AND gl.deleted_at IS NULL
        AND sol3.sales_order_id = ${soId}::uuid
      ORDER BY grn.code, gl.line_no
    `);
    const grnByLine = new Map<
      string,
      {
        detail: SoQcGrnDetail[];
        total: number;
        done: number;
        received: number;
        accepted: number;
        rejected: number;
      }
    >();
    for (const r of rows(grnRows)) {
      const lineId = r['soLineId'] as string;
      const status = r['qcStatus'] === 'completed' ? ('done' as const) : ('pending' as const);
      const detail: SoQcGrnDetail = {
        grnNo: (r['grnNo'] as string) ?? '',
        itemCode: (r['itemCode'] as string | null) ?? null,
        vendorName: (r['vendorName'] as string | null) ?? null,
        receivedQty: num(r['receivedQty']),
        accepted: num(r['accepted']),
        rejected: num(r['rejected']),
        pending: num(r['pending']),
        status,
      };
      const agg = grnByLine.get(lineId);
      if (agg) {
        agg.detail.push(detail);
        agg.total += 1;
        if (status === 'done') agg.done += 1;
        agg.received += detail.receivedQty;
        agg.accepted += detail.accepted;
        agg.rejected += detail.rejected;
      } else {
        grnByLine.set(lineId, {
          detail: [detail],
          total: 1,
          done: status === 'done' ? 1 : 0,
          received: detail.receivedQty,
          accepted: detail.accepted,
          rejected: detail.rejected,
        });
      }
    }

    // ── Per-line QC Documents aggregate + detail — qc_documents registered
    // against the line's JCs. Every row carries a file (uploaded = true). ──
    const docRows = await tx.execute(sql`
      SELECT
        jc.source_so_line_id AS "soLineId",
        jc.code AS "jcCode",
        qd.doc_type AS "docType",
        qd.file_name AS "fileName"
      FROM public.qc_documents qd
      JOIN public.job_cards jc ON jc.id = qd.job_card_id AND jc.deleted_at IS NULL
      JOIN public.sales_order_lines sol4
        ON sol4.id = jc.source_so_line_id AND sol4.deleted_at IS NULL
      WHERE qd.company_id = ${companyId}::uuid
        AND qd.deleted_at IS NULL
        AND sol4.sales_order_id = ${soId}::uuid
      ORDER BY jc.code, qd.doc_type
    `);
    const docByLine = new Map<string, SoQcDocDetail[]>();
    for (const r of rows(docRows)) {
      const lineId = r['soLineId'] as string;
      const detail: SoQcDocDetail = {
        jcCode: (r['jcCode'] as string) ?? '',
        docType: (r['docType'] as string) ?? 'QC Doc',
        fileName: (r['fileName'] as string | null) ?? null,
        uploaded: true,
      };
      const arr = docByLine.get(lineId);
      if (arr) arr.push(detail);
      else docByLine.set(lineId, [detail]);
    }

    const lines: SoQcLine[] = rows(lineRows).map((r) => {
      const soLineId = r['soLineId'] as string;
      const jcQc = stagesByLine.get(soLineId) ?? [];
      const tpiDetail = tpiByLine.get(soLineId) ?? [];
      const grnAgg = grnByLine.get(soLineId) ?? {
        detail: [] as SoQcGrnDetail[],
        total: 0,
        done: 0,
        received: 0,
        accepted: 0,
        rejected: 0,
      };
      const docDetail = docByLine.get(soLineId) ?? [];

      const qcOpsTotal = num(r['qcOpsTotal']);
      const qcOpsPassed = num(r['qcOpsPassed']);
      const qcPending = num(r['qcPending']);
      const tpiCount = tpiDetail.length;
      const docCount = docDetail.length;
      const docUploaded = docDetail.filter((d) => d.uploaded).length;

      const hasAnyQc =
        qcOpsTotal > 0 || tpiCount > 0 || grnAgg.total > 0 || docCount > 0;

      const overallPct = overallPctOf({
        qcOpsTotal,
        qcOpsPassed,
        grnTotal: grnAgg.total,
        grnDone: grnAgg.done,
        tpiCount,
        docCount,
        docUploaded,
      });

      return {
        soLineId,
        lineNo: num(r['lineNo']),
        itemCode: (r['itemCode'] as string | null) ?? null,
        partName: (r['partName'] as string | null) ?? null,
        orderQty: num(r['orderQty']),
        jcCount: num(r['jcCount']),
        hasAnyQc,
        qcOpsTotal,
        qcOpsPassed,
        qcAccepted: num(r['qcAccepted']),
        qcRejected: num(r['qcRejected']),
        qcPending,
        tpiCount,
        tpiAccepted: tpiDetail.reduce((s, t) => s + t.accepted, 0),
        tpiRejected: tpiDetail.reduce((s, t) => s + t.rejected, 0),
        grnTotal: grnAgg.total,
        grnDone: grnAgg.done,
        grnReceived: grnAgg.received,
        grnAccepted: grnAgg.accepted,
        grnRejected: grnAgg.rejected,
        docCount,
        docUploaded,
        overallPct,
        overall: overallOf({
          hasAnyQc,
          qcOpsTotal,
          qcOpsPassed,
          qcPending,
          tpiCount,
          grnTotal: grnAgg.total,
          grnDone: grnAgg.done,
          docCount,
        }),
        jcQc,
        grnDetail: grnAgg.detail,
        tpiDetail,
        docDetail,
      };
    });

    const selector = toSelector(soRow);
    return { so: { ...selector, dueDate: soDueDate }, lines };
  });
}
