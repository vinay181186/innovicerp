import type { ReportColumn, ReportDefinition } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
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

// Per-dept accent, mirroring legacy `deptColors` (HTML L20033) — used for the
// dept-page header and for the per-report chips, exactly as legacy colours its
// report tabs. Legacy's hexes are mapped to the nearest theme token rather than
// copied literally (the port is a light theme; legacy was dark):
//   #2563EB → --blue · #D97706 → --amber · #DC2626 → --red · #16A34A → --green
//   #0D9488 → --dept-finance · #0891B2 → --cyan · #7C3AED → --purple
// Groups legacy has no colour for fall back to var(--cyan), as legacy does.
const DEPT_COLOR: Record<string, string> = {
  Purchase: 'var(--blue)',
  Store: 'var(--amber)',
  Quality: 'var(--red)',
  QC: 'var(--red)',
  Sales: 'var(--green)',
  Finance: 'var(--dept-finance)',
  Production: 'var(--cyan)',
  Design: 'var(--purple)',
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
    // (HTML L20029): dept-coloured section title + .panel/.innovic-table per
    // report, Excel-only export per panel. Legacy shows one report at a time
    // behind a tab row (L20037–20043); we stack every dept report instead, so
    // nothing is hidden behind a tab.
    const dept = search.group!;
    const titleColor = DEPT_COLOR[dept] ?? 'var(--cyan)';
    return (
      <div style={{ padding: 20 }}>
        <div className="section-hdr" style={{ marginBottom: 8, color: titleColor }}>
          <span style={{ fontSize: 16 }}>📊</span> {dept} Reports
        </div>

        {isLoading ? (
          <div className="panel">
            <div className="panel-body text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading reports…
            </div>
          </div>
        ) : isError || !data ? (
          <div className="panel">
            <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load reports'}
            </div>
          </div>
        ) : (deptReports?.length ?? 0) === 0 ? (
          <div className="panel">
            <div className="panel-body empty-state">
              No reports configured for this department.
            </div>
          </div>
        ) : (
          (deptReports ?? []).map((r) => <InlineReportPanel key={r.slug} report={r} />)
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📊 Reports
        </div>
        <Link to="/saved-reports" className="btn btn-sm btn-ghost">
          ✨ Saved Reports
        </Link>
      </div>
      <div className="text3" style={{ fontSize: 12, marginBottom: 16 }}>
        Server-defined reports — pick one, fill the filters, run.
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading reports…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load reports'}
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([group, reports]) => {
          const color = DEPT_COLOR[group] ?? 'var(--cyan)';
          return (
            <div key={group}>
              <div className="section-hdr" style={{ marginBottom: 8, color }}>
                {group}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
                {reports.map((report) => (
                  <Link
                    key={report.slug}
                    to="/reports/$slug"
                    params={{ slug: report.slug }}
                    className="btn btn-sm"
                    style={{
                      fontWeight: 700,
                      background: color,
                      color: '#fff',
                      border: `1px solid ${color}`,
                    }}
                    title={`${report.description} — ${report.columns.length} columns · ${
                      report.filters.length === 0
                        ? 'no filters'
                        : `${report.filters.length} filter${report.filters.length === 1 ? '' : 's'}`
                    }`}
                  >
                    {report.title}
                  </Link>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
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
                    <td key={c.key} style={cellStyle(c, row[c.key], ci)}>
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

/** Per-cell style, transcribing legacy `_rptTbl`'s inline-style cascade
 *  (HTML L20090–20101). Legacy appends each rule to one style string, so the
 *  LAST write wins per property: a status colour overrides the column-0 cyan,
 *  and a numeric zero renders muted. Legacy sniffs numeric columns from the
 *  first five rows (L20076–20078); the server types them for us, so `col.type`
 *  stands in for legacy's `numCols[ci]`. */
function cellStyle(col: ReportColumn, raw: unknown, ci: number): React.CSSProperties {
  const st: React.CSSProperties = {};
  const isNum = typeof raw === 'number';
  if (isNum) {
    st.textAlign = 'right';
    st.fontFamily = 'var(--mono)';
    st.fontWeight = 600;
  } else if (col.type === 'number') {
    st.textAlign = 'right';
    st.fontFamily = 'var(--mono)';
  }
  if (ci === 0) {
    st.fontWeight = 700;
    st.color = 'var(--cyan)';
  }
  if (isNum && raw === 0) st.color = 'var(--text3)';
  if (typeof raw === 'string') {
    const tint = statusColor(raw);
    if (tint) {
      st.color = tint;
      st.fontWeight = 700;
    }
  }
  return st;
}

/** Conditional colours for known status keywords — matches legacy `_rptTbl` (HTML L20096–20100). */
function statusColor(raw: string): string | undefined {
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
