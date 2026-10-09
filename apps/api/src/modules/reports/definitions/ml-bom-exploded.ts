// Multi-Level BOM — Exploded Items (ADR-225 phase 5). Every leaf item of one
// Multi-Level BOM, summed by item + Line Type, for a qty of sets: the SAME
// list as the BOM's Exploded tab — it calls the tree endpoint's own query
// (ml-bom/tree.ts loadMlBomTree), so the two can never disagree.
//
// BOM No. is required (the report is about one BOM): an exact BOM No. match,
// else the one BOM whose number contains what was typed. Qty defaults to 1.
// The report filter kinds are date / enum / text, so Qty is a text box read
// as a number here (positive, at most 1,000,000 — the tree endpoint's cap).

import { BOM_LINE_TYPE_LABEL } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { loadMlBomTree } from '../../ml-bom/tree';
import type { RegisteredReport } from '../registry';
import type { ReportColumn } from '../schema';
import { likeFilter, numCell, type SqlRow } from './report-helpers';

const MAX_QTY = 1_000_000;

const columns: ReportColumn[] = [
  { key: 'item_code', label: 'Item Code', type: 'text' },
  { key: 'item_name', label: 'Item Name', type: 'text' },
  { key: 'line_type', label: 'Line Type', type: 'text' },
  { key: 'exploded_qty', label: 'Exploded Qty', type: 'number' },
  { key: 'uom', label: 'UOM', type: 'text' },
];

export const mlBomExplodedReport: RegisteredReport = {
  definition: {
    slug: 'ml-bom-exploded',
    title: 'Multi-Level BOM — Exploded Items',
    description:
      'Every bought, outsourced and bottom-level made item of one Multi-Level BOM, summed by item, for the qty of sets entered — the same list as the BOM’s Exploded tab.',
    group: 'Design',
    dept: 'design',
    showsMoney: false,
    filters: [
      { key: 'bomNo', label: 'BOM No.', kind: 'text', placeholder: 'IN-MLB-00001 (required)' },
      { key: 'qty', label: 'Qty', kind: 'text', defaultValue: '1', placeholder: 'Sets' },
    ],
    columns,
    rowLink: { column: 'item_code', route: '/items/$id', idKey: 'item_id' },
  },
  async run({ tx, companyId, filters }) {
    const bomNo = (filters['bomNo'] ?? '').trim();
    if (!bomNo) return { columns, rows: [], note: 'Enter a BOM No. to run this report.' };

    const qtyText = (filters['qty'] ?? '').trim() || '1';
    const qty = Number(qtyText);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      return {
        columns,
        rows: [],
        note: `Qty must be a number more than 0 and at most ${MAX_QTY.toLocaleString('en-IN')}.`,
      };
    }

    // Exact BOM No. first; else the ONE BOM whose number contains the text.
    const pat = likeFilter(bomNo);
    const found = (await tx.execute(sql`
      SELECT b.id, b.code, (upper(b.code) = upper(${bomNo})) AS exact
      FROM public.ml_boms b
      WHERE b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL
        AND b.code ILIKE ${pat}
      ORDER BY exact DESC, b.code
      LIMIT 6
    `)) as unknown as SqlRow[];
    const exact = found.find((r) => r['exact'] === true);
    const pick = exact ?? (found.length === 1 ? found[0] : undefined);
    if (!pick) {
      return {
        columns,
        rows: [],
        note:
          found.length === 0
            ? `No Multi-Level BOM numbered "${bomNo}".`
            : `"${bomNo}" matches more than one Multi-Level BOM (${found
                .slice(0, 5)
                .map((r) => String(r['code']))
                .join(', ')}${found.length > 5 ? ', …' : ''}) — enter the full BOM No.`,
      };
    }

    const tree = await loadMlBomTree(tx, companyId, String(pick['id']), qty);
    const rows = tree.exploded.map((e) => ({
      item_id: e.itemId,
      item_code: e.itemCode ?? '—',
      item_name: e.itemName ?? null,
      line_type: e.bomType ? BOM_LINE_TYPE_LABEL[e.bomType] : null,
      exploded_qty: numCell(e.explodedQty),
      uom: e.uom ?? null,
    }));
    // Matched on part of the number: say which BOM this is.
    return exact ? { columns, rows } : { columns, rows, note: `Showing ${String(pick['code'])}.` };
  },
};
