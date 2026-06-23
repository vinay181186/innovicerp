// Production SO List service.
//
// Per-SO aggregate view for the production floor. Mirrors legacy
// renderProdSOList (HTML L22954) where `totalDone` per SO line is the
// sum across linked JCs of the last op's qty (qc_accepted if the op
// required QC, else completed_qty).

import { sql } from 'drizzle-orm';
import type { ListProdSoQuery, ListProdSoResponse, ProdSoListRow } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function listProdSo(
  input: ListProdSoQuery,
  user: AuthContext,
): Promise<ListProdSoResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          so.code ILIKE ${term}
          OR COALESCE(c.name, so.customer_name) ILIKE ${term}
        )`
      : sql``;

    const result = await tx.execute(sql`
      WITH line_done AS (
        SELECT
          sol.id AS sol_id,
          sol.sales_order_id,
          sol.order_qty,
          sol.due_date AS line_due_date,
          COALESCE((
            SELECT SUM(
              CASE
                WHEN op.qc_required OR op.op_type = 'qc' THEN status.qc_accepted_qty
                ELSE status.completed_qty
              END
            )::int
            FROM public.job_cards jc
            JOIN public.jc_ops op
              ON op.job_card_id = jc.id
             AND op.deleted_at IS NULL
             AND op.op_seq = (
               SELECT MAX(op2.op_seq)
               FROM public.jc_ops op2
               WHERE op2.job_card_id = jc.id AND op2.deleted_at IS NULL
             )
            LEFT JOIN public.v_jc_op_status status ON status.jc_op_id = op.id
            WHERE jc.source_so_line_id = sol.id
              AND jc.deleted_at IS NULL
          ), 0)::int AS done_qty
        FROM public.sales_order_lines sol
        WHERE sol.deleted_at IS NULL
      )
      SELECT
        so.id AS "soId",
        so.code AS "soCode",
        COALESCE(c.name, so.customer_name, '—') AS "customerName",
        so.type::text AS "soType",
        so.so_date AS "soDate",
        -- sales_orders has no due_date column; the due date lives on the lines.
        -- MIN over the SO's lines = earliest line due date (null when no lines).
        MIN(ld.line_due_date) AS "dueDate",
        COUNT(ld.sol_id)::int AS "linesCount",
        COALESCE(SUM(ld.order_qty), 0)::int AS "totalQty",
        COALESCE(SUM(ld.done_qty), 0)::int AS "doneQty",
        GREATEST(0, COALESCE(SUM(ld.order_qty), 0) - COALESCE(SUM(ld.done_qty), 0))::int AS "balanceQty"
      FROM public.sales_orders so
      LEFT JOIN public.clients c ON c.id = so.client_id AND c.deleted_at IS NULL
      LEFT JOIN line_done ld ON ld.sales_order_id = so.id
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        ${searchFrag}
      GROUP BY so.id, c.name
      ORDER BY so.so_date DESC NULLS LAST, so.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r): ProdSoListRow => {
      const total = Number(r['totalQty'] ?? 0);
      const done = Number(r['doneQty'] ?? 0);
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      return {
        soId: r['soId'] as string,
        soCode: String(r['soCode'] ?? ''),
        customerName: String(r['customerName'] ?? ''),
        soType: String(r['soType'] ?? ''),
        soDate: dateLike(r['soDate']),
        dueDate: dateLike(r['dueDate']),
        linesCount: Number(r['linesCount'] ?? 0),
        totalQty: total,
        doneQty: done,
        balanceQty: Number(r['balanceQty'] ?? 0),
        progressPct: pct,
      };
    });

    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.sales_orders so
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
    `)) as unknown as Array<{ total: number }>;
    return {
      items: rows,
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}
