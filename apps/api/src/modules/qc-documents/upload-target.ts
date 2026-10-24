// ADR-252 — where a QC Documents upload belongs, worked out on the server.
// With a QC entry (opLogId) the entry decides everything: job card, JC op,
// SO / JWSO line and report folder (the op's QC process report type, else the
// one picked). Without one: the picked report type, the picked order line
// (validated as this company's), else the card's own line. Codes are always
// read from the live records, never taken from the browser.

import type { CreateQcDocumentInput } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { qcProcessReportJoin } from '../../lib/qc-process-report';

/** Where a new upload belongs, worked out on the server (ADR-252). */
export interface UploadTarget {
  jobCardId: string | null;
  jcCodeText: string | null;
  salesOrderId: string | null;
  soCodeText: string | null;
  soLineId: string | null;
  jwLineId: string | null;
  jcOpId: string | null;
  qcOpName: string | null;
  opLogId: string | null;
  reportTypeId: string | null;
  docType: string;
}

type Rec = Record<string, unknown>;
export const sqlOne = async (
  tx: DbTransaction,
  q: ReturnType<typeof sql>,
): Promise<Rec | undefined> => ((await tx.execute(q)) as unknown as Rec[])[0];
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

async function reportTypeName(tx: DbTransaction, cid: string, id: string): Promise<string> {
  const r = await sqlOne(
    tx,
    sql`SELECT r.name FROM public.report_types r
        WHERE r.id = ${id}::uuid AND r.company_id = ${cid}::uuid
          AND r.deleted_at IS NULL AND r.status = 'Active'`,
  );
  if (!r)
    throw new ValidationError('Report Type not found or inactive. Pick the Report Type again.');
  return String(r['name']);
}

/** The JC (and its SO / JWSO line) behind a card id — this company, live. */
async function cardOf(tx: DbTransaction, cid: string, jobCardId: string): Promise<Rec> {
  const jc = await sqlOne(
    tx,
    sql`SELECT jc.id, jc.code, jc.source_so_line_id, jc.source_jw_line_id,
               sol.sales_order_id, so.code AS so_code
        FROM public.job_cards jc
        LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
        LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
        WHERE jc.id = ${jobCardId}::uuid AND jc.company_id = ${cid}::uuid AND jc.deleted_at IS NULL`,
  );
  if (!jc) throw new ValidationError('Job Card not found. Pick the JC No. again.');
  return jc;
}

export async function resolveUploadTarget(
  tx: DbTransaction,
  cid: string,
  input: CreateQcDocumentInput,
): Promise<UploadTarget> {
  const t: UploadTarget = {
    jobCardId: null,
    jcCodeText: input.jcCodeText ?? null,
    salesOrderId: null,
    soCodeText: input.soCodeText ?? null,
    soLineId: null,
    jwLineId: null,
    jcOpId: null,
    qcOpName: null,
    opLogId: null,
    reportTypeId: null,
    docType: input.docType ?? '',
  };
  const fromCard = (jc: Rec) => {
    t.jobCardId = String(jc['id']);
    t.jcCodeText = String(jc['code']);
    t.soLineId = str(jc['source_so_line_id']);
    t.jwLineId = t.soLineId ? null : str(jc['source_jw_line_id']);
    t.salesOrderId = str(jc['sales_order_id']);
    t.soCodeText = str(jc['so_code']) ?? t.soCodeText;
  };

  if (input.opLogId) {
    // The QC entry decides everything: JC, JC op, line, report type.
    const e = await sqlOne(
      tx,
      sql`SELECT ol.id, ol.jc_op_id, jo.job_card_id, jo.operation, pr.report_type_id
          FROM public.op_log ol
          JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
          ${qcProcessReportJoin(cid, 'jo.operation', 'pr')}
          WHERE ol.id = ${input.opLogId}::uuid AND ol.company_id = ${cid}::uuid
            AND ol.log_type = 'qc'`,
    );
    if (!e) throw new ValidationError('QC entry not found. Refresh the page.');
    fromCard(await cardOf(tx, cid, String(e['job_card_id'])));
    t.opLogId = String(e['id']);
    t.jcOpId = String(e['jc_op_id']);
    t.qcOpName = str(e['operation']);
    t.reportTypeId = str(e['report_type_id']) ?? input.reportTypeId ?? null;
  } else {
    t.reportTypeId = input.reportTypeId ?? null;
    if (input.soLineId) {
      const l = await sqlOne(
        tx,
        sql`SELECT l.id, l.sales_order_id, so.code FROM public.sales_order_lines l
            JOIN public.sales_orders so ON so.id = l.sales_order_id
            WHERE l.id = ${input.soLineId}::uuid AND l.company_id = ${cid}::uuid
              AND l.deleted_at IS NULL`,
      );
      if (!l) throw new ValidationError('Sales Order line not found. Refresh the page.');
      t.soLineId = String(l['id']);
      t.salesOrderId = String(l['sales_order_id']);
      t.soCodeText = String(l['code']);
    } else if (input.jwLineId) {
      const l = await sqlOne(
        tx,
        sql`SELECT l.id FROM public.job_work_order_lines l
            WHERE l.id = ${input.jwLineId}::uuid AND l.company_id = ${cid}::uuid
              AND l.deleted_at IS NULL`,
      );
      if (!l) throw new ValidationError('JWSO line not found. Refresh the page.');
      t.jwLineId = String(l['id']);
    }
    if (input.jobCardId) {
      const jc = await cardOf(tx, cid, input.jobCardId);
      const line = { so: t.soLineId, jw: t.jwLineId, sid: t.salesOrderId, sc: t.soCodeText };
      fromCard(jc);
      // A line picked on the form wins over the card's own line.
      if (line.so || line.jw) {
        t.soLineId = line.so;
        t.jwLineId = line.jw;
        t.salesOrderId = line.sid;
        t.soCodeText = line.sc;
      }
    }
    if (input.salesOrderId && !t.salesOrderId) {
      const so = await sqlOne(
        tx,
        sql`SELECT so.code FROM public.sales_orders so
            WHERE so.id = ${input.salesOrderId}::uuid AND so.company_id = ${cid}::uuid
              AND so.deleted_at IS NULL`,
      );
      if (!so) throw new ValidationError('Sales Order not found. Pick the SO No. again.');
      t.salesOrderId = input.salesOrderId;
      t.soCodeText = String(so['code']);
    }
  }
  if (t.reportTypeId) t.docType = await reportTypeName(tx, cid, t.reportTypeId);
  if (!t.docType.trim()) throw new ValidationError('Pick the report type');
  return t;
}
