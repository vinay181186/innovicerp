// All Design Issues (cross-project) — read-only list mirroring legacy
// renderDesignIssuesPage (HTML L7890). Writes happen via the
// design-projects routes (issues are nested under projects).

import { sql } from 'drizzle-orm';
import type {
  DesignIssueListItem,
  ListDesignIssuesQuery,
  ListDesignIssuesResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { DESIGN_ISSUE_SF_COLUMNS, ISSUE_AGE_DAYS_SQL } from './sf-columns';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function listDesignIssuesAll(
  input: ListDesignIssuesQuery,
  user: AuthContext,
): Promise<ListDesignIssuesResponse> {
  const companyId = requireCompany(user);
  // ADR-201: the screen asks for one 25-row page. Search + Sort & Filter
  // (ADR-200) narrow the list, its `total` AND the filter counts in the
  // dropdown; the dropdown's own filter (open / resolved / critical) narrows
  // the list + total but not the counts (each option counts its own rows).
  const sf = readSf(input.sf);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          di.title ILIKE ${term} ESCAPE '\\'
          OR di.part_text ILIKE ${term} ESCAPE '\\'
          OR di.assigned_to_text ILIKE ${term} ESCAPE '\\'
          OR dp.project_name ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    let filterFrag = sql``;
    if (input.filter === 'open') filterFrag = sql`AND di.status IN ('Open','In Progress')`;
    else if (input.filter === 'resolved') filterFrag = sql`AND di.status IN ('Resolved','Closed')`;
    else if (input.filter === 'critical')
      filterFrag = sql`AND di.severity = 'Critical' AND di.status NOT IN ('Resolved','Closed')`;

    const fromWhere = sql`
      FROM public.design_issues di
      LEFT JOIN public.design_projects dp ON dp.id = di.design_project_id AND dp.deleted_at IS NULL
      WHERE di.company_id = ${companyId}::uuid
        AND di.deleted_at IS NULL
        ${searchFrag}
        ${sfWhere(DESIGN_ISSUE_SF_COLUMNS, sf)}`;
    // Newest first; id breaks a created_at tie so paging never skips a row.
    const orderBy = sfOrderBy(DESIGN_ISSUE_SF_COLUMNS, sf, sql`di.created_at DESC, di.id DESC`);

    const result = await tx.execute(sql`
      SELECT
        di.id, di.company_id AS "companyId",
        di.design_project_id AS "designProjectId",
        di.design_task_id AS "designTaskId",
        di.title,
        di.part_text AS "partText",
        di.severity,
        di.status,
        di.raised_by_text AS "raisedByText",
        di.assigned_to_text AS "assignedToText",
        di.raised_date AS "raisedDate",
        di.resolved_date AS "resolvedDate",
        di.description,
        di.discussions,
        di.created_at AS "createdAt",
        di.updated_at AS "updatedAt",
        dp.project_name AS "projectName",
        ${ISSUE_AGE_DAYS_SQL} AS "ageDays"
      ${fromWhere}
        ${filterFrag}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n ${fromWhere} ${filterFrag}
    `)) as unknown as Array<{ n: number }>;
    const total = Number(totalRows[0]?.n ?? 0);

    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE di.status IN ('Open','In Progress'))::int AS open,
        COUNT(*) FILTER (WHERE di.status IN ('Resolved','Closed'))::int AS resolved,
        COUNT(*) FILTER (WHERE di.severity = 'Critical' AND di.status NOT IN ('Resolved','Closed'))::int AS critical
      ${fromWhere}
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(
      (r): DesignIssueListItem => {
        const d = r['discussions'];
        const discussions = Array.isArray(d)
          ? (d as Array<{ author: string; text: string; date: string }>)
          : [];
        return {
          id: r['id'] as string,
          designProjectId: r['designProjectId'] as string,
          designTaskId: (r['designTaskId'] as string | null) ?? null,
          title: String(r['title'] ?? ''),
          partText: (r['partText'] as string | null) ?? null,
          severity: r['severity'] as DesignIssueListItem['severity'],
          status: r['status'] as DesignIssueListItem['status'],
          raisedByText: (r['raisedByText'] as string | null) ?? null,
          assignedToText: (r['assignedToText'] as string | null) ?? null,
          raisedDate: dateLike(r['raisedDate']),
          resolvedDate: r['resolvedDate'] != null ? dateLike(r['resolvedDate']) : null,
          description: (r['description'] as string | null) ?? null,
          discussions,
          createdAt: tsLike(r['createdAt']),
          updatedAt: tsLike(r['updatedAt']),
          projectName: (r['projectName'] as string | null) ?? null,
          ageDays: Number(r['ageDays'] ?? 0),
        };
      },
    );

    return {
      items: itemsOut,
      total,
      limit: input.limit,
      offset: input.offset,
      summary: {
        total: Number(sum['total'] ?? 0),
        open: Number(sum['open'] ?? 0),
        resolved: Number(sum['resolved'] ?? 0),
        critical: Number(sum['critical'] ?? 0),
      },
    };
  });
}
