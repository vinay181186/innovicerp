// ADR-252 — QC Dossier: the reads. ONE helper (loadDossierRaw) gives every QC
// entry of an order with its files from every place a QC report is kept:
//   - op_log.qc_report_path (the report attached at Submit QC — Op Entry, TPI,
//     QC Call Register),
//   - qc_documents (QC Documents uploads: by QC entry, by legacy JC op link,
//     by order line, by job card, or on the SO only),
//   - file_registry 'qc-docs' on the line's job cards (the Job Card form).
// The Dossier, the QC Matrix and SO QC Status all build from it
// (dossier-build.ts), so the same order shows the same ticks and missing counts
// on all three. A fixed number of queries per call — no per-line reads.

import type { QcDossierOrderKind } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { OP_LOG_QC_REMARKS } from '../../lib/op-log-qc-remarks';
import { qcProcessReportJoin } from '../../lib/qc-process-report';
import type {
  DossierDocRow,
  DossierEntryRow,
  DossierJcRow,
  DossierLineRow,
  DossierRaw,
  DossierReportTypeRow,
  DossierStepRow,
} from './dossier-types';

type Rec = Record<string, unknown>;
const rowsOf = (r: unknown) => r as unknown as Rec[];
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? '' : new Date(String(v)).toISOString();

/** Fixed SQL names per order kind — never user input. */
const KIND = {
  so: {
    lines: 'sales_order_lines',
    orderFk: 'sales_order_id',
    jcLine: 'source_so_line_id',
    docLine: 'so_line_id',
  },
  jwso: {
    lines: 'job_work_order_lines',
    orderFk: 'job_work_order_id',
    jcLine: 'source_jw_line_id',
    docLine: 'jw_line_id',
  },
} as const;

export interface DossierOrderHead {
  id: string;
  code: string;
  internalSoNo: string | null;
  customerName: string | null;
  clientPoNo: string | null;
}

/** The order header, or null when it is not this company's live order. */
export async function loadOrderHead(
  tx: DbTransaction,
  cid: string,
  kind: QcDossierOrderKind,
  orderId: string,
): Promise<DossierOrderHead | null> {
  const q =
    kind === 'so'
      ? sql`SELECT o.id, o.code, o.internal_so_no, o.customer_name, o.client_po_no
            FROM public.sales_orders o
            WHERE o.id = ${orderId}::uuid AND o.company_id = ${cid}::uuid AND o.deleted_at IS NULL`
      : sql`SELECT o.id, o.code, NULL::text AS internal_so_no, o.customer_name, o.client_po_no
            FROM public.job_work_orders o
            WHERE o.id = ${orderId}::uuid AND o.company_id = ${cid}::uuid AND o.deleted_at IS NULL`;
  const r = rowsOf(await tx.execute(q))[0];
  if (!r) return null;
  return {
    id: String(r['id']),
    code: String(r['code']),
    internalSoNo: s(r['internal_so_no']),
    customerName: s(r['customer_name']),
    clientPoNo: s(r['client_po_no']),
  };
}

