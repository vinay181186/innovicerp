// Reports service (T-041a). Two service functions:
//
//   listReports(user) → the registry's definitions the caller may see.
//   runReport(slug, filters, user) → looks up the report, checks the caller
//     may see it (403 otherwise, before any SQL runs), runs it inside
//     withUserContext, returns rows + columns + filters echo. The Excel
//     export route goes through runReport, so it is gated by the same check.
//
// Visibility is ONE shared rule — `canSeeReport` in @innovic/shared — so the
// web catalogue and the API can never disagree about which report a user may
// open. The caller's effective access is loaded once per request with
// getMyAccess (admins skip the read; they see everything), the same way
// global-search does it.
//
// Filter values arrive as `Record<string, string>` from the URL query; per-
// report validation is left to each definition's run function (most just do
// optional ISO-date parsing or enum membership).

import { canSeeReport, type EffectiveAccess } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { getMyAccess } from '../access-control/service';
import { listReportDefinitions, REPORTS } from './registry';
import type { ListReportsResponse, RunReportResponse } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Admins bypass the matrix (same as requireFormAccess), so skip the read.
const loadAccess = (user: AuthContext): Promise<EffectiveAccess | null> =>
  user.role === 'admin' ? Promise.resolve(null) : getMyAccess(user);

export async function listReports(user: AuthContext): Promise<ListReportsResponse> {
  const eff = await loadAccess(user);
  return { reports: listReportDefinitions().filter((def) => canSeeReport(user, eff, def)) };
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
  const eff = await loadAccess(user);
  if (!canSeeReport(user, eff, report.definition)) {
    throw new AuthorizationError(
      `You do not have access to the "${report.definition.title}" report`,
    );
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
      ...(report.definition.rowLink ? { rowLink: report.definition.rowLink } : {}),
    };
  });
}
