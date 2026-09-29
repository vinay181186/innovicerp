// /reports — the report catalogue, laid out like an ERPNext workspace:
// ★ My Reports + Recently opened as shortcut tiles, then one card per
// department. /reports?group=<Dept> shows that department as one full-width
// list. Search (URL ?search=) narrows whichever view is open.
import type { ReportDefinition } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchInput } from '@/ui/forms/SearchInput';
import { PageState } from '@/ui/layout';
import '@/routes/static-data';
import { useReportList } from '../api';
import { DeptCards, DeptList, ShortcutSection, groupByDept } from '../components/catalogue';
import { ReportPageHeader } from '../components/report-page-header';
import { plural } from '../lib/plural';
import { useReportAccess } from '../lib/report-access';
import { useReportPrefs } from '../lib/report-prefs';

const listSearchSchema = z.object({
  group: z.string().optional(),
  search: z.string().optional(),
});

export const reportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports',
  validateSearch: listSearchSchema,
  // The page prints its own trail (Reports › <Dept>); the shell hides its own.
  staticData: { ownCrumbs: true },
  component: ReportsListPage,
});

function ReportsListPage() {
  const search = reportsListRoute.useSearch();
  const navigate = reportsListRoute.useNavigate();
  const { data, isLoading, isError, error } = useReportList();
  const { ready: accessReady, canSee } = useReportAccess();

  // Only the reports this user's Access Control allows. Empty until access has
  // loaded (the page shows its loading line meanwhile), so nothing flickers in
  // and back out.
  const visible = useMemo(
    () => (data && accessReady ? data.reports.filter((r) => canSee(r)) : []),
    [data, accessReady, canSee],
  );

  const loading = isLoading || !accessReady;
  const failed = !loading && (isError || !data);
  const errorText = error instanceof Error ? error.message : 'Could not load reports. Try again.';

  const dept = search.group;
  const term = search.search ?? '';
  const scoped = useMemo(
    () => (dept ? visible.filter((r) => r.group === dept) : visible),
    [visible, dept],
  );
  const matched = useMemo(
    () => scoped.filter((r) => matchesSearchTerm([r.title, r.description, r.group], term)),
    [scoped, term],
  );

  const onSearch = (v: string): void => {
    const next = normalizeSearchTerm(v);
    void navigate({
      search: (prev) => ({ ...prev, search: next === '' ? undefined : next }),
      replace: true,
    });
  };

  const searchBox = (
    <SearchInput
      value={term}
      onChange={onSearch}
      debounceMs={250}
      width={260}
      placeholder={dept ? `Search ${dept} reports…` : 'Search report, description, department…'}
      aria-label="Search reports"
    />
  );

  const count = loading || failed ? undefined : matched.length;
  const subline =
    count === undefined
      ? ' '
      : term
        ? `${plural(count, 'report')} match “${term}”`
        : `${plural(count, 'report')} available to you`;

  const body = loading ? (
    <PageState state="loading" message="Loading reports…" />
  ) : failed ? (
    <PageState state="error" message={errorText} />
  ) : dept ? (
    matched.length === 0 ? (
      <PageState
        state="empty"
        message={
          term
            ? 'No report in this department matches your search.'
            : 'No reports for this department that you have access to.'
        }
      />
    ) : (
      <DeptList reports={matched} />
    )
  ) : (
    <Catalogue reports={matched} term={term} />
  );

  return (
    <div className="rpt-page">
      <ReportPageHeader
        title={dept ? `${dept} Reports` : 'Reports'}
        dept={dept}
        subline={subline}
        actions={
          <>
            {searchBox}
            {dept ? (
              <Link to="/reports" className="btn btn-ghost">
                All Reports
              </Link>
            ) : (
              <Link to="/saved-reports" className="btn btn-ghost">
                Saved Reports
              </Link>
            )}
          </>
        }
      />
      {body}
    </div>
  );
}

// ─── Catalogue mode: ★ My Reports, Recently opened, then by department ──

function Catalogue({ reports, term }: { reports: ReportDefinition[]; term: string }) {
  const { starred, recent } = useReportPrefs();
  const bySlug = useMemo(() => new Map(reports.map((r) => [r.slug, r])), [reports]);

  // Starred / recent slugs that are still a visible, matching report — a
  // report the user has since lost access to drops out of both sections.
  const pick = (slugs: readonly string[]): ReportDefinition[] =>
    slugs.map((s) => bySlug.get(s)).filter((r): r is ReportDefinition => Boolean(r));
  const mine = pick(starred);
  const recents = pick(recent);
  const groups = useMemo(() => groupByDept(reports), [reports]);

  return (
    <>
      {mine.length > 0 ? <ShortcutSection label="★ My Reports" reports={mine} /> : null}
      {recents.length > 0 ? <ShortcutSection label="Recently opened" reports={recents} /> : null}
      {groups.length === 0 ? (
        <PageState
          state="empty"
          message={term ? 'No report matches your search.' : 'No reports you have access to.'}
        />
      ) : (
        <DeptCards groups={groups} />
      )}
    </>
  );
}
