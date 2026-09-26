// WIP by operation — every unfinished operation on an open Job Card, with the
// quantities sitting at it (available to start, in QC, at vendor, completed,
// pending), read straight off v_jc_op_status so it matches Op Entry.
// Modelled on ERPNext's "Work Order Summary" / "Job Card Summary" (WIP) report.

import { OP_TYPES } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { enumFilter, likeFilter, numCell, type SqlRow, textCell } from './report-helpers';

export const wipByOperationReport: RegisteredReport = {
  definition: {
    slug: 'wip-by-operation',
    title: 'WIP by operation',
    description:
      'Operations not yet complete on Job Cards that are not Complete or Closed. Input = qty that has reached the op; Available = free to start now; In QC = waiting inspection (op QC + OSP receipts not yet inspected); At Vendor = with the OSP vendor. Sorted by Planned Machine, then JC.',
    group: 'Production',
    dept: 'production',
    filters: [
      {
        key: 'machine',
        label: 'Planned Machine',
        kind: 'text',
        placeholder: 'Machine code or name',
      },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      { key: 'opType', label: 'Op Type', kind: 'enum', options: [...OP_TYPES] },
    ],
    columns: [
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'order_code', label: 'SO / JWSO', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'machine_code', label: 'Planned Machine', type: 'text' },
      { key: 'op_type', label: 'Op Type', type: 'text' },
      { key: 'input_qty', label: 'Input Qty', type: 'number' },
      { key: 'available_qty', label: 'Available', type: 'number' },
      { key: 'running_now', label: 'Running Now', type: 'text' },
      { key: 'in_qc_qty', label: 'In QC', type: 'number' },
      { key: 'at_vendor_qty', label: 'At Vendor', type: 'number' },
      { key: 'completed_qty', label: 'Completed', type: 'number' },
      { key: 'pending_qty', label: 'Pending', type: 'number' },
      { key: 'op_status', label: 'Op Status', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const machine = likeFilter(filters['machine']);
    const item = likeFilter(filters['item']);
    const opType = enumFilter(filters['opType'], OP_TYPES);

    const machineFrag = machine
      ? sql`AND (COALESCE(m.code, o.machine_code_text, '') ILIKE ${machine}
                 OR COALESCE(m.name, '') ILIKE ${machine})`
      : sql``;
    const itemFrag = item
      ? sql`AND (COALESCE(it.code, '') ILIKE ${item} OR COALESCE(it.name, '') ILIKE ${item})`
      : sql``;
    const opTypeFrag = opType ? sql`AND v.op_type = ${opType}::op_type` : sql``;

    const result = await tx.execute(sql`
      SELECT
        jc.code                                      AS jc_code,
        it.code                                 AS item_code,
        sol.client_po_line_no                        AS client_po_line_no,
        COALESCE(sol.revision::text, jwl.revision::text) AS item_revision,
        COALESCE(so.code, jwo.code)                  AS order_code,
        o.op_seq                                     AS op_seq,
        o.operation                                  AS operation,
        COALESCE(m.code, o.machine_code_text)        AS machine_code,
        v.op_type::text                              AS op_type,
        v.input_avail                                AS input_qty,
        v.available                                  AS available_qty,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.running_ops ro
          WHERE ro.jc_op_id = o.id AND ro.status = 'running'
        ) THEN 'Yes' ELSE 'No' END                   AS running_now,
        (v.qc_pending + v.in_qc_qty)                 AS in_qc_qty,
        v.at_vendor_qty                              AS at_vendor_qty,
        v.completed_qty                              AS completed_qty,
        v.pending_qty                                AS pending_qty,
        v.computed_status                            AS op_status
      FROM public.v_jc_op_status v
      JOIN public.jc_ops o
        ON o.id = v.jc_op_id AND o.deleted_at IS NULL
      JOIN public.job_cards jc
        ON jc.id = v.job_card_id AND jc.deleted_at IS NULL
      JOIN public.v_jc_status js
        ON js.job_card_id = jc.id
      LEFT JOIN public.items it
        ON it.id = jc.item_id AND it.deleted_at IS NULL
      LEFT JOIN public.machines m
        ON m.id = o.machine_id AND m.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jwo
        ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
      WHERE v.company_id = ${companyId}::uuid
        AND js.computed_status NOT IN ('complete', 'closed')
        AND v.computed_status <> 'complete'
        ${machineFrag}
        ${itemFrag}
        ${opTypeFrag}
      ORDER BY COALESCE(m.code, o.machine_code_text) ASC NULLS LAST, jc.code, o.op_seq
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      jc_code: String(r['jc_code'] ?? ''),
      item_code: String(r['item_code'] ?? '—'),
      item_revision: textCell(r['item_revision']),
      client_po_line_no: textCell(r['client_po_line_no']),
      order_code: textCell(r['order_code']),
      op_seq: numCell(r['op_seq']),
      operation: textCell(r['operation']),
      machine_code: textCell(r['machine_code']),
      op_type: String(r['op_type'] ?? ''),
      input_qty: numCell(r['input_qty']),
      available_qty: numCell(r['available_qty']),
      running_now: String(r['running_now'] ?? ''),
      in_qc_qty: numCell(r['in_qc_qty']),
      at_vendor_qty: numCell(r['at_vendor_qty']),
      completed_qty: numCell(r['completed_qty']),
      pending_qty: numCell(r['pending_qty']),
      op_status: String(r['op_status'] ?? ''),
    }));

    return { columns: wipByOperationReport.definition.columns, rows };
  },
};
