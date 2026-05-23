import type { ReportColumn, ReportDefinition } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowRight, BarChart3, Loader2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useReportList, useReportRun } from '../api';

const listSearchSchema = z.object({
  group: z.string().optional(),
});

export const reportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports',
  validateSearch: listSearchSchema,
  component: ReportsListPage,
});

// Per-dept header colour matches legacy `deptColors` (HTML L20033).
const DEPT_COLOR: Record<string, string> = {
  Purchase: '#2563EB',
  Store: '#D97706',
  Quality: '#DC2626',
  QC: '#DC2626',
  Sales: '#16A34A',
  Finance: '#0D9488',
  Production: '#0891B2',
  Design: '#7C3AED',
};

function ReportsListPage() {
  const search = reportsListRoute.useSearch();
  const { data, isLoading, isError, error } = useReportList();

  const grouped = useMemo(() => {
    if (!data) return {} as Record<string, ReportDefinition[]>;
    const out: Record<string, ReportDefinition[]> = {};
    for (const r of data.reports) {
      if (search.group && r.group !== search.group) continue;
      if (!out[r.group]) out[r.group] = [];
      out[r.group]!.push(r);
    }
    return out;
  }, [data, search.group]);

  const deptReports = search.group && data ? grouped[search.group] : undefined;
  const isDeptMode = Boolean(search.group);

  if (isDeptMode) {
    // Dept-summary mode — mirrors legacy renderDeptReport(dept) chrome
    // verbatim (HTML L20029): purple section title + .panel/.innovic-table
    // for each report, Excel-only export per panel.
    const dept = search.group!;
    const titleColor = DEPT_COLOR[dept] ?? 'var(--cyan)';
    return (
      <div style={{ padding: 20 }}>
        <div className="section-hdr" style={{ color: titleColor, marginBottom: 16 }}>
          📊 {dept} Reports
        </div>

        {isLoading ? (
          <div className="panel">
            <div className="panel-body">
              <div className="text3" style={{ fontSize: 12 }}>
                <Loader2 size={14} className="inline animate-spin" /> Loading reports…
              </div>
            </div>
          </div>
        ) : isError || !data ? (
          <div className="panel">
            <div className="panel-body">
              <div className="empty-state" style={{ color: 'var(--red)' }}>
                {error instanceof Error ? error.message : 'Failed to load reports'}
              </div>
            </div>
          </div>
        ) : (deptReports?.length ?? 0) === 0 ? (
          <div className="panel">
            <div className="panel-body">
              <div className="empty-state">No reports configured for the {dept} department.</div>
            </div>
          </div>
        ) : (
          (deptReports ?? []).map((r) => <InlineReportPanel key={r.slug} report={r} />)
        )}
      </div>
    );
  }

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-1 h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
              <p className="text-sm text-muted-foreground">
                Server-defined reports — pick one, fill the filters, run.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to="/saved-reports">
              <Sparkles />
              Saved reports
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reports…
              </div>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load reports</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : 'Unknown error'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([group, reports]) => (
              <div key={group} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {reports.map((report) => (
                    <Link
                      key={report.slug}
                      to="/reports/$slug"
                      params={{ slug: report.slug }}
                      className="group flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{report.title}</div>
                        <p className="text-xs text-muted-foreground">{report.description}</p>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {report.columns.length} columns ·{' '}
                          {report.filters.length === 0
                            ? 'no filters'
                            : `${report.filters.length} filter${report.filters.length === 1 ? '' : 's'}`}
                        </div>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Dept-mode inline panel (legacy `_rptTbl` chrome) ────────────────────

function InlineReportPanel({ report }: { report: ReportDefinition }): React.JSX.Element {
  const { data, isLoading, isError, error } = useReportRun(report.slug, {});
  const [excelLoading, setExcelLoading] = useState(false);

  const onExcel = async (): Promise<void> => {
    setExcelLoading(true);
    try {
      await apiDownload(`/reports/${report.slug}/export.xlsx`, {}, `${report.slug}.xlsx`);
    } finally {
      setExcelLoading(false);
    }
  };

  const rowCount = data?.rowCount ?? 0;

  return (
    <div className="panel">
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--bg4)',
          fontWeight: 700,
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          {report.title}{' '}
          <span className="text3" style={{ fontWeight: 400 }}>
            ({rowCount} rows)
          </span>
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void onExcel()}
          disabled={excelLoading || rowCount === 0}
          style={{ fontSize: 10 }}
        >
          {excelLoading ? (
            <>
              <Loader2 size={10} className="inline animate-spin" /> Excel
            </>
          ) : (
            '⬇ Excel'
          )}
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              {report.columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: c.type === 'number' ? 'right' : undefined,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={report.columns.length}
                  style={{ padding: '12px', color: 'var(--text3)', fontSize: 11 }}
                >
                  <Loader2 size={12} className="inline animate-spin" /> Running…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td
                  colSpan={report.columns.length}
                  style={{ padding: '12px', color: 'var(--red)', fontSize: 11 }}
                >
                  {error instanceof Error ? error.message : 'Failed to run report.'}
                </td>
              </tr>
            ) : !data || data.rows.length === 0 ? null : (
              data.rows.map((row, i) => (
                <tr key={i}>
                  {report.columns.map((c, ci) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.type === 'number' ? 'right' : undefined,
                        fontFamily: c.type === 'number' ? 'var(--mono)' : undefined,
                        fontWeight: ci === 0 ? 700 : undefined,
                        color: ci === 0 ? 'var(--cyan)' : tintForCell(c, row[c.key]),
                      }}
                    >
                      {formatCell(c, row[c.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(col: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (col.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }
  return String(raw);
}

/** Conditional colours for known status keywords — matches legacy `_rptTbl` (HTML L20096–20100). */
function tintForCell(col: ReportColumn, raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    if (col.type === 'number' && raw === 0) return 'var(--text3)';
    return undefined;
  }
  if (
    ['DELAYED', 'ZERO', 'Pending', 'Cancelled', 'NO GRN', 'Not Planned', 'Open'].includes(raw)
  ) {
    return 'var(--red)';
  }
  if (
    [
      'ON TIME',
      'EARLY',
      'Accepted',
      'PO Created',
      'Closed',
      'OK',
      'FULLY RECEIVED',
      'RETURNED',
      'Complete',
      'Completed',
      'Released',
      'Resolved',
    ].includes(raw)
  ) {
    return 'var(--green)';
  }
  if (['Approved', 'PARTIAL', 'In Planning', 'Planned', 'Design Active', 'In Progress'].includes(raw)) {
    return 'var(--blue)';
  }
  if (['PENDING', 'AT VENDOR', 'On Hold', 'In Review', 'Submitted'].includes(raw)) {
    return 'var(--amber)';
  }
  if (['Critical', 'Major'].includes(raw)) return 'var(--red)';
  if (['Minor', 'Low'].includes(raw)) return 'var(--green)';
  return undefined;
}
