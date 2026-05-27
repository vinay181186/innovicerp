// QC Documents service (QC Wave 5). Mirrors legacy renderQCDocuments L23039.
// CRUD over qc_documents (migration 0039). Files themselves live in the
// `qc-docs` Storage bucket — the client uploads direct, then registers metadata.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateQcDocumentInput,
  ListQcDocumentsQuery,
  ListQcDocumentsResponse,
  ListQcMatrixSosResponse,
  QcDocument,
  QcLineBatch,
  QcLineDetailResponse,
  QcLineDoc,
  QcLineDocSection,
  QcMatrixCell,
  QcMatrixResponse,
  QcMatrixRow,
} from '@innovic/shared';
import { qcDocuments } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

type Row = typeof qcDocuments.$inferSelect;

function toItem(r: Row): QcDocument {
  return {
    id: r.id,
    companyId: r.companyId,
    jobCardId: r.jobCardId ?? null,
    jcCodeText: r.jcCodeText ?? null,
    salesOrderId: r.salesOrderId ?? null,
    soCodeText: r.soCodeText ?? null,
    category: r.category,
    docType: r.docType,
    fileName: r.fileName,
    storagePath: r.storagePath,
    uploadedByText: r.uploadedByText ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export async function listQcDocuments(
  input: ListQcDocumentsQuery,
  user: AuthContext,
): Promise<ListQcDocumentsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conds = [eq(qcDocuments.companyId, companyId), isNull(qcDocuments.deletedAt)];
    if (input.category) conds.push(eq(qcDocuments.category, input.category));
    if (input.jobCardId) conds.push(eq(qcDocuments.jobCardId, input.jobCardId));
    if (input.search) {
      const term = `%${input.search}%`;
      conds.push(
        sql`(${qcDocuments.fileName} ILIKE ${term} OR ${qcDocuments.docType} ILIKE ${term} OR ${qcDocuments.jcCodeText} ILIKE ${term} OR ${qcDocuments.soCodeText} ILIKE ${term})`,
      );
    }
    const rows = await tx
      .select()
      .from(qcDocuments)
      .where(and(...conds))
      .orderBy(desc(qcDocuments.createdAt));
    return { items: rows.map(toItem) };
  });
}

export async function createQcDocument(
  input: CreateQcDocumentInput,
  user: AuthContext,
): Promise<QcDocument> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const inserted = await tx
      .insert(qcDocuments)
      .values({
        companyId,
        jobCardId: input.jobCardId ?? null,
        jcCodeText: input.jcCodeText ?? null,
        salesOrderId: input.salesOrderId ?? null,
        soCodeText: input.soCodeText ?? null,
        category: input.category,
        docType: input.docType,
        fileName: input.fileName,
        storagePath: input.storagePath,
        uploadedByText: user.email ?? null,
        // QC-completion matrix link (migration 0043). When the upload comes
        // from the line-detail modal these are set so the doc lands in the
        // right matrix cell + serial range.
        jcOpId: input.jcOpId ?? null,
        qcOpName: input.qcOpName ?? null,
        srFrom: input.srFrom ?? null,
        srTo: input.srTo ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toItem(inserted[0] as Row);
  });
}

export async function deleteQcDocument(id: string, user: AuthContext): Promise<{ id: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const updated = await tx
      .update(qcDocuments)
      .set({ deletedAt: new Date(), updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(qcDocuments.id, id),
          eq(qcDocuments.companyId, companyId),
          isNull(qcDocuments.deletedAt),
        ),
      )
      .returning({ id: qcDocuments.id });
    if (updated.length === 0) throw new NotFoundError(`QC document ${id} not found`);
    return { id };
  });
}

// ─── SO-pivoted QC-completion matrix (legacy renderQCDocuments L23039) ───────
// SO selector list, the matrix itself, and the per-JC line-detail modal data.
// All read-only. Raw SQL over sales_order_lines -> job_cards
// (source_so_line_id) -> jc_ops (QC ops) -> v_jc_op_status + op_log, joined
// LEFT to qc_documents. RLS via the base tables.

