// First-pass yield — per item × operation (item, Op, operation) over a date
// range: pieces completed good first time, rejected on the production entry,
// and rejected at QC on the same op, as a yield %, with the machines actually
// used listed beside it. Rework / repair child job cards and NC re-injection
// entries (LOG-NC-…) are left out — they are not first pass. Modelled on
// ERPNext's "Quality Inspection" / first-pass-yield KPI.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { isoDateFilter, likeFilter } from './report-helpers';

export const firstPassYieldReport: RegisteredReport = {
  definition: {
    slug: 'first-pass-yield',
    title: 'First-pass yield',
    description:
      'Per item and op: Worked (Completed + Production Rejected), Rejected at QC on the same op, and First-Pass Yield % = (Completed − Rejected) ÷ Worked, with the machines actually used. Rework / repair job cards and NC re-entries are left out.',
    group: 'Quality',
    dept: 'qc',
    filters: [
      { key: 'fromDate', label: 'Log Date From', kind: 'date' },
      { key: 'toDate', label: 'Log Date To', kind: 'date' },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      {
        key: 'machine',
        label: 'Machines Used',
        kind: 'text',
        placeholder: 'Machine code or name',
      },
    ],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'machines_used', label: 'Machines Used', type: 'text' },
      { key: 'worked_qty', label: 'Worked', type: 'number' },
      { key: 'completed_qty', label: 'Completed', type: 'number' },
      { key: 'production_rejected_qty', label: 'Production Rejected', type: 'number' },
      // NAMING.md: 'Rejected' is the inspection fact; the production-entry
      // reject is the separate 'Production Rejected'.
      { key: 'qc_rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'fpy_pct', label: 'First-Pass Yield %', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const item = likeFilter(filters['item']);
    const machine = likeFilter(filters['machine']);

    const fromFrag = fromDate ? sql`AND ol.log_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND ol.log_date <= ${toDate}::date` : sql``;
    const itemFrag = item ? sql`AND (it.code ILIKE ${item} OR it.name ILIKE ${item})` : sql``;
    const machineFrag = machine
      ? sql`AND (x.machines_used ILIKE ${machine} OR x.machine_names ILIKE ${machine})`
      : sql``;

    // One row per op identity (item, Op, operation) — production and QC
    // entries on the op land on the same row. The actual machine of each
    // production entry follows v_op_machine_output (0095): the entry's own
    // machine, else the op's; QC entries carry no machine and add none.
    // 'complete' rows: qty = good pieces, reject_qty = rejected on that entry
    // (the same split v_jc_op_status 0144 uses).
    const result = await tx.execute(sql`
      WITH e AS (
        SELECT
          jc.item_id,
          o.op_seq,
          o.operation,
          ol.log_type,
          CASE WHEN ol.log_type = 'complete'
               THEN COALESCE(m.code, ol.machine_code_text, o.machine_code_text) END AS machine_code,
          CASE WHEN ol.log_type = 'complete' THEN m.name END            AS machine_name,
          CASE WHEN ol.log_type = 'complete' THEN ol.qty ELSE 0 END     AS completed,
          CASE WHEN ol.log_type = 'complete' THEN ol.reject_qty ELSE 0 END AS prod_rejected,
          CASE WHEN ol.log_type = 'qc' THEN ol.reject_qty ELSE 0 END    AS qc_rejected
        FROM public.op_log ol
        JOIN public.jc_ops o ON o.id = ol.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
        LEFT JOIN public.items it ON it.id = jc.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.machines m
          ON m.id = COALESCE(ol.machine_id, o.machine_id) AND m.deleted_at IS NULL
        WHERE ol.company_id = ${companyId}::uuid
          AND jc.recovery_kind IS NULL
          AND o.op_type = 'process'
          AND (
            (ol.log_type = 'complete' AND ol.log_no NOT LIKE 'LOG-NC-%'
              AND (ol.qty > 0 OR ol.reject_qty > 0))
            OR (ol.log_type = 'qc' AND ol.reject_qty > 0)
          )
          ${fromFrag}
          ${toFrag}
          ${itemFrag}
      ), x AS (
        SELECT
          COALESCE(it.code, '—')                                        AS item_code,
          it.name                                                       AS item_name,
          e.op_seq,
          e.operation,
          string_agg(DISTINCT e.machine_code, ', ' ORDER BY e.machine_code) AS machines_used,
          string_agg(DISTINCT e.machine_name, ', ' ORDER BY e.machine_name) AS machine_names,
          SUM(e.completed)::int                                         AS completed_qty,
          SUM(e.prod_rejected)::int                                     AS production_rejected_qty,
          SUM(e.qc_rejected)::int                                       AS qc_rejected_qty
        FROM e
        LEFT JOIN public.items it ON it.id = e.item_id AND it.deleted_at IS NULL
        GROUP BY it.code, it.name, e.op_seq, e.operation
      )
      SELECT
        x.item_code, x.item_name, x.op_seq, x.operation, x.machines_used,
        (x.completed_qty + x.production_rejected_qty)                   AS worked_qty,
        x.completed_qty, x.production_rejected_qty, x.qc_rejected_qty,
        CASE WHEN x.completed_qty + x.production_rejected_qty > 0
             THEN ROUND(100.0 * GREATEST(0, x.completed_qty - x.qc_rejected_qty)
                        / (x.completed_qty + x.production_rejected_qty), 1) END AS fpy_pct
      FROM x
      WHERE TRUE
        ${machineFrag}
      ORDER BY x.item_code, x.op_seq, x.operation
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      op_seq: Number(r['op_seq'] ?? 0),
      operation: String(r['operation'] ?? ''),
      machines_used: (r['machines_used'] as string | null) ?? null,
      worked_qty: Number(r['worked_qty'] ?? 0),
      completed_qty: Number(r['completed_qty'] ?? 0),
      production_rejected_qty: Number(r['production_rejected_qty'] ?? 0),
      qc_rejected_qty: Number(r['qc_rejected_qty'] ?? 0),
      fpy_pct: r['fpy_pct'] != null ? Number(r['fpy_pct']) : null,
    }));

    return { columns: firstPassYieldReport.definition.columns, rows };
  },
};
