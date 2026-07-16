import type { ReportColumn, ReportFilterField } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useReportList, useReportRun } from '../api';
import { downloadCsv, rowsToCsv } from '../lib/csv';

const runSearchSchema = z.record(z.string()).default({});

export const reportRunRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports/$slug',
  validateSearch: runSearchSchema,
  component: ReportRunPage,
});

function ReportRunPage() {
  const { slug } = reportRunRoute.useParams();
  const search = reportRunRoute.useSearch();
  const navigate = reportRunRoute.useNavigate();

  const { data: list, isLoading: listLoading } = useReportList();
  const definition = useMemo(() => list?.reports.find((r) => r.slug === slug), [list, slug]);

  const [pendingFilters, setPendingFilters] = useState<Record<string, string>>(() =>
    stripBlanks(search),
  );
  const appliedFilters: Record<string, string> = useMemo(() => stripBlanks(search), [search]);

  const { data, isLoading, isFetching, isError, error } = useReportRun(slug, appliedFilters);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: () => stripBlanks(pendingFilters),
      replace: true,
    });
  };

  const onClear = () => {
    setPendingFilters({});
    void navigate({ search: () => ({}), replace: true });
  };

  const onCsv = () => {
    if (!data) return;
    const csv = rowsToCsv(data.columns, data.rows);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    downloadCsv(`${data.slug}-${stamp}.csv`, csv);
  };

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
          📊 {definition ? definition.title : 'Reports'}
        </div>
        <Link to="/reports" className="btn btn-sm btn-ghost">
          ← Back to Reports
        </Link>
      </div>

      {listLoading ? (
        <div className="panel">
          <div className="panel-body text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading report…
          </div>
        </div>
      ) : !definition ? (
        <div className="panel">
          <div className="panel-body empty-state">
            <div className="empty-icon">📊</div>
            There is no registered report with slug <span className="mono">{slug}</span>.
          </div>
        </div>
      ) : (
        <>
          <div className="text3" style={{ fontSize: 12, marginBottom: 16 }}>
            {definition.description}
          </div>

          {definition.filters.length > 0 ? (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-hdr">
                <div className="panel-title">Filters</div>
              </div>
              <div className="panel-body">
                <form onSubmit={onApply}>
                  <div className="form-grid-3">
                    {definition.filters.map((filter) => (
                      <FilterInput
                        key={filter.key}
                        filter={filter}
                        value={pendingFilters[filter.key] ?? ''}
                        onChange={(v) => setPendingFilters((prev) => ({ ...prev, [filter.key]: v }))}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={isFetching}>
                      {isFetching ? (
                        <>
                          <Loader2 size={12} className="inline animate-spin" /> Apply
                        </>
                      ) : (
                        'Apply'
                      )}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
                      Clear
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          <ResultsTable
            title={definition.title}
            columns={definition.columns}
            data={data}
            isLoading={isLoading}
            isError={isError}
            errorMessage={error instanceof Error ? error.message : undefined}
            onCsv={onCsv}
            onExcel={() => void onExcel()}
            excelLoading={excelLoading}
          />
        </>
      )}
    </div>
  );
}

function FilterInput(props: {
  filter: ReportFilterField;
  value: string;
  onChange: (v: string) => void;
}) {
  const { filter, value, onChange } = props;
  return (
    <div className="form-grp">
      <label className="form-label" htmlFor={`filter-${filter.key}`}>
        {filter.label}
      </label>
      {filter.kind === 'date' ? (
        <input
          id={`filter-${filter.key}`}
          className="innovic-input"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : filter.kind === 'text' ? (
        <input
          id={`filter-${filter.key}`}
          className="innovic-input"
          type="text"
          placeholder={filter.placeholder ?? ''}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <select
          id={`filter-${filter.key}`}
          className="innovic-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All</option>
          {(filter.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Transcribes legacy `_rptTbl` (HTML L20072–20118): panel + `(N rows)` count +
 *  `⬇ Excel` in the header bar, `tbl-wrap` + table below. Legacy's inline zebra
 *  (L20088) is dropped — `.innovic-table`'s `nth-child(even)` rule is the ported
 *  equivalent. Legacy's `tr.rpt-total` branch (L20107–20116) is NOT ported: no
 *  server report returns totals, and computing them in the browser is banned. */
function ResultsTable(props: {
  title: string;
  columns: ReportColumn[];
  data: ReturnType<typeof useReportRun>['data'];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  onCsv: () => void;
  onExcel: () => void;
  excelLoading: boolean;
}) {
  const { title, columns, data, isLoading, isError, errorMessage } = props;
  const { onCsv, onExcel, excelLoading } = props;
  const rowCount = data?.rowCount ?? 0;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
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
          {title}{' '}
          <span className="text3" style={{ fontWeight: 400 }}>
            ({rowCount} rows)
          </span>
        </span>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCsv}
            disabled={rowCount === 0}
            style={{ fontSize: 10 }}
          >
            ⬇ CSV
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onExcel}
            disabled={rowCount === 0 || excelLoading}
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
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ textAlign: col.type === 'number' ? 'right' : undefined }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="text3" style={{ fontSize: 11 }}>
                  <Loader2 size={12} className="inline animate-spin" /> Running…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ color: 'var(--red)', fontSize: 11 }}
                >
                  {errorMessage ?? 'Failed to run report.'}
                </td>
              </tr>
            ) : !data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  No rows match these filters.
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((col, ci) => (
                    <td key={col.key} style={cellStyle(col, row[col.key], ci)}>
                      {formatCell(col, row[col.key])}
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

/** Legacy `_rptTbl` cell display (HTML L20102): whole numbers print bare, other
 *  numbers to 2dp, and any empty/nullish value falls back to an em dash. Date
 *  columns arrive pre-formatted from the server, so there is no client-side
 *  date math here. */
function formatCell(col: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (col.type === 'number') {
    const num = Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return num % 1 === 0 ? String(num) : num.toFixed(2);
  }
  return String(raw);
}

/** Per-cell style, transcribing legacy `_rptTbl`'s inline-style cascade
 *  (HTML L20090–20101) in source order. Legacy appends every rule to ONE style
 *  string, so the last write wins per property: a status keyword's colour
 *  OVERWRITES the column-0 cyan, and a numeric zero greys out over it too.
 *  Legacy sniffs numeric columns from the first five rows (L20076–20078); the
 *  server types them for us, so `col.type` stands in for legacy's `numCols[ci]`. */
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

/** Status keyword colours, transcribed verbatim from legacy `_rptTbl`
 *  (HTML L20097–20100) — same keywords, same order, no additions. Legacy's
 *  dark-theme hexes map to the nearest light-theme token. */
function statusColor(raw: string): string | undefined {
  if (['DELAYED', 'ZERO', 'Pending', 'Cancelled', 'NO GRN', 'Not Planned'].includes(raw)) {
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
    ].includes(raw)
  ) {
    return 'var(--green)';
  }
  if (['Approved', 'PARTIAL', 'In Planning', 'Planned'].includes(raw)) return 'var(--blue)';
  if (['PENDING', 'AT VENDOR'].includes(raw)) return 'var(--amber)';
  return undefined;
}

function stripBlanks(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