function rows(r: unknown): Array<Record<string, unknown>> {
  return r as unknown as Array<Record<string, unknown>>;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function isoLike(v: unknown): string {
  if (v == null) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

// Legacy fixed-order QC columns (L23057 / L23168). Always shown first; any
// other QC op names found append after, preserving discovery order.
const QC_FIXED_ORDER = ['MIR', 'MCR', 'DIR', 'TPI'] as const;

const QC_DOC_FULL_NAMES: Record<string, string> = {
  MIR: 'Material Inspection Report',
  MCR: 'Material Compliance Report',
  DIR: 'Dimensional Inspection Report',
  TPI: 'Third Party Inspection',
  ICS: 'ICS',
  ASN: 'ASN',
  OTH1: 'Other 1',
  OTH2: 'Other 2',
};

/** SO selector list (legacy L23042-23047). JW left as a follow-up — see note. */
export async function listQcMatrixSos(user: AuthContext): Promise<ListQcMatrixSosResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName"
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

interface QcDocDbRow {
  jcOpId: string | null;
  jobCardId: string | null;
  qcOpName: string | null;
  docType: string;
  fileName: string;
  storagePath: string;
  createdAt: string;
}

export async function getQcMatrix(
  salesOrderId: string,
  user: AuthContext,
): Promise<QcMatrixResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const soRows = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName"
      FROM public.sales_orders so
      WHERE so.id = ${salesOrderId}::uuid AND so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
    `);
    const soRow = rows(soRows)[0];
    if (!soRow) throw new NotFoundError(`Sales order ${salesOrderId} not found`);

    // SO lines (one row per line, with item code/name). Lines with no JC still
    // surface as a "No JC" matrix row (legacy L23070-23073).
    const lineRows = await tx.execute(sql`
      SELECT
        sol.id AS "soLineId", sol.line_no AS "lineNo",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE(i.code, sol.item_code_text) AS "itemCode",
        COALESCE(i.name, sol.part_name) AS "itemName",
        sol.order_qty AS "orderQty"
      FROM public.sales_order_lines sol
      LEFT JOIN public.items i ON i.id = sol.item_id
      WHERE sol.sales_order_id = ${salesOrderId}::uuid AND sol.deleted_at IS NULL
      ORDER BY sol.line_no
    `);

    // QC ops on every JC sourced from a line of this SO, enriched with the
    // derived status + accepted/pending qty (v_jc_op_status). Legacy collects
    // QC ops via op.opType==='QC'; we match jc_ops.op_type='qc'.
    const opRows = rows(
      await tx.execute(sql`
        SELECT
          jc.source_so_line_id AS "soLineId",
          sol.line_no AS "lineNo",
          sol.client_po_line_no AS "clientPoLineNo",
          COALESCE(i.code, sol.item_code_text) AS "itemCode",
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

    // Registered QC docs for this SO's JCs. Matched to a cell by jc_op_id
    // (preferred), else qc_op_name = op.operation, else doc_type = op.operation
    // (legacy rows that predate the matrix columns). Newest first so the first
    // match per op is the latest.
    const docRows = rows(
      await tx.execute(sql`
        SELECT
          qd.jc_op_id AS "jcOpId",
          qd.job_card_id AS "jobCardId",
          qd.qc_op_name AS "qcOpName",
          qd.doc_type AS "docType",
          qd.file_name AS "fileName",
          qd.storage_path AS "storagePath",
          qd.created_at AS "createdAt"
        FROM public.qc_documents qd
        JOIN public.job_cards jc ON jc.id = qd.job_card_id AND jc.deleted_at IS NULL
        JOIN public.sales_order_lines sol
          ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
        WHERE qd.company_id = ${companyId}::uuid AND qd.deleted_at IS NULL
          AND sol.sales_order_id = ${salesOrderId}::uuid
        ORDER BY qd.created_at DESC
      `),
    ) as unknown as QcDocDbRow[];

    // Index docs: by jc_op_id, and by (job_card_id, op-name-or-doc-type).
    const docByOpId = new Map<string, QcDocDbRow>();
    const docByJcName = new Map<string, QcDocDbRow>();
    for (const d of docRows) {
      if (d.jcOpId && !docByOpId.has(d.jcOpId)) docByOpId.set(d.jcOpId, d);
      const nameKey = (d.qcOpName ?? d.docType ?? '').toUpperCase();
      if (d.jobCardId && nameKey) {
        const k = `${d.jobCardId}::${nameKey}`;
        if (!docByJcName.has(k)) docByJcName.set(k, d);
      }
    }

    // Build dynamic QC column set: fixed order first, then any extra QC ops.
    const opNamesPresent = new Set<string>();
    for (const op of opRows) if (op.operation) opNamesPresent.add(op.operation);
    const qcColumns: string[] = [];
    for (const c of QC_FIXED_ORDER) qcColumns.push(c);
    for (const name of opNamesPresent) {
      if (!qcColumns.includes(name)) qcColumns.push(name);
    }
    if (qcColumns.length === 0) qcColumns.push('QC');

    // Group QC ops per JC.
    interface JcGroup {
      soLineId: string;
      lineNo: number;
      clientPoLineNo: string | null;
      itemCode: string | null;
      itemName: string | null;
      orderQty: number;
      jobCardId: string;
      jcCode: string;
      ops: Map<string, QcOpDbRow>;
    }
    const jcGroups = new Map<string, JcGroup>();
    const jcOrder: string[] = [];
    for (const op of opRows) {
      let g = jcGroups.get(op.jobCardId);
      if (!g) {
        g = {
          soLineId: op.soLineId,
          lineNo: num(op.lineNo),
          clientPoLineNo: op.clientPoLineNo ?? null,
          itemCode: op.itemCode ?? null,
          itemName: op.itemName ?? null,
          orderQty: num(op.orderQty),
          jobCardId: op.jobCardId,
          jcCode: op.jcCode,
          ops: new Map(),
        };
        jcGroups.set(op.jobCardId, g);
        jcOrder.push(op.jobCardId);
      }
      // First op wins per name (ops already ordered by op_seq).
      if (op.operation && !g.ops.has(op.operation)) g.ops.set(op.operation, op);
    }

    let totalDone = 0;
    let totalTotal = 0;
    const matrixRows: QcMatrixRow[] = [];

    // Lines with no JC (legacy "No JC" rows).
    const linesWithJc = new Set<string>();
    for (const g of jcGroups.values()) linesWithJc.add(g.soLineId);

    // Emit JC rows grouped under their line, in line order then jc order.
    const orderedJcIds = [...jcOrder].sort((a, b) => {
      const ga = jcGroups.get(a) as JcGroup;
      const gb = jcGroups.get(b) as JcGroup;
      if (ga.lineNo !== gb.lineNo) return ga.lineNo - gb.lineNo;
      return ga.jcCode.localeCompare(gb.jcCode);
    });

    for (const lineRow of rows(lineRows)) {
      const soLineId = lineRow['soLineId'] as string;
      if (!linesWithJc.has(soLineId)) {
        // No JC for this line — emit an empty row (legacy L23070-23073).
        matrixRows.push({
          soLineId,
          lineNo: num(lineRow['lineNo']),
          clientPoLineNo: (lineRow['clientPoLineNo'] as string | null) ?? null,
          itemCode: (lineRow['itemCode'] as string | null) ?? null,
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
    }

    for (const jcId of orderedJcIds) {
      const g = jcGroups.get(jcId) as JcGroup;
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
        const doc =
          docByOpId.get(op.jcOpId) ??
          docByJcName.get(`${g.jobCardId}::${colName.toUpperCase()}`) ??
          null;
        return {
          applicable: true,
          done,
          pending: !done && num(op.qcPending) > 0,
          qcPending: num(op.qcPending),
          accepted: num(op.accepted),
          hasDoc: doc != null,
          docDate: doc ? dateLike(doc.createdAt) : null,
          storagePath: doc?.storagePath ?? null,
          fileName: doc?.fileName ?? null,
          jcOpId: op.jcOpId,
        };
      });
      const overall: QcMatrixRow['overall'] = lt === 0 ? 'no_qc' : ld >= lt ? 'complete' : 'partial';
      matrixRows.push({
        soLineId: g.soLineId,
        lineNo: g.lineNo,
        clientPoLineNo: g.clientPoLineNo,
        itemCode: g.itemCode,
        itemName: g.itemName,
        orderQty: g.orderQty,
        jobCardId: g.jobCardId,
        jcCode: g.jcCode,
        done: ld,
        total: lt,
        overall,
        cells,
      });
    }

    // Sort final rows by line then JC (no-JC rows interleave by line).
    matrixRows.sort((a, b) => {
      if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
      return (a.jcCode ?? '').localeCompare(b.jcCode ?? '');
    });

    return {
      so: {
        id: soRow['id'] as string,
        code: soRow['code'] as string,
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

/** Line-detail modal data for one JC (legacy _qcDocLineDetail L23226). */
export async function getQcLineDetail(
  jobCardId: string,
  user: AuthContext,
): Promise<QcLineDetailResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jcRows = await tx.execute(sql`
      SELECT
        jc.id AS "jobCardId", jc.code AS "jcCode", jc.order_qty AS "orderQty",
        COALESCE(i.code, sol.item_code_text) AS "itemCode",
        COALESCE(i.name, sol.part_name) AS "itemName"
      FROM public.job_cards jc
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      WHERE jc.id = ${jobCardId}::uuid AND jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
    `);
    const jcRow = rows(jcRows)[0];
    if (!jcRow) throw new NotFoundError(`Job card ${jobCardId} not found`);

    // QC ops on this JC (drives doc-type sections + batch op names).
    const opRows = rows(
      await tx.execute(sql`
        SELECT jo.id AS "jcOpId", jo.op_seq AS "opSeq", jo.operation
        FROM public.jc_ops jo
        WHERE jo.job_card_id = ${jobCardId}::uuid AND jo.deleted_at IS NULL
          AND jo.op_type = 'qc'
        ORDER BY jo.op_seq
      `),
    );

    // QC batches (op_log type='qc' on this JC's QC ops). Serial ranges are
    // derived by a running cumulative of accepted qty (legacy L23274-23288).
    const batchRows = rows(
      await tx.execute(sql`
        SELECT
          ol.id AS "logId", ol.log_no AS "logNo", ol.log_date AS "date",
          jo.op_seq AS "opSeq", jo.operation,
          ol.qty AS "accepted", ol.reject_qty AS "rejected"
        FROM public.op_log ol
        JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
        WHERE ol.company_id = ${companyId}::uuid AND ol.log_type = 'qc'
          AND jo.job_card_id = ${jobCardId}::uuid AND jo.op_type = 'qc'
        ORDER BY ol.log_date, ol.log_no
      `),
    );
    let runSr = 0;
    let totalAccepted = 0;
    const batches: QcLineBatch[] = batchRows.map((r) => {
      const accepted = num(r['accepted']);
      const srFrom = runSr + 1;
      const srTo = runSr + accepted;
      runSr = srTo;
      totalAccepted += accepted;
      return {
        logId: r['logId'] as string,
        logNo: (r['logNo'] as string) ?? '',
        date: dateLike(r['date']),
        opSeq: num(r['opSeq']),
        operation: (r['operation'] as string) ?? 'QC',
        accepted,
        rejected: num(r['rejected']),
        srFrom,
        srTo,
      };
    });

    // Registered docs for this JC.
    const docRows = rows(
      await tx.execute(sql`
        SELECT
          qd.id, qd.doc_type AS "docType", qd.sr_from AS "srFrom", qd.sr_to AS "srTo",
          qd.file_name AS "fileName", qd.storage_path AS "storagePath",
          qd.uploaded_by_text AS "uploadedByText", qd.created_at AS "createdAt"
        FROM public.qc_documents qd
        WHERE qd.company_id = ${companyId}::uuid AND qd.deleted_at IS NULL
          AND qd.job_card_id = ${jobCardId}::uuid
        ORDER BY qd.doc_type, qd.sr_from NULLS FIRST, qd.created_at
      `),
    );

    // report_types config for MANDATORY/OPTIONAL badges (default_mandatory).
    const mandatoryByName = await loadMandatoryMap(tx, companyId);

    // Doc-type sections: fixed order + this JC's QC op names + any doc types
    // already uploaded that aren't otherwise present (legacy L23239-23241).
    const sectionNames: string[] = [];
    for (const c of QC_FIXED_ORDER) sectionNames.push(c);
    for (const op of opRows) {
      const name = op['operation'] as string;
      if (name && !sectionNames.includes(name)) sectionNames.push(name);
    }
    for (const d of docRows) {
      const dt = d['docType'] as string;
      if (dt && !sectionNames.includes(dt)) sectionNames.push(dt);
    }

    const docsByType = new Map<string, QcLineDoc[]>();
    for (const d of docRows) {
      const dt = d['docType'] as string;
      const doc: QcLineDoc = {
        id: d['id'] as string,
        docType: dt,
        srFrom: d['srFrom'] == null ? null : num(d['srFrom']),
        srTo: d['srTo'] == null ? null : num(d['srTo']),
        fileName: (d['fileName'] as string) ?? '',
        storagePath: (d['storagePath'] as string) ?? '',
        uploadedByText: (d['uploadedByText'] as string | null) ?? null,
        createdAt: isoLike(d['createdAt']),
      };
      const arr = docsByType.get(dt);
      if (arr) arr.push(doc);
      else docsByType.set(dt, [doc]);
    }

    const sections: QcLineDocSection[] = sectionNames.map((name) => ({
      docType: name,
      fullName: QC_DOC_FULL_NAMES[name] ?? name,
      // Legacy default: when there's no QC-process config, MIR/MCR/DIR/TPI are
      // treated as mandatory; here we drive it off report_types when a matching
      // report type exists, else fall back to the fixed-order set being
      // mandatory and everything else optional.
      mandatory: mandatoryByName.has(name.toUpperCase())
        ? (mandatoryByName.get(name.toUpperCase()) as boolean)
        : (QC_FIXED_ORDER as readonly string[]).includes(name),
      docs: docsByType.get(name) ?? [],
    }));

    return {
      jobCardId: jcRow['jobCardId'] as string,
      jcCode: (jcRow['jcCode'] as string) ?? '',
      itemCode: (jcRow['itemCode'] as string | null) ?? null,
      itemName: (jcRow['itemName'] as string | null) ?? null,
      orderQty: num(jcRow['orderQty']),
      totalAccepted,
      batches,
      sections,
    };
  });
}

async function loadMandatoryMap(
  tx: DbTransaction,
  companyId: string,
): Promise<Map<string, boolean>> {
  const rt = rows(
    await tx.execute(sql`
      SELECT name, default_mandatory AS "defaultMandatory"
      FROM public.report_types
      WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND status = 'Active'
    `),
  );
  const map = new Map<string, boolean>();
  for (const r of rt) {
    const name = (r['name'] as string | null) ?? '';
    if (name) map.set(name.toUpperCase(), Boolean(r['defaultMandatory']));
  }
  return map;
}
