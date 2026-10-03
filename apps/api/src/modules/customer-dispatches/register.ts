// Customer Dispatch Register (line grain, legacy renderDispatchRegister) —
// paged by DISPATCH on the server (ADR-201). One row per dispatched line:
// POL + UOM from the SO line, Dispatched By = the dispatch creator, Stock B→A
// from the store_transactions row createDispatch wrote, JC No. derived from the
// JCs feeding the SO line, current stock for the item-wise summary.
//
// Search keeps the LINES that match (as the screen did); a dispatch is listed
// when at least one of its lines is kept. The SO filter, Sort & Filter, the
// KPI strip, the item-wise summary and the SO options all run here over every
// matching row — the screen loads one page of 25 dispatches.

import type {
  CustomerDispatchRegisterQuery,
  CustomerDispatchRegisterResponse,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { billedStatusOf, loadBilledQtyByDispatch } from './billed';
import { DISPATCH_SF_COLUMNS } from './sf-columns';

const n = (s: string | number | null): number => Number(s ?? 0) || 0;

type RegisterRow = {
  dispatch_id: string;
  dispatch_code: string;
  status: 'dispatched' | 'cancelled';
  dispatch_date: string;
  jc_no: string | null;
  so_no: string | null;
  so_internal_no: string | null;
  client_po_line_no: string | null;
  item_code: string | null;
  item_revision: string | null;
  item_code_text: string | null;
  item_name: string;
  qty: number;
  uom: string | null;
  customer: string | null;
  dispatched_by: string | null;
  remarks: string | null;
  stock_before: number | null;
  stock_after: number | null;
  current_stock: number | null;
};

// The header joins every query below uses (h = dispatch, cli = live customer
// via the SO, u = the creator).
const HEADER_JOINS = sql`
  LEFT JOIN public.sales_orders cso ON cso.id = h.sales_order_id
  LEFT JOIN public.clients cli ON cli.id = cso.client_id AND cli.deleted_at IS NULL
  LEFT JOIN public.users u ON u.id = h.created_by`;

// The line joins (l = the dispatch line, i = item, sol = its SO line).
const LINE_JOINS = sql`
  LEFT JOIN public.items i ON i.id = l.item_id AND i.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol ON sol.id = l.sales_order_line_id`;

/** A kept line: every column the register shows (dispatch no, status, date,
 *  JC no, SO, POL, item code / CODE-REV, item name, UOM, customer, dispatched
 *  by, remarks) — not the qty / stock numbers. Needs h, cli, u, l, i, sol. */
function lineMatch(search: string | undefined): SQL {
  const term = search?.trim().replace(/\s+/g, ' ');
  if (!term) return sql`TRUE`;
  const pat = `%${likeEscape(term)}%`;
  const like = (e: SQL): SQL => sql`COALESCE((${e})::text, '') ILIKE ${pat} ESCAPE '\\'`;
  return sql`(
    ${like(sql`h.code`)} OR ${like(sql`h.status`)} OR ${like(sql`h.dispatch_date::text`)}
    OR ${like(sql`h.so_code_text`)} OR ${like(sql`cso.internal_so_no`)}
    OR ${like(sql`sol.client_po_line_no`)}
    OR ${like(sql`i.code`)} OR ${like(sql`l.item_code_text`)}
    OR ${like(sql`(COALESCE(i.code, l.item_code_text) || COALESCE('/' || NULLIF(btrim(sol.revision::text), ''), ''))`)}
    OR ${like(sql`l.item_name`)} OR ${like(sql`sol.uom`)}
    OR ${like(sql`COALESCE(cli.name, h.customer_text)`)} OR ${like(sql`u.full_name`)}
    OR ${like(sql`h.remarks`)}
    OR EXISTS (
      SELECT 1 FROM public.job_cards jcm
      WHERE jcm.source_so_line_id = l.sales_order_line_id AND jcm.deleted_at IS NULL
        AND jcm.code ILIKE ${pat} ESCAPE '\\'
    )
  )`;
}

export async function listDispatchRegister(
  input: CustomerDispatchRegisterQuery,
  user: AuthContext,
): Promise<CustomerDispatchRegisterResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sfq = readSf(input.sf);
  const match = lineMatch(input.search);
  const soNo = input.soNo?.trim() || undefined;
  const soFrag = soNo ? sql`AND h.so_code_text = ${soNo}` : sql``;
  // The dispatches this view lists: company, live, SO filter, ≥ 1 kept line, sf.
  const dispatchWhere = sql`
    h.company_id = ${companyId}::uuid AND h.deleted_at IS NULL ${soFrag}
    AND EXISTS (
      SELECT 1 FROM public.customer_dispatch_lines l ${LINE_JOINS}
      WHERE l.customer_dispatch_id = h.id AND l.deleted_at IS NULL AND ${match}
    )
    ${sfWhere(DISPATCH_SF_COLUMNS, sfq)}`;
  // Ends on id so a page never skips / repeats a dispatch.
  const order = sfOrderBy(
    DISPATCH_SF_COLUMNS,
    sfq,
    sql`h.dispatch_date DESC, h.created_at DESC, h.id DESC`,
  );
  const limitFrag = input.limit !== undefined ? sql`LIMIT ${input.limit}` : sql``;

  return withUserContext(user, async (tx) => {
    const page = (await tx.execute(sql`
      SELECT h.id::text AS id,
        (SELECT COALESCE(SUM(al.qty), 0)::int FROM public.customer_dispatch_lines al
          WHERE al.customer_dispatch_id = h.id AND al.deleted_at IS NULL) AS all_qty
      FROM public.customer_dispatches h ${HEADER_JOINS}
      WHERE ${dispatchWhere}
      ORDER BY ${order}
      ${limitFrag} OFFSET ${input.offset ?? 0}
    `)) as unknown as Array<{ id: string; all_qty: number }>;
    const ids = page.map((p) => p.id);
    const rank = new Map(ids.map((id, i) => [id, i]));

    const lineRes = ids.length
      ? ((await tx.execute(sql`
          SELECT h.id::text AS dispatch_id, h.code AS dispatch_code, h.status,
            h.dispatch_date::text AS dispatch_date, h.so_code_text AS so_no,
            -- ADR-207 — the SO's Internal SO No., live off the SO.
            cso.internal_so_no AS so_internal_no,
            -- Live customer name off the client master via the SO (plan v3
            -- Step 4); the saved customer_text only when the SO has no client.
            COALESCE(cli.name, h.customer_text) AS customer, h.remarks,
            i.code AS item_code, l.item_code_text AS item_code_text,
            l.item_name, l.qty,
            -- The customer's drawing revision off the SO line (never
            -- items.revision); text cast for databases before 0119.
            sol.revision::text AS item_revision,
            sol.client_po_line_no, sol.uom::text AS uom,
            u.full_name AS dispatched_by,
            st.stock_before, st.stock_after,
            vis.on_hand_qty::float8 AS current_stock,
            jcs.jc_codes AS jc_no
          FROM public.customer_dispatch_lines l
          JOIN public.customer_dispatches h ON h.id = l.customer_dispatch_id
          ${HEADER_JOINS}
          ${LINE_JOINS}
          -- Stock before/after for this line. A BOM line writes one ledger row
          -- PER COMPONENT ("DSP-0009 / ln 1 / <component>"), so match that form
          -- too; several components → no single before/after (NULL). The " / "
          -- keeps "ln 1" from swallowing "ln 10".
          LEFT JOIN LATERAL (
            SELECT
              CASE WHEN COUNT(*) = 1 THEN MIN(m.stock_before) END AS stock_before,
              CASE WHEN COUNT(*) = 1 THEN MIN(m.stock_after) END AS stock_after
            FROM public.store_transactions m
            WHERE m.company_id = h.company_id
              AND m.source_type = 'dispatch'
              AND m.txn_type = 'out'
              AND (
                m.source_ref = h.code || ' / ln ' || l.line_no
                OR m.source_ref LIKE h.code || ' / ln ' || l.line_no || ' / %'
              )
          ) st ON TRUE
          LEFT JOIN public.v_item_stock vis
            ON vis.company_id = h.company_id AND vis.item_id = l.item_id
          LEFT JOIN LATERAL (
            SELECT string_agg(jc.code, ', ' ORDER BY jc.code) AS jc_codes
            FROM public.job_cards jc
            WHERE jc.source_so_line_id = l.sales_order_line_id AND jc.deleted_at IS NULL
          ) jcs ON TRUE
          WHERE h.id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
            AND l.deleted_at IS NULL AND ${match}
          ORDER BY l.line_no, l.id
        `)) as unknown as RegisterRow[])
      : [];
    // Page order (the dispatch order above), lines in line order within it.
    lineRes.sort((a, b) => (rank.get(a.dispatch_id) ?? 0) - (rank.get(b.dispatch_id) ?? 0));

    // Every kept line of the matching dispatches, for the counts.
    const keptLines = sql`
      FROM public.customer_dispatches h ${HEADER_JOINS}
      JOIN public.customer_dispatch_lines l
        ON l.customer_dispatch_id = h.id AND l.deleted_at IS NULL
      ${LINE_JOINS}
      WHERE ${dispatchWhere} AND ${match}`;
    const [agg] = (await tx.execute(sql`
      SELECT
        COUNT(DISTINCT h.id)::int AS total,
        COALESCE(SUM(l.qty) FILTER (WHERE h.status <> 'cancelled'), 0)::int AS total_qty,
        COUNT(DISTINCT h.id) FILTER (WHERE h.status <> 'cancelled')::int AS dispatch_count
      ${keptLines}
    `)) as unknown as Array<{ total: number; total_qty: number; dispatch_count: number }>;

    // Item-wise summary over the ACTIVE kept lines (cancelled were reversed).
    // The drawing revision is left out of the key: Rev A and Rev B of a part
    // are one item holding one stock figure.
    const items = (await tx.execute(sql`
      SELECT COALESCE(i.code, l.item_code_text, l.item_name) AS item_key,
        COALESCE(MIN(i.code), MIN(l.item_code_text), '—') AS item_code,
        (array_agg(l.item_name ORDER BY h.dispatch_date DESC, h.created_at DESC))[1] AS item_name,
        COALESCE(SUM(l.qty), 0)::int AS total_qty,
        COUNT(*)::int AS line_count,
        MAX(vis.on_hand_qty)::float8 AS current_stock
      FROM public.customer_dispatches h ${HEADER_JOINS}
      JOIN public.customer_dispatch_lines l
        ON l.customer_dispatch_id = h.id AND l.deleted_at IS NULL
      ${LINE_JOINS}
      LEFT JOIN public.v_item_stock vis
        ON vis.company_id = h.company_id AND vis.item_id = l.item_id
      WHERE ${dispatchWhere} AND ${match} AND h.status <> 'cancelled'
      GROUP BY 1
      ORDER BY MAX(h.dispatch_date) DESC, 1
    `)) as unknown as Array<{
      item_code: string;
      item_name: string;
      total_qty: number;
      line_count: number;
      current_stock: number | null;
    }>;

    const soRows = (await tx.execute(sql`
      SELECT DISTINCT h.so_code_text AS so_no
      FROM public.customer_dispatches h
      WHERE h.company_id = ${companyId}::uuid AND h.deleted_at IS NULL
        AND h.so_code_text IS NOT NULL AND h.so_code_text <> ''
      ORDER BY 1 DESC
    `)) as unknown as Array<{ so_no: string }>;

    // ADR-190 — how far each listed dispatch is invoiced (against ALL its lines).
    const billed = ids.length
      ? await loadBilledQtyByDispatch(tx, companyId)
      : new Map<string, number>();
    const allQty = new Map(page.map((p) => [p.id, Number(p.all_qty)]));

    return {
      rows: lineRes.map((r) => ({
        dispatchId: r.dispatch_id,
        dispatchCode: r.dispatch_code,
        status: r.status,
        date: r.dispatch_date,
        jcNo: r.jc_no,
        soNo: r.so_no,
        soInternalNo: r.so_internal_no ?? null,
        clientPoLineNo: r.client_po_line_no,
        itemCode: r.item_code,
        itemRevision: r.item_revision ?? null,
        itemCodeText: r.item_code_text,
        itemName: r.item_name,
        qty: Math.round(n(r.qty)),
        uom: r.uom,
        customer: r.customer,
        dispatchedBy: r.dispatched_by,
        remarks: r.remarks,
        stockBefore: r.stock_before === null ? null : n(r.stock_before),
        stockAfter: r.stock_after === null ? null : n(r.stock_after),
        currentStock: r.current_stock === null ? null : Math.round(n(r.current_stock)),
        billedStatus: billedStatusOf(
          billed.get(r.dispatch_id) ?? 0,
          allQty.get(r.dispatch_id) ?? 0,
        ),
      })),
      total: Number(agg?.total ?? 0),
      summary: {
        totalQty: Number(agg?.total_qty ?? 0),
        dispatchCount: Number(agg?.dispatch_count ?? 0),
      },
      itemSummary: items.map((it) => ({
        itemCode: it.item_code,
        itemName: it.item_name,
        totalQty: Number(it.total_qty),
        lineCount: Number(it.line_count),
        currentStock: it.current_stock === null ? null : Math.round(n(it.current_stock)),
      })),
      soOptions: soRows.map((s) => s.so_no),
    };
  });
}
