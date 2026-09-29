// /reports/$slug — one report, laid out like an ERPNext Query Report:
// breadcrumb + title ☆ + [Refresh] [Export ▾], an auto-applying filter bar,
// a status line, then the grid. The URL search params ARE the filters.
import { Link, createRoute } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import type { ReportRow } from '@innovic/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import '@/routes/static-data';
import { ActionMenu, PageState } from '@/ui/layout';
import { useReportList, useReportRun } from '../api';
import { ReportFilterBar } from '../components/report-filter-bar';
import { ReportGrid } from '../components/report-grid';
import { ReportPageHeader } from '../components/report-page-header';
import { downloadCsv, rowsToCsv } from '../lib/csv';
import { useReportAccess } from '../lib/report-access';
import { stripBlanks } from '../lib/report-format';
import { useReportPrefs } from '../lib/report-prefs';

const runSearchSchema = z.record(z.string()).default({});

export const reportRunRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports/$slug',
  validateSearch: runSearchSchema,
  // The page prints its own trail (Reports › <Dept> › <Report>); the shell hides its own.
  staticData: { ownCrumbs: true },
  component: ReportRunPage,
});

function ReportRunPage() {
  const { slug } = reportRunRoute.useParams();
  const search = reportRunRoute.useSearch();
  const navigate = reportRunRoute.useNavigate();

  const { data: list, isLoading: listLoading } = useReportList();
  const definition = useMemo(() => list?.reports.find((r) => r.slug === slug), [list, slug]);
  // Access Control: a report the catalogue hides is not run when opened by URL
  // either. Nothing is fetched until the definition AND the access matrix are in.
  const { ready: accessReady, canSee } = useReportAccess();
  const allowed = Boolean(definition && accessReady && canSee(definition));
  const { pushRecent } = useReportPrefs();
  useEffect(() => {
    if (allowed) pushRecent(slug);
  }, [allowed, slug, pushRecent]);

  const appliedFilters: Record<string, string> = useMemo(() => stripBlanks(search), [search]);

  const run = useReportRun(allowed ? slug : undefined, appliedFilters);
  const { isLoading, isFetching, isError, error, refetch } = run;
  // placeholderData keeps the previous result on screen while the next one
  // loads — but never another report's rows under this report's columns.
  const data = run.data && run.data.slug === slug ? run.data : undefined;

  // Filters apply as they change: the URL is rewritten (replace, so Back
  // leaves the report rather than stepping through every keystroke).
  const setFilter = (key: string, value: string): void => {
    void navigate({
      search: (prev) => stripBlanks({ ...prev, [key]: value }),
      replace: true,
    });
  };
  // Bumped by Clear filters so a text box drops a still-pending debounce and a
  // date box drops a half-typed date (see SearchInput's RESET SEMANTICS).
  const [resetKey, setResetKey] = useState(0);
  const clearFilters = (): void => {
    setResetKey((k) => k + 1);
    void navigate({ search: () => ({}), replace: true });
  };

  // CSV = exactly what the grid shows: its column filters and sort, all pages.
  // The grid keeps this ref pointed at its current view.
  const viewRows = useRef<ReportRow[]>([]);

  const [excelLoading, setExcelLoading] = useState(false);
  const onExcel = async () => {
    if (!slug) return;
    const params = new URLSearchParams(appliedFilters);
    const qs = params.toString();
    setExcelLoading(true);
    try {
      await apiDownload(`/reports/${slug}/export.xlsx${qs ? `?${qs}` : ''}`, {}, `${slug}.xlsx`);
    } finally {
      setExcelLoading(false);
    }
  };

  // The server enforces the same rule: a 403 from the run call (access changed
  // since the list loaded) shows the same panel, not a raw error.
  const forbidden = isError && error instanceof ApiError && error.status === 403;

  if ((definition && accessReady && !allowed) || forbidden) {
    return (
      <StatePage>
        <PageState state="noaccess" icon="🔒" message="You don't have access to this report." />
      </StatePage>
    );
  }

  if (listLoading || !definition || !accessReady) {
    return (
      <StatePage>
        {listLoading || (definition && !accessReady) ? (
          <PageState state="loading" message="Loading report…" />
        ) : (
          // The server lists only the reports this user may see, so a hidden
          // report looks the same as a missing one from here.
          <PageState
            state="empty"
            icon="📊"
            message={
              <>
                There is no report <span className="mono">{slug}</span>, or you don&apos;t have
                access to it.
              </>
            }
          />
        )}
      </StatePage>
    );
  }

  // ADR-190: a report may name one column that opens its document; the id sits
  // under `idKey` on the row and is never shown as a column itself.
  const rowLink = data?.rowLink ?? definition.rowLink;
  const columns = rowLink
    ? definition.columns.filter((c) => c.key !== rowLink.idKey)
    : definition.columns;
  const noRows = (data?.rowCount ?? 0) === 0;

  const onCsv = () => {
    if (!data) return;
    const csv = rowsToCsv(columns, viewRows.current);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    downloadCsv(`${data.slug}-${stamp}.csv`, csv);
  };
  // Neither file may come from a stale result: Export is off while fetching.
  const exportOff = noRows || isFetching;

  return (
    <div className="rpt-page">
      <ReportPageHeader
        title={definition.title}
        dept={definition.group}
        current={definition.title}
        star={{ slug: definition.slug, title: definition.title }}
        subline={definition.description}
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw size={14} className={isFetching ? 'rpt-spin' : undefined} />
              Refresh
            </button>
            {exportOff ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled
                title={isFetching ? 'Wait for the report to finish loading' : 'Nothing to export'}
              >
                Export ▾
              </button>
            ) : (
              <ActionMenu
                label={excelLoading ? 'Exporting…' : 'Export'}
                items={[
                  {
                    label: 'Excel',
                    onClick: () => void onExcel(),
                    disabled: excelLoading,
                    title: excelLoading
                      ? 'Preparing the Excel file…'
                      : 'Excel uses the report filters; column filters/sort apply to CSV only',
                  },
                  {
                    label: 'CSV',
                    onClick: onCsv,
                    disabled: excelLoading,
                    title: 'CSV follows the grid: column filters and sort, all pages',
                  },
                ]}
              />
            )}
          </>
        }
      />
      <ReportFilterBar
        key={`f-${slug}`}
        resetKey={resetKey}
        filters={definition.filters}
        values={appliedFilters}
        onChange={setFilter}
        onClear={clearFilters}
      />
      {/* Keyed by report: sort, column filters and page start fresh per report. */}
      <ReportGrid
        key={`g-${slug}`}
        viewRowsRef={viewRows}
        columns={columns}
        rows={data?.rows}
        rowLink={rowLink}
        loading={isLoading || (!data && !isError)}
        fetching={isFetching && Boolean(data)}
        errorText={
          isError
            ? error instanceof Error
              ? error.message
              : 'Could not run report. Try again.'
            : null
        }
        generatedAt={data?.generatedAt}
      />
    </div>
  );
}

/** Loading / not-found / no-access: the same chrome, titled "Reports". */
function StatePage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rpt-page">
      <ReportPageHeader
        title="Reports"
        actions={
          <Link to="/reports" className="btn btn-ghost">
            All Reports
          </Link>
        }
      />
      {children}
    </div>
  );
}
