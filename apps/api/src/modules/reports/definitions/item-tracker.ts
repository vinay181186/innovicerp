// Item Tracker — cross-cutting "where is each item right now" rollup.
// Ports the summary mode of legacy `_rptItemWhere` (HTML L20447–20472).
//
// Per item: in_stock (from v_item_stock) + in_production (Σ order_qty of
// open job cards for the item) + in_po_ordered (Σ open PO-line qty minus
// received GRN qty). Total column = sum of the three.
//
// At-vendor qty (JW DC outward / inward) is deferred — those tables haven't
// been ported to this codebase yet. The legacy spec includes a 5th column;
// here we ship the 4-column subset until JW DCs land.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { jcPendingToStockQtySql } from '../../../lib/jc-effective-qty';
import { onPoByItemSql } from '../../../lib/po-pending';

export const itemTrackerReport: RegisteredReport = {
  definition: {
    slug: 'item-tracker',
    title: 'Item Tracker',
    description:
      'Per-item rollup of current location: in stock, in production (open JCs), and pending on open POs. Drives the sales-planner question "where is this item right now?".',
    group: 'Sales',
    dept: 'sales',
    filters: [
      {
        key: 'search',
        label: 'Item Search',
        kind: 'text',
        placeholder: 'Item code or name (substring match)',
      },
    ],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      // The customer drawing revision(s) currently in production for this
      // item. This report's grain is ONE ROW PER ITEM — in_stock is a single
      // on-hand figure that is not held per revision — so the revision cannot
      // become part of the key without duplicating the stock figure across
      // every revision and inflating Total. It is therefore reported as the
      // distinct set of revisions on the open job cards, comma-separated
      // ("A, B" when the same item is running at two revisions at once), and
      // blank when no open JC traces back to an SO line.
      { key: 'so_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'in_stock', label: 'In Stock', type: 'number' },
      { key: 'in_production', label: 'In Production', type: 'number' },
      { key: 'in_po_ordered', label: 'On PO', type: 'number' },
      { key: 'total', label: 'Total', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const search = filters['search']?.trim() ?? '';
    const term = search ? `%${search}%` : null;
    const searchFrag = term ? sql`AND (i.code ILIKE ${term} OR i.name ILIKE ${term})` : sql``;
    const result = await tx.execute(sql`
      WITH jc_open AS (
        SELECT
          jc.item_id,
          -- ADR-185 — what each open card still owes stock (Order Qty less
          -- what its order already credited): credited pieces are In Stock.
          SUM(${jcPendingToStockQtySql('jc')})::int AS qty,
          -- Distinct drawing revisions of the SO lines behind these open JCs.
          -- sol.id is the primary key so the LEFT JOIN adds at most one row
          -- per job card — SUM(jc.order_qty) above is untouched by it.
          -- ::text because production is still pre-0119 and holds an integer.
          NULLIF(
            STRING_AGG(DISTINCT sol.revision::text, ', ' ORDER BY sol.revision::text),
            ''
          ) AS revisions
        FROM public.job_cards jc
        LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
        -- LEFT, never inner: a JC raised from a JW line or by hand still
        -- counts towards In Production, it just has no customer revision.
        LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          -- Rework / repair children re-make pieces the parent card counts.
          AND jc.recovery_kind IS NULL
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id
      ),
      -- ADR-189 — the one On PO rule (lib/po-pending.ts).
      po_pending AS (${onPoByItemSql(companyId)})
      SELECT
        i.code                                     AS item_code,
        -- Aliased so_revision, not plain revision: the items table has its own
        -- revision column describing the item itself, and two columns called
        -- Revision meaning different things would be worse than none. This
        -- one is the CUSTOMER's drawing revision off the sales order line.
        COALESCE(jc_open.revisions, '')             AS so_revision,
        i.name                                     AS item_name,
        COALESCE(s.on_hand_qty, 0)::int            AS in_stock,
        COALESCE(jc_open.qty, 0)::int              AS in_production,
        COALESCE(po_pending.qty, 0)::int           AS in_po_ordered,
        (
          COALESCE(s.on_hand_qty, 0) +
          COALESCE(jc_open.qty, 0) +
          COALESCE(po_pending.qty, 0)
        )::int                                     AS total
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      LEFT JOIN jc_open ON jc_open.item_id = i.id
      LEFT JOIN po_pending ON po_pending.item_id = i.id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
        ${searchFrag}
      ORDER BY i.code
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: String(r['item_code'] ?? ''),
      so_revision: String(r['so_revision'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      in_stock: Number(r['in_stock'] ?? 0),
      in_production: Number(r['in_production'] ?? 0),
      in_po_ordered: Number(r['in_po_ordered'] ?? 0),
      total: Number(r['total'] ?? 0),
    }));

    return { columns: itemTrackerReport.definition.columns, rows };
  },
};
