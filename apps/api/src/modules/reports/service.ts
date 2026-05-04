// Reports service (T-041a). Two service functions:
//
//   listReports() → static — just returns the registry's definitions.
//   runReport(slug, filters, user) → looks up the report, runs it inside
//     withUserContext, returns rows + columns + filters echo.
//
// Filter values arrive as `Record<string, string>` from the URL query; per-
// report validation is left to each definition's run function (most just do
// optional ISO-date parsing or enum membership).

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { listReportDefinitions, REPORTS } from './registry';
import type { ListReportsResponse, RunReportResponse } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export function listReports(): ListReportsResponse {
  return { reports: listReportDefinitions() };
}

export async function runReport(
  slug: string,
  filters: Record<string, string>,
  user: AuthContext,
): Promise<RunReportResponse> {
  const companyId = requireCompany(user);
  const report = REPORTS[slug];
  if (!report) {
    throw new NotFoundError(`Report "${slug}" not found`);
  }

  return withUserContext(user, async (tx) => {
    const result = await report.run({ tx, companyId, filters });
    return {
      slug,
      title: report.definition.title,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      generatedAt: new Date().toISOString(),
      filters,
    };
  });
}
