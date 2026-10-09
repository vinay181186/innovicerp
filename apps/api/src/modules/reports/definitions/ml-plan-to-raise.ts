// Multi-Level Plan — To Raise (ADR-225 phase 5). Every row of every Draft /
// Released Multi-Level Plan that still has qty To Raise, plan by plan.
//
// Raised comes from ml-plan/order-reads.ts raisedByNodeSql — the statement
// the plan detail's readRaisedByNode runs, here over every matching row of
// every open plan in ONE query — and To Raise = Net Need − Raised (never below
// 0), in thousandths, exactly as the detail page (ml-plan/reads.ts
// loadMlPlanDetail). So a row here shows the same figures as on the plan.

import { BOM_LINE_TYPE_LABEL, BOM_LINE_TYPES, type BomLineType } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { raisedByNodeSql } from '../../ml-plan/order-reads';
import { milliToText, toMilli } from '../../ml-plan/snapshot-math';
import type { RegisteredReport } from '../registry';
import type { ReportColumn } from '../schema';
import { likeFilter, numCell, REPORT_ROW_CAP, textCell, type SqlRow } from './report-helpers';

const columns: ReportColumn[] = [
  { key: 'mlp_code', label: 'MLP No.', type: 'text' },
  { key: 'so_code', label: 'SO No.', type: 'text' },
  { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
  { key: 'client_po_line_no', label: 'POL', type: 'text' },
  { key: 'item_code', label: 'Item Code', type: 'text' },
  { key: 'item_name', label: 'Item Name', type: 'text' },
  { key: 'line_type', label: 'Line Type', type: 'text' },
  { key: 'level', label: 'Level', type: 'number' },
  { key: 'net_need_qty', label: 'Net Need', type: 'number' },
  { key: 'raised_qty', label: 'Raised', type: 'number' },
  { key: 'to_raise_qty', label: 'To Raise', type: 'number' },
  { key: 'uom', label: 'UOM', type: 'text' },
];

/** Line Type filter: the label the screens show → the stored bom_type. */
const LINE_TYPE_BY_LABEL = new Map<string, BomLineType>(
  BOM_LINE_TYPES.map((t) => [BOM_LINE_TYPE_LABEL[t], t]),
);

export const mlPlanToRaiseReport: RegisteredReport = {
  definition: {
    slug: 'ml-plan-to-raise',
    title: 'Multi-Level Plan — To Raise',
    description:
      'Rows of every Draft or Released Multi-Level Plan with qty still To Raise (Net Need minus Raised — the same figures as the plan’s page).',
    group: 'Planning',
    dept: 'planning',
    showsMoney: false,
    filters: [
      { key: 'mlpNo', label: 'MLP No.', kind: 'text', placeholder: 'IN-MLP-00001' },
      { key: 'soNo', label: 'SO No.', kind: 'text', placeholder: 'SO No. or Internal SO No.' },
      {
        key: 'lineType',
        label: 'Line Type',
        kind: 'enum',
        options: BOM_LINE_TYPES.map((t) => BOM_LINE_TYPE_LABEL[t]),
      },
    ],
    columns,
    rowLink: { column: 'mlp_code', route: '/ml-plans/$id', idKey: 'mlp_id' },
  },
  async run({ tx, companyId, filters }) {
    const mlp = likeFilter(filters['mlpNo']);
    const so = likeFilter(filters['soNo']);
    const lineType = LINE_TYPE_BY_LABEL.get((filters['lineType'] ?? '').trim()) ?? null;

    // One statement: the matching rows, their Raised (raisedByNodeSql over
    // exactly those rows), only rows still To Raise, capped at the report cap
    // + 1 so the runner can say the result was cut off.
    const nodes = (await tx.execute(sql`
      WITH pick AS (
        SELECT mp.id AS mlp_id, mp.code AS mlp_code, so.code AS so_code,
               so.internal_so_no AS so_internal_no, sol.client_po_line_no,
               n.id AS node_id, n.seq, n.depth, n.bom_type::text AS bom_type,
               n.net_need_qty, n.item_id
        FROM public.ml_plans mp
        JOIN public.sales_orders so ON so.id = mp.sales_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.sales_order_lines sol
          ON sol.id = mp.so_line_id AND sol.deleted_at IS NULL
        JOIN public.ml_plan_nodes n
          ON n.ml_plan_id = mp.id AND n.company_id = mp.company_id AND n.deleted_at IS NULL
        WHERE mp.company_id = ${companyId}::uuid
          AND mp.deleted_at IS NULL
          AND mp.status IN ('draft', 'released')
          AND n.net_need_qty > 0
          ${mlp ? sql`AND mp.code ILIKE ${mlp}` : sql``}
          ${so ? sql`AND (so.code ILIKE ${so} OR so.internal_so_no ILIKE ${so})` : sql``}
          ${lineType ? sql`AND n.bom_type = ${lineType}` : sql``}
      ),
      raised AS (${raisedByNodeSql(companyId, sql`SELECT node_id FROM pick`)})
      SELECT k.mlp_id, k.mlp_code, k.so_code, k.so_internal_no, k.client_po_line_no,
             k.node_id, k.depth, k.bom_type, k.net_need_qty::text AS net_need_qty,
             r.raised, i.code AS item_code, i.name AS item_name, i.uom::text AS uom
      FROM pick k
      LEFT JOIN raised r ON r.node_id = k.node_id
      LEFT JOIN public.items i ON i.id = k.item_id
      WHERE k.net_need_qty - COALESCE(r.raised::numeric, 0) > 0
      ORDER BY k.mlp_code, k.seq
      LIMIT ${REPORT_ROW_CAP + 1}
    `)) as unknown as SqlRow[];

    const rows = [];
    for (const r of nodes) {
      const net = toMilli(String(r['net_need_qty']));
      const done = toMilli(textCell(r['raised']) ?? '0');
      const toRaise = net - done;
      if (toRaise <= 0n) continue;
      const bomType = (r['bom_type'] as BomLineType | null) ?? null;
      rows.push({
        mlp_id: String(r['mlp_id']),
        mlp_code: String(r['mlp_code']),
        so_code: textCell(r['so_code']),
        so_internal_no: textCell(r['so_internal_no']),
        client_po_line_no: textCell(r['client_po_line_no']),
        item_code: String(r['item_code'] ?? '—'),
        item_name: textCell(r['item_name']),
        line_type: bomType ? BOM_LINE_TYPE_LABEL[bomType] : null,
        level: numCell(r['depth']),
        net_need_qty: numCell(milliToText(net)),
        raised_qty: numCell(milliToText(done)),
        to_raise_qty: numCell(milliToText(toRaise)),
        uom: textCell(r['uom']),
      });
      if (rows.length >= REPORT_ROW_CAP) break;
    }
    return { columns, rows };
  },
};
