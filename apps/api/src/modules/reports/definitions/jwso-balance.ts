// JWSO balance — one row per Job Work Sales Order line: customer material
// accepted (Party GRN, Incoming QC), processed pieces returned, labour invoiced, and what
// is still to return and to bill.
// Modelled on ERPNext's "Subcontracted Item To Be Received" / job-work balance reports.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  enumFilter,
  likeFilter,
  numCell,
  REPORT_ROW_CAP,
  textCell,
  type SqlRow,
} from './report-helpers';

const STATUSES = ['open', 'closed', 'dispatched'] as const;

export const jwsoBalanceReport: RegisteredReport = {
  definition: {
    slug: 'jwso-balance',
    title: 'JWSO balance',
    description:
      'Every JWSO line (Draft and Cancelled left out): customer RM accepted at Incoming QC on Party GRNs for that line, Returned, Invoiced, To Return (Order Qty minus Returned) and To Invoice (Returned minus Invoiced).',
    group: 'Sales',
    dept: 'sales',
    showsMoney: true,
    filters: [
      { key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' },
      { key: 'status', label: 'JWSO Line Status', kind: 'enum', options: [...STATUSES] },
    ],
    columns: [
      { key: 'jw_code', label: 'JWSO No.', type: 'text' },
      { key: 'jw_date', label: 'JWSO Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'line_no', label: 'Ln', type: 'number' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'material_received_qty', label: 'Customer RM Accepted', type: 'number' },
      { key: 'returned_qty', label: 'Returned', type: 'number' },
      { key: 'invoiced_qty', label: 'Invoiced', type: 'number' },
      { key: 'to_return_qty', label: 'To Return', type: 'number' },
      { key: 'to_bill_qty', label: 'To Invoice', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const customer = likeFilter(filters['customer']);
    const status = enumFilter(filters['status'], STATUSES);

    const customerFrag = customer
      ? sql`AND COALESCE(cl.name, jwo.customer_name, '') ILIKE ${customer}`
      : sql``;
    const statusFrag = status
      ? sql`AND jwl.status = ${status}::so_status`
      : sql`AND jwl.status IN ('open', 'closed', 'dispatched')`;

    const result = await tx.execute(sql`
      SELECT
        jwo.code                                    AS jw_code,
        jwo.jw_date::text                           AS jw_date,
        COALESCE(cl.name, jwo.customer_name, '—')   AS client_name,
        jwl.line_no                                 AS line_no,
        COALESCE(it.code, jwl.item_code_text)  AS item_code,
        jwl.revision::text                          AS item_revision,
        COALESCE(it.name, jwl.part_name)            AS item_name,
        jwl.order_qty                               AS order_qty,
        COALESCE((
          -- ADR-203: customer RM ACCEPTED at Incoming QC for THIS line, matched
          -- by the JWSO line id (never the line-number text, never received
          -- qty). A line waiting for QC carries accepted 0; a cancelled GRN is
          -- soft-deleted and drops out.
          SELECT SUM(pgl.accepted_qty)
          FROM public.party_grn_lines pgl
          JOIN public.party_grn pg
            ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
          WHERE pgl.jw_line_id = jwl.id
            AND pgl.company_id = ${companyId}::uuid
            AND pgl.deleted_at IS NULL
        ), 0)::int                                  AS material_received_qty,
        jwl.returned_qty                            AS returned_qty,
        jwl.invoiced_qty                            AS invoiced_qty,
        GREATEST(jwl.order_qty - jwl.returned_qty, 0)    AS to_return_qty,
        GREATEST(jwl.returned_qty - jwl.invoiced_qty, 0) AS to_bill_qty,
        jwl.rate                                    AS rate,
        jwl.due_date::text                          AS due_date
      FROM public.job_work_order_lines jwl
      JOIN public.job_work_orders jwo
        ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
      LEFT JOIN public.items it
        ON it.id = jwl.item_id AND it.deleted_at IS NULL
      LEFT JOIN public.clients cl
        ON cl.id = jwo.client_id AND cl.deleted_at IS NULL
      WHERE jwl.company_id = ${companyId}::uuid
        AND jwl.deleted_at IS NULL
        AND jwo.status NOT IN ('draft', 'cancelled')
        ${statusFrag}
        ${customerFrag}
      ORDER BY jwo.jw_date DESC, jwo.code DESC, jwl.line_no
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      jw_code: String(r['jw_code'] ?? ''),
      jw_date: dateCell(r['jw_date']),
      client_name: String(r['client_name'] ?? ''),
      line_no: numCell(r['line_no']),
      item_code: String(r['item_code'] ?? '—'),
      item_revision: textCell(r['item_revision']),
      item_name: textCell(r['item_name']),
      order_qty: numCell(r['order_qty']),
      material_received_qty: numCell(r['material_received_qty']),
      returned_qty: numCell(r['returned_qty']),
      invoiced_qty: numCell(r['invoiced_qty']),
      to_return_qty: numCell(r['to_return_qty']),
      to_bill_qty: numCell(r['to_bill_qty']),
      rate: numCell(r['rate']),
      due_date: dateCell(r['due_date']),
    }));

    return { columns: jwsoBalanceReport.definition.columns, rows };
  },
};
