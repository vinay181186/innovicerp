import type { ReportColumn, ReportFilterField, ReportRow, ReportRowLink } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ApiError, apiDownload } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter } from '@/ui/layout';
import { ReportFilter, ReportShell, reportTotalRowStyle } from '@/ui/data/ReportShell';
import { useReportList, useReportRun } from '../api';
import { StarToggle } from '../components/star-toggle';
import { downloadCsv, rowsToCsv } from '../lib/csv';
import { useReportAccess } from '../lib/report-access';
import { useReportPrefs } from '../lib/report-prefs';
import { statusText } from '@/lib/status-text';

const runSearchSchema = z.record(z.string()).default({});

/** Client-side page size for the runner (ERPNext shows reports in pages). */
const PAGE_SIZE = 100;

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
  const goTo = useNavigate();

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

  const [pendingFilters, setPendingFilters] = useState<Record<string, string>>(() =>
    stripBlanks(search),
  );
  const appliedFilters: Record<string, string> = useMemo(() => stripBlanks(search), [search]);

  const { data, isLoading, isFetching, isError, error } = useReportRun(
    allowed ? slug : undefined,
    appliedFilters,
  );
  const [page, setPage] = useState(1);

  const onApply = () => {
    setPage(1);
    void navigate({
      search: () => stripBlanks(pendingFilters),
      replace: true,
    });
  };

  const onClear = () => {
    setPendingFilters({});
    setPage(1);
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

  const onBack = () => void goTo({ to: '/reports' });

  // The server enforces the same rule: a 403 from the run call (access changed
  // since the list loaded) shows the same panel, not a raw error.
  const forbidden = isError && error instanceof ApiError && error.status === 403;

  if ((definition && accessReady && !allowed) || forbidden) {
    return (
      <ReportShell title="Reports" icon="📊" backLabel="Back to Reports" onBack={onBack}>
        <div className="panel">
          <div className="panel-body empty-state">
            <div className="empty-icon">🔒</div>
            You don&apos;t have access to this report.
          </div>
        </div>
      </ReportShell>
    );
  }

  if (listLoading || !definition || !accessReady) {
    return (
      <ReportShell title="Reports" icon="📊" backLabel="Back to Reports" onBack={onBack}>
        <div className="panel">
          {listLoading || (definition && !accessReady) ? (
            <div className="panel-body text3">
              <Loader2 size={14} className="inline animate-spin" /> Loading report…
            </div>
          ) : (
            <div className="panel-body empty-state">
              <div className="empty-icon">📊</div>
              {/* The server lists only the reports this user may see, so a
                  hidden report looks the same as a missing one from here. */}
              There is no report <span className="mono">{slug}</span>, or you don&apos;t have access
              to it.
            </div>
          )}
        </div>
      </ReportShell>
    );
  }

  const rows = data?.rows ?? [];
  // ADR-190: a report may name one column that opens its document; the id sits
  // under `idKey` on the row and is never shown as a column itself.
  const rowLink = data?.rowLink ?? definition.rowLink;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages);

  return (
    <ReportShell
      title={definition.title}
      icon="📊"
      subtitle={definition.description}
      backLabel="Back to Reports"
      onBack={onBack}
      actions={<StarToggle slug={definition.slug} title={definition.title} />}
      filters={
        definition.filters.length > 0
          ? definition.filters.map((filter) => (
              <FilterInput
                key={filter.key}
                filter={filter}
                value={pendingFilters[filter.key] ?? ''}
                onChange={(v) => setPendingFilters((prev) => ({ ...prev, [filter.key]: v }))}
              />
            ))
          : undefined
      }
      onApply={definition.filters.length > 0 ? onApply : undefined}
      onClear={definition.filters.length > 0 ? onClear : undefined}
      applying={isFetching}
      onExport={{ csv: onCsv, excel: () => void onExcel(), busy: excelLoading }}
      exportDisabled={(data?.rowCount ?? 0) === 0}
      footer={
        total > PAGE_SIZE ? (
          <ListFooter total={total} page={safePage} pageSize={PAGE_SIZE} onPage={setPage} />
        ) : (
          <ListFooter total={total} noun="row" />
        )
      }
    >
      <ResultsTable
        columns={
          rowLink ? definition.columns.filter((c) => c.key !== rowLink.idKey) : definition.columns
        }
        rowLink={rowLink}
        rows={rows}
        page={safePage}
        hasData={Boolean(data)}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
      />
    </ReportShell>
  );
}

