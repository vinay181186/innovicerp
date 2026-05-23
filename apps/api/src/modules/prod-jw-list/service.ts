// Production JW List service.
//
// Per-JW aggregate view for the production floor. Mirrors legacy
// renderProdJWList (HTML L22995). Same pattern as Prod SO List but
// against job_work_orders + job_work_order_lines.

import { sql } from 'drizzle-orm';
import type { ListProdJwQuery, ListProdJwResponse, ProdJwListRow } from '@innovic/shared';
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

export async function listProdJw(
  input: ListProdJwQuery,
  user: AuthContext,
): Promise<ListProdJwResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          jw.code ILIKE ${term}
          OR COALESCE(c.name, jw.customer_name) ILIKE ${term}
        )`
      : sql``;

    const result = await tx.execute(sql`
      WITH line_done AS (
        SELECT
          jwl.id AS jwl_id,
          jwl.job_work_order_id,
          jwl.order_qty,
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
            WHERE jc.source_jw_line_id = jwl.id
              AND jc.deleted_at IS NULL
          ), 0)::int AS done_qty
        FROM public.job_work_order_lines jwl
        WHERE jwl.deleted_at IS NULL
      )
      SELECT
        jw.id AS "jwId",
        jw.code AS "jwCode",
        COALESCE(c.name, jw.customer_name, '—') AS "customerName",
        jw.jw_date AS "jwDate",
        NULL AS "dueDate",
        COUNT(ld.jwl_id)::int AS "linesCount",
        COALESCE(SUM(ld.order_qty), 0)::int AS "totalQty",
        COALESCE(SUM(ld.done_qty), 0)::int AS "doneQty",
        GREATEST(0, COALESCE(SUM(ld.order_qty), 0) - COALESCE(SUM(ld.done_qty), 0))::int AS "balanceQty"
      FROM public.job_work_orders jw
      LEFT JOIN public.clients c ON c.id = jw.client_id AND c.deleted_at IS NULL
      LEFT JOIN line_done ld ON ld.job_work_order_id = jw.id
      WHERE jw.company_id = ${companyId}::uuid
        AND jw.deleted_at IS NULL
        ${searchFrag}
      GROUP BY jw.id, c.name
      ORDER BY jw.jw_date DESC NULLS LAST, jw.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map(
      (r): ProdJwListRow => {
        const total = Number(r['totalQty'] ?? 0);
        const done = Number(r['doneQty'] ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        return {
          jwId: r['jwId'] as string,
          jwCode: String(r['jwCode'] ?? ''),
          customerName: String(r['customerName'] ?? ''),
          jwDate: dateLike(r['jwDate']),
          dueDate: dateLike(r['dueDate']),
          linesCount: Number(r['linesCount'] ?? 0),
          totalQty: total,
          doneQty: done,
          balanceQty: Number(r['balanceQty'] ?? 0),
          progressPct: pct,
        };
      },
    );

    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.job_work_orders jw
      WHERE jw.company_id = ${companyId}::uuid
        AND jw.deleted_at IS NULL
    `)) as unknown as Array<{ total: number }>;
    return {
      items: rows,
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}
