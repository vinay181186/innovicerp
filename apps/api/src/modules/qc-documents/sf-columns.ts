// Sort & Filter (ADR-200) — the QC Documents File Register's sortable /
// filterable fields. Each expression is the SAME one listQcDocuments SELECTs
// for that column (same joins, used by both its page and its count query).

import { sql } from 'drizzle-orm';

import { items, jobWorkOrderLines, qcDocuments, salesOrderLines } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const QC_DOC_SF_COLUMNS: SfColumnMap = {
  docType: { sql: sql`${qcDocuments.docType}`, type: 'text' },
  fileName: { sql: sql`${qcDocuments.fileName}`, type: 'text' },
  category: { sql: sql`${qcDocuments.category}`, type: 'list' },
  jcCode: { sql: sql`${qcDocuments.jcCodeText}`, type: 'text' },
  clientPoLineNo: { sql: sql`${salesOrderLines.clientPoLineNo}`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(${items.code} || COALESCE('/' || NULLIF(btrim(COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`${items.name}`, type: 'text' },
  soCode: { sql: sql`${qcDocuments.soCodeText}`, type: 'text' },
  // ADR-207 — the Internal SO No., the SAME scalar the page query SELECTs: read
  // live off the document's own SO (FK). A scalar on qc_documents, so it is
  // valid in the count query too.
  soInternalNo: {
    sql: sql`(
      SELECT so.internal_so_no FROM public.sales_orders so
      WHERE so.id = ${qcDocuments.salesOrderId}
    )`,
    type: 'text',
  },
  uploadedBy: { sql: sql`${qcDocuments.uploadedByText}`, type: 'text' },
  uploadDate: {
    sql: sql`(${qcDocuments.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
};