function FilterInput(props: {
  filter: ReportFilterField;
  value: string;
  onChange: (v: string) => void;
}) {
  const { filter, value, onChange } = props;
  const id = `filter-${filter.key}`;
  return (
    <ReportFilter label={filter.label} htmlFor={id} size={filter.kind === 'text' ? 'lg' : 'md'}>
      {filter.kind === 'date' ? (
        <input
          id={id}
          className="innovic-input"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : filter.kind === 'text' ? (
        <input
          id={id}
          className="innovic-input"
          type="text"
          placeholder={filter.placeholder ?? ''}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <select
          id={id}
          className="innovic-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All</option>
          {(filter.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {statusText(opt)}
            </option>
          ))}
        </select>
      )}
    </ReportFilter>
  );
}

/** Transcribes legacy `_rptTbl` (HTML L20072–20118): `tbl-wrap` + table. Legacy's
 *  inline zebra (L20088) is dropped — `.innovic-table`'s `nth-child(even)` rule is
 *  the ported equivalent. The bold totals row (legacy `tr.rpt-total`,
 *  L20107–20116) is back as a display-only sum of the rows the server returned —
 *  see `isSummable` for which columns get one. */
function ResultsTable(props: {
  columns: ReportColumn[];
  rowLink: ReportRowLink | undefined;
  rows: ReportRow[];
  page: number;
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | undefined;
}) {
  const { columns, rowLink, rows, page, hasData, isLoading, isError, errorMessage } = props;

  const numeric = useMemo(
    () => new Set(columns.filter((c) => isNumericColumn(c, rows)).map((c) => c.key)),
    [columns, rows],
  );
  const totals = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of columns) {
      if (!numeric.has(c.key) || !isSummable(c, rows)) continue;
      out.set(
        c.key,
        rows.reduce((s, r) => s + (r[c.key] == null ? 0 : Number(r[c.key])), 0),
      );
    }
    return out;
  }, [columns, rows, numeric]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showTotals = totals.size > 0 && rows.length > 0 && !isLoading && !isError;

  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={numeric.has(col.key) ? 'th-num' : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="text3">
                  <Loader2 size={12} className="inline animate-spin" /> Running…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} style={{ color: 'var(--red2)' }}>
                  {errorMessage ?? 'Could not run report. Try again.'}
                </td>
              </tr>
            ) : !hasData || rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  No rows match these filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => (
                <tr key={(page - 1) * PAGE_SIZE + i}>
                  {columns.map((col, ci) => {
                    const raw = row[col.key];
                    const badge = typeof raw === 'string' ? statusBadge(raw) : undefined;
                    const linkId =
                      rowLink && rowLink.column === col.key ? row[rowLink.idKey] : undefined;
                    return (
                      <td
                        key={col.key}
                        className={numeric.has(col.key) ? 'td-num' : undefined}
                        style={cellStyle(col, raw, ci, badge != null)}
                      >
                        {badge ? (
                          <span className={`badge ${badge}`}>{formatCell(col, raw)}</span>
                        ) : rowLink && linkId != null && linkId !== '' ? (
                          <Link
                            to={rowLink.route.replace('$id', String(linkId))}
                            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                          >
                            {formatCell(col, raw)}
                          </Link>
                        ) : (
                          formatCell(col, raw)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {showTotals ? (
            <tfoot>
              <tr style={reportTotalRowStyle}>
                {columns.map((col, ci) => {
                  const t = totals.get(col.key);
                  return (
                    <td key={col.key} className={numeric.has(col.key) ? 'td-num mono' : undefined}>
                      {t != null ? formatNumber(t) : ci === 0 ? 'Total' : ''}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

/** A column is numeric (right-aligned) when the server types it `number`, or —
 *  for an untyped column — when every non-empty value in the result is a JS
 *  number. */
function isNumericColumn(col: ReportColumn, rows: ReportRow[]): boolean {
  if (col.type === 'number') return true;
  if (col.type !== 'text') return false;
  let seen = false;
  for (const r of rows) {
    const v = r[col.key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'number') return false;
    seen = true;
  }
  return seen;
}

/** Totals-row rule. A numeric column gets a total only when BOTH hold:
 *   1. every non-empty value in it is a finite number (a stray text value
 *      means the column is not a pure measure), and
 *   2. its key or label names an additive measure — qty / quantity / pcs /
 *      amount / value / total / hours / count / weight;
 *  and it is NOT an identifier, rate, ratio or average — any key/label with
 *  id / code / no. / rate / price / % / pct / percent / avg / average / days /
 *  ratio is skipped, because adding those up gives a meaningless number.
 *  This is a display-only sum of the rows on screen; it feeds nothing else. */
const SUM_WORDS = /(qty|quantity|pcs|amount|amt|value|total|hours|hrs|count|weight|kg)/i;
const NO_SUM_WORDS =
  /(\bid\b|_id$|code|\bno\.?$|_no$|rate|price|%|pct|percent|avg|average|days|ratio)/i;
function isSummable(col: ReportColumn, rows: ReportRow[]): boolean {
  const name = `${col.key} ${col.label}`;
  if (!SUM_WORDS.test(name) || NO_SUM_WORDS.test(name)) return false;
  return rows.every((r) => {
    const v = r[col.key];
    return v === null || v === undefined || v === '' || Number.isFinite(Number(v));
  });
}

function formatNumber(num: number): string {
  return num % 1 === 0 ? String(num) : num.toFixed(2);
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
    return formatNumber(num);
  }
  if (typeof raw === 'string' && col.type === 'date') return fmtDate(raw);
  if (typeof raw === 'string' && col.type === 'datetime') return fmtDateTime(raw);
  // A status column carries the stored code (qc_pending); show its label.
  // The badge rule below still reads the raw value.
  if (typeof raw === 'string' && /status$/i.test(col.key)) {
    if (/^NC\b/.test(col.label) && raw === 'pending') return 'NC Raised';
    return statusText(raw, col.label.toLowerCase());
  }
  return String(raw);
}

/** Per-cell style, transcribing legacy `_rptTbl`'s inline-style cascade
 *  (HTML L20090–20101): mono for numbers, cyan bold for column 0, a numeric
 *  zero greyed out. Alignment is NOT set here — `td-num` right-aligns numbers
 *  and everything else stays centred by the shared table rule. A status word
 *  is drawn as a badge instead of coloured text, so the cell adds no colour. */
function cellStyle(
  col: ReportColumn,
  raw: unknown,
  ci: number,
  isBadge: boolean,
): React.CSSProperties {
  const st: React.CSSProperties = {};
  const isNum = typeof raw === 'number';
  if (isNum) {
    st.fontFamily = 'var(--mono)';
    st.fontWeight = 600;
  } else if (col.type === 'number') {
    st.fontFamily = 'var(--mono)';
  }
  if (isBadge) return st;
  if (ci === 0) {
    st.fontWeight = 700;
    st.color = 'var(--cyan)';
  }
  if (isNum && raw === 0) st.color = 'var(--text3)';
  return st;
}

/** Status keyword → badge tone, transcribed from legacy `_rptTbl`
 *  (HTML L20097–20100) — same keywords, same order, no additions. Legacy
 *  coloured the text; it is now a tinted badge so it reads at full contrast. */
function statusBadge(raw: string): string | undefined {
  if (['DELAYED', 'ZERO', 'Pending', 'Cancelled', 'NO GRN', 'Not Planned'].includes(raw)) {
    return 'b-red';
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
    return 'b-green';
  }
  if (['Approved', 'PARTIAL', 'In Planning', 'Planned'].includes(raw)) return 'b-blue';
  if (['PENDING', 'AT VENDOR'].includes(raw)) return 'b-amber';
  return undefined;
}

function stripBlanks(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
