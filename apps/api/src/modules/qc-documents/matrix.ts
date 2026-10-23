// SO-pivoted QC-completion matrix (legacy renderQCDocuments L23039): the SO
// selector and one row per JC per SO line, a column per QC op name. Read-only.
// Raw SQL over sales_order_lines -> job_cards (source_so_line_id) -> jc_ops
// (QC ops) -> v_jc_op_status. RLS via the base tables.
//
// ADR-252: a cell's report (hasDoc / date / file) comes from the QC Dossier
// helper (dossier.ts buildOrderDossier), so the same SO shows the same ticks
// and missing reports here, on the Dossier and on SO QC Status: a QC op has its
// report when every entry that accepted pieces carries a file — the report
// attached at Submit QC (op_log.qc_report_path) counts as well as an upload.

import type {
  ListQcMatrixSosResponse,
  QcMatrixCell,
  QcMatrixResponse,
  QcMatrixRow,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { buildOrderDossier } from './dossier';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function rows(r: unknown): Array<Record<string, unknown>> {
  return r as unknown as Array<Record<string, unknown>>;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

function dateLike(v: unknown): string | null {
  if (v == null || v === '') return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

// Fixed-order QC columns (legacy L23057 / L23168, with DIR's slot taken by
// "Final Inspection" — the system-appended terminal QC op, ADR-069 Rule B).
// Always shown first; any other QC op names found append after, preserving
// discovery order. Entries must be spelt exactly as jc_ops.operation is
// written (the server writes DEFAULT_FINAL_QC_OP verbatim) because column
// names are matched by exact string when collected from the ops.
const QC_FIXED_ORDER = ['MIR', 'MCR', 'Final Inspection', 'TPI'] as const;

/** SO selector list (legacy L23042-23047). */
export async function listQcMatrixSos(user: AuthContext): Promise<ListQcMatrixSosResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      SELECT so.id, so.code, so.internal_so_no AS "internalSoNo",
        so.customer_name AS "customerName"
      FROM public.sales_orders so
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        AND so.status <> 'cancelled'
      ORDER BY so.code DESC
    `);
    return {
      sos: rows(rs).map((r) => ({
        id: r['id'] as string,
        code: r['code'] as string,
        internalSoNo: (r['internalSoNo'] as string | null) ?? null,
        customerName: (r['customerName'] as string | null) ?? null,
      })),
    };
  });
}

interface QcOpDbRow {
  soLineId: string;
  lineNo: number;
  clientPoLineNo: string | null;
  itemCode: string | null;
  itemRevision: string | null;
  itemName: string | null;
  orderQty: number;
  jobCardId: string;
  jcCode: string;
  jcOpId: string;
  operation: string;
  computedStatus: string;
  qcPending: number;
  accepted: number;
}

export async function getQcMatrix(
  salesOrderId: string,
  user: AuthContext,
): Promise<QcMatrixResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const soRows = await tx.execute(sql`
      SELECT so.id, so.code, so.internal_so_no AS "internalSoNo",
        so.customer_name AS "customerName"
      FROM public.sales_orders so
      WHERE so.id = ${salesOrderId}::uuid AND so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
    `);
    const soRow = rows(soRows)[0];
    if (!soRow) throw new NotFoundError('Sales Order not found. Refresh the page.');

    // SO lines. Lines with no JC still surface as a "No JC" row (legacy
    // L23070-23073). Revision is the customer's drawing revision typed on this
    // SO line (::text for the pre-0119 reason) — never items.revision.
    const lineRows = await tx.execute(sql`
      SELECT
        sol.id AS "soLineId", sol.line_no AS "lineNo",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE(i.code, sol.item_code_text) AS "itemCode",
        sol.revision::text AS "itemRevision",
        COALESCE(i.name, sol.part_name) AS "itemName",
        sol.order_qty AS "orderQty"
      FROM public.sales_order_lines sol
      LEFT JOIN public.items i ON i.id = sol.item_id
      WHERE sol.sales_order_id = ${salesOrderId}::uuid AND sol.deleted_at IS NULL
      ORDER BY sol.line_no
    `);

    // QC ops on every JC sourced from a line of this SO, with the derived
    // status + accepted/pending qty (v_jc_op_status).
    const opRows = rows(
      await tx.execute(sql`
        SELECT
          jc.source_so_line_id AS "soLineId",
          sol.line_no AS "lineNo",
          sol.client_po_line_no AS "clientPoLineNo",
          COALESCE(i.code, sol.item_code_text) AS "itemCode",
          sol.revision::text AS "itemRevision",
          COALESCE(i.name, sol.part_name) AS "itemName",
          sol.order_qty AS "orderQty",
          jc.id AS "jobCardId", jc.code AS "jcCode",
          jo.id AS "jcOpId", jo.operation,
          vos.computed_status AS "computedStatus",
          COALESCE(vos.qc_pending, 0) AS "qcPending",
          COALESCE(vos.qc_accepted_qty, 0) AS "accepted"
        FROM public.job_cards jc
        JOIN public.sales_order_lines sol
          ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
        LEFT JOIN public.items i ON i.id = sol.item_id
        JOIN public.jc_ops jo ON jo.job_card_id = jc.id AND jo.deleted_at IS NULL
          AND jo.op_type = 'qc'
        LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
        WHERE jc.deleted_at IS NULL AND sol.sales_order_id = ${salesOrderId}::uuid
        ORDER BY sol.line_no, jc.code, jo.op_seq
      `),
    ) as unknown as QcOpDbRow[];

    // ADR-252 — the reports, per QC op, from the one Dossier helper.
    const { opIndex } = await buildOrderDossier(tx, companyId, 'so', salesOrderId);

    // Build dynamic QC column set: fixed order first, then any extra QC ops.
    const qcColumns: string[] = [...QC_FIXED_ORDER];
    for (const op of opRows) {
      if (op.operation && !qcColumns.includes(op.operation)) qcColumns.push(op.operation);
    }

    // Group QC ops per JC.
    interface JcGroup {
      soLineId: string;
      lineNo: number;
      clientPoLineNo: string | null;
      itemCode: string | null;
      itemRevision: string | null;
      itemName: string | null;
      orderQty: number;
      jobCardId: string;
      jcCode: string;
      ops: Map<string, QcOpDbRow>;
    }
    const jcGroups = new Map<string, JcGroup>();
    for (const op of opRows) {
      let g = jcGroups.get(op.jobCardId);
      if (!g) {
        g = {
          soLineId: op.soLineId,
          lineNo: num(op.lineNo),
          clientPoLineNo: op.clientPoLineNo ?? null,
          itemCode: op.itemCode ?? null,
          itemRevision: op.itemRevision ?? null,
          itemName: op.itemName ?? null,
          orderQty: num(op.orderQty),
          jobCardId: op.jobCardId,
          jcCode: op.jcCode,
          ops: new Map(),
        };
        jcGroups.set(op.jobCardId, g);
      }
      // First op wins per name (ops already ordered by op_seq).
      if (op.operation && !g.ops.has(op.operation)) g.ops.set(op.operation, op);
    }

    let totalDone = 0;
    let totalTotal = 0;
    const matrixRows: QcMatrixRow[] = [];
    const linesWithJc = new Set<string>();
    for (const g of jcGroups.values()) linesWithJc.add(g.soLineId);

    for (const lineRow of rows(lineRows)) {
      const soLineId = lineRow['soLineId'] as string;
      if (linesWithJc.has(soLineId)) continue;
      matrixRows.push({
        soLineId,
        lineNo: num(lineRow['lineNo']),
        clientPoLineNo: (lineRow['clientPoLineNo'] as string | null) ?? null,
        itemCode: (lineRow['itemCode'] as string | null) ?? null,
        itemRevision: (lineRow['itemRevision'] as string | null) ?? null,
        itemName: (lineRow['itemName'] as string | null) ?? null,
        orderQty: num(lineRow['orderQty']),
        jobCardId: null,
        jcCode: null,
        done: 0,
        total: 0,
        overall: 'no_jc',
        cells: qcColumns.map(() => emptyCell()),
      });
    }

    for (const g of jcGroups.values()) {
      let ld = 0;
      let lt = 0;
      const cells: QcMatrixCell[] = qcColumns.map((colName) => {
        const op = g.ops.get(colName);
        if (!op) return emptyCell();
        lt++;
        totalTotal++;
        const done = op.computedStatus === 'complete';
        if (done) {
          ld++;
          totalDone++;
        }
        const ix = opIndex.get(op.jcOpId);
        const latest = ix?.files[0] ?? null;
        return {
          applicable: true,
          done,
          pending: !done && num(op.qcPending) > 0,
          qcPending: num(op.qcPending),
          accepted: num(op.accepted),
          // Reported = it has files and no entry that accepted pieces lacks one.
          hasDoc: !!ix && ix.files.length > 0 && ix.missing === 0,
          docDate: latest ? dateLike(latest.uploadedAt) : null,
          storagePath: latest?.storagePath ?? null,
          fileName: latest?.fileName ?? null,
          jcOpId: op.jcOpId,
        };
      });
      matrixRows.push({
        soLineId: g.soLineId,
        lineNo: g.lineNo,
        clientPoLineNo: g.clientPoLineNo,
        itemCode: g.itemCode,
        itemRevision: g.itemRevision,
        itemName: g.itemName,
        orderQty: g.orderQty,
        jobCardId: g.jobCardId,
        jcCode: g.jcCode,
        done: ld,
        total: lt,
        overall: lt === 0 ? 'no_qc' : ld >= lt ? 'complete' : 'partial',
        cells,
      });
    }

    // Line then JC (no-JC rows interleave by line).
    matrixRows.sort((a, b) => {
      if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
      return (a.jcCode ?? '').localeCompare(b.jcCode ?? '');
    });

    return {
      so: {
        id: soRow['id'] as string,
        code: soRow['code'] as string,
        internalSoNo: (soRow['internalSoNo'] as string | null) ?? null,
        customerName: (soRow['customerName'] as string | null) ?? null,
      },
      qcColumns,
      rows: matrixRows,
      totalDone,
      totalTotal,
    };
  });
}

function emptyCell(): QcMatrixCell {
  return {
    applicable: false,
    done: false,
    pending: false,
    qcPending: 0,
    accepted: 0,
    hasDoc: false,
    docDate: null,
    storagePath: null,
    fileName: null,
    jcOpId: null,
  };
}
