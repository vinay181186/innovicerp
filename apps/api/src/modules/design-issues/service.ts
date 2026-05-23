// All Design Issues (cross-project) — read-only list mirroring legacy
// renderDesignIssuesPage (HTML L7890). Writes happen via the
// design-projects routes (issues are nested under projects).

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  DesignIssueListItem,
  ListDesignIssuesQuery,
  ListDesignIssuesResponse,
} from '@innovic/shared';
import { designIssues } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

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
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          di.title ILIKE ${term}
          OR di.part_text ILIKE ${term}
          OR di.assigned_to_text ILIKE ${term}
          OR dp.project_name ILIKE ${term}
        )`
      : sql``;
    let filterFrag = sql``;
    if (input.filter === 'open') filterFrag = sql`AND di.status IN ('Open','In Progress')`;
    else if (input.filter === 'resolved') filterFrag = sql`AND di.status IN ('Resolved','Closed')`;
    else if (input.filter === 'critical')
      filterFrag = sql`AND di.severity = 'Critical' AND di.status NOT IN ('Resolved','Closed')`;

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
        GREATEST(0, (CURRENT_DATE - di.raised_date))::int AS "ageDays"
      FROM public.design_issues di
      LEFT JOIN public.design_projects dp ON dp.id = di.design_project_id AND dp.deleted_at IS NULL
      WHERE di.company_id = ${companyId}::uuid
        AND di.deleted_at IS NULL
        ${searchFrag}
        ${filterFrag}
      ORDER BY di.created_at DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(designIssues.companyId, companyId), isNull(designIssues.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(designIssues)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('Open','In Progress'))::int AS open,
        COUNT(*) FILTER (WHERE status IN ('Resolved','Closed'))::int AS resolved,
        COUNT(*) FILTER (WHERE severity = 'Critical' AND status NOT IN ('Resolved','Closed'))::int AS critical
      FROM public.design_issues
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
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