export async function loadDossierRaw(
  tx: DbTransaction,
  cid: string,
  kind: QcDossierOrderKind,
  orderId: string,
): Promise<DossierRaw> {
  const k = KIND[kind];
  const linesT = sql.raw(`public.${k.lines}`);
  const orderFk = sql.raw(`l.${k.orderFk}`);
  const jcLine = sql.raw(`jc.${k.jcLine}`);
  const docLine = sql.raw(`qd.${k.docLine}`);

  // 1. The order's lines. POL is the line's own client_po_line_no: on a line
  //    there is exactly one candidate (lib/pol.ts applies where a card may
  //    trace to either).
  const lines: DossierLineRow[] = rowsOf(
    await tx.execute(sql`
      SELECT l.id, l.line_no, l.client_po_line_no,
             COALESCE(i.code, l.item_code_text) AS item_code, l.revision::text AS item_revision,
             COALESCE(i.name, l.part_name) AS item_name, l.order_qty
      FROM ${linesT} l
      LEFT JOIN public.items i ON i.id = l.item_id
      WHERE ${orderFk} = ${orderId}::uuid AND l.company_id = ${cid}::uuid AND l.deleted_at IS NULL
      ORDER BY l.line_no`),
  ).map((r) => ({
    lineId: String(r['id']),
    lineNo: n(r['line_no']),
    clientPoLineNo: s(r['client_po_line_no']),
    itemCode: s(r['item_code']),
    itemRevision: s(r['item_revision']),
    itemName: s(r['item_name']),
    orderQty: n(r['order_qty']),
  }));
  const lineIds = lines.map((l) => l.lineId);

  // 2. Every live job card on those lines, plus rework / repair children
  //    reached through parent_job_card_id (a child normally carries its
  //    parent's source line too; when it does not, it takes the parent's).
  const jobCards: DossierJcRow[] =
    lineIds.length === 0
      ? []
      : rowsOf(
          await tx.execute(sql`
            WITH RECURSIVE lj AS (
              SELECT jc.id, jc.code, ${jcLine} AS line_id, 0 AS depth
              FROM public.job_cards jc
              WHERE jc.company_id = ${cid}::uuid AND jc.deleted_at IS NULL
                AND ${jcLine} = ANY(${sql.param(lineIds)}::uuid[])
              UNION ALL
              SELECT c.id, c.code, lj.line_id, lj.depth + 1
              FROM public.job_cards c
              JOIN lj ON c.parent_job_card_id = lj.id
              WHERE c.company_id = ${cid}::uuid AND c.deleted_at IS NULL AND lj.depth < 10
            )
            SELECT DISTINCT ON (id) id, code, line_id FROM lj ORDER BY id, depth`),
        ).map((r) => ({
          id: String(r['id']),
          code: String(r['code']),
          lineId: String(r['line_id']),
        }));
  const jcIds = jobCards.map((j) => j.id);

  // 3. QC steps on those cards, with the report type each one produces.
  const steps: DossierStepRow[] =
    jcIds.length === 0
      ? []
      : rowsOf(
          await tx.execute(sql`
            SELECT jo.id, jo.job_card_id, jo.op_seq, jo.operation,
                   pr.report_type_id, pr.report_name, pr.mandatory,
                   (vs.computed_status = 'complete') AS op_done
            FROM public.jc_ops jo
            LEFT JOIN public.v_jc_op_status vs ON vs.jc_op_id = jo.id
            ${qcProcessReportJoin(cid, 'jo.operation', 'pr')}
            WHERE jo.company_id = ${cid}::uuid AND jo.deleted_at IS NULL AND jo.op_type = 'qc'
              AND jo.job_card_id = ANY(${sql.param(jcIds)}::uuid[])
            ORDER BY jo.op_seq`),
        ).map((r) => ({
          jcOpId: String(r['id']),
          jobCardId: String(r['job_card_id']),
          opSeq: n(r['op_seq']),
          operation: String(r['operation'] ?? ''),
          reportTypeId: s(r['report_type_id']),
          reportName: s(r['report_name']),
          mandatory: r['mandatory'] === true,
          opDone: r['op_done'] === true,
        }));
  const opIds = steps.map((st) => st.jcOpId);

  // 4. Live QC entries on those steps: a reversal row and the entry it
  //    cancels (ADR-197) are both left out.
  const entries: DossierEntryRow[] =
    opIds.length === 0
      ? []
      : rowsOf(
          await tx.execute(sql`
            SELECT ol.id, ol.log_no, ol.jc_op_id, ol.log_date::text AS log_date, ol.qty,
                   ol.reject_qty, ${OP_LOG_QC_REMARKS} AS remarks, ol.report_required, ol.qc_report_path, ol.qc_report_name,
                   ol.created_at, u.full_name AS created_by_name
            FROM public.op_log ol
            LEFT JOIN public.users u ON u.id = ol.created_by
            WHERE ol.company_id = ${cid}::uuid AND ol.log_type = 'qc'
              AND ol.jc_op_id = ANY(${sql.param(opIds)}::uuid[])
              AND ol.reversal_of_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.op_log rv WHERE rv.reversal_of_id = ol.id)
            ORDER BY ol.log_date, ol.created_at`),
        ).map((r) => ({
          id: String(r['id']),
          logNo: String(r['log_no'] ?? ''),
          jcOpId: String(r['jc_op_id']),
          logDate: s(r['log_date']),
          qty: n(r['qty']),
          rejectQty: n(r['reject_qty']),
          remarks: s(r['remarks']),
          reportRequired: r['report_required'] === null ? null : r['report_required'] === true,
          qcReportPath: s(r['qc_report_path']),
          qcReportName: s(r['qc_report_name']),
          createdAt: iso(r['created_at']),
          createdByName: s(r['created_by_name']),
        }));
  const entryIds = entries.map((e) => e.id);

  // 5. Registered files: QC Documents + the Job Card form's QC files.
  const soOnly = kind === 'so' ? sql`OR qd.sales_order_id = ${orderId}::uuid` : sql``;
  const docs: DossierDocRow[] = rowsOf(
    await tx.execute(sql`
      SELECT 'qc_document' AS source, qd.id, qd.op_log_id, qd.jc_op_id, qd.job_card_id,
             qd.jc_code_text, ${docLine} AS line_id, qd.report_type_id, qd.qc_op_name,
             qd.doc_type, qd.file_name, qd.storage_path,
             COALESCE(u.full_name, qd.uploaded_by_text) AS uploaded_by_name, qd.created_at
      FROM public.qc_documents qd
      LEFT JOIN public.users u ON u.id = qd.created_by
      WHERE qd.company_id = ${cid}::uuid AND qd.deleted_at IS NULL
        AND (qd.job_card_id = ANY(${sql.param(jcIds)}::uuid[])
             OR ${docLine} = ANY(${sql.param(lineIds)}::uuid[])
             OR qd.op_log_id = ANY(${sql.param(entryIds)}::uuid[])
             ${soOnly})
      UNION ALL
      SELECT 'job_card' AS source, fr.id, NULL::uuid, NULL::uuid, fr.job_card_id,
             fr.jc_code_text, NULL::uuid, NULL::uuid, NULL::text,
             fr.doc_type, fr.file_name, fr.storage_path,
             COALESCE(u.full_name, fr.uploaded_by_text), fr.created_at
      FROM public.file_registry fr
      LEFT JOIN public.users u ON u.id = fr.created_by
      WHERE fr.company_id = ${cid}::uuid AND fr.deleted_at IS NULL AND fr.category = 'qc-docs'
        AND fr.job_card_id = ANY(${sql.param(jcIds)}::uuid[])`),
  ).map((r) => ({
    source: r['source'] === 'job_card' ? ('job_card' as const) : ('qc_document' as const),
    id: String(r['id']),
    opLogId: s(r['op_log_id']),
    jcOpId: s(r['jc_op_id']),
    jobCardId: s(r['job_card_id']),
    jcCodeText: s(r['jc_code_text']),
    lineId: s(r['line_id']),
    reportTypeId: s(r['report_type_id']),
    qcOpName: s(r['qc_op_name']),
    docType: s(r['doc_type']),
    fileName: String(r['file_name'] ?? ''),
    storagePath: String(r['storage_path'] ?? ''),
    uploadedByName: s(r['uploaded_by_name']),
    createdAt: iso(r['created_at']),
  }));

  // 6. The company's live report types (folder names for extra files).
  const reportTypes: DossierReportTypeRow[] = rowsOf(
    await tx.execute(sql`
      SELECT r.id, r.name, r.default_mandatory
      FROM public.report_types r
      WHERE r.company_id = ${cid}::uuid AND r.deleted_at IS NULL AND r.status = 'Active'
      ORDER BY r.created_at`),
  ).map((r) => ({
    id: String(r['id']),
    name: String(r['name']),
    mandatory: r['default_mandatory'] === true,
  }));

  return { lines, jobCards, steps, entries, docs, reportTypes };
}
