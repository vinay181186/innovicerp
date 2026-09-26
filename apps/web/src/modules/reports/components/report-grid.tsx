// Report grid modelled on frappe-datatable (ERPNext Query Report): a status
// line (row count · updated time · Column filters toggle) over a bordered,
// internally scrolling table, and the shared ListFooter pager under it when
// the result runs past one page. Sorting and column filters run on the loaded
// rows, BEFORE paging; the row count, the totals and the CSV export follow the
// filtered + sorted set.
import type { ReportColumn, ReportRow, ReportRowLink } from '@innovic/shared';
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { fmtDateTime } from '@/lib/date';
import { ListFooter } from '@/ui/layout';
import { filterRows, nextSort, sortRows, type SortState } from '../lib/grid-model';
import { plural } from '../lib/plural';
import { isNumericColumn, isSummable } from '../lib/report-format';
import { GridTable } from './grid-table';
import '../report-grid.css';

/** Client-side page size (ERPNext pages its report view too). */
export const PAGE_SIZE = 200;
const NO_ROWS: ReportRow[] = [];

export interface ReportGridProps {
  columns: ReportColumn[];
  rows: ReportRow[] | undefined;
  rowLink: ReportRowLink | undefined;
  /** No result yet — first load for these filters. */
  loading: boolean;
  /** A (re)fetch is in flight; previous rows stay on screen. */
  fetching: boolean;
  errorText: string | null;
  generatedAt: string | undefined;
  /** Kept pointed at the current view (column-filtered + sorted, every page)
   *  so the page's CSV export writes exactly what the grid shows. */
  viewRowsRef: MutableRefObject<ReportRow[]>;
}

export function ReportGrid(props: ReportGridProps): React.JSX.Element {
  const { columns, rowLink, loading, fetching, errorText, generatedAt, viewRowsRef } = props;
  const rows = props.rows ?? NO_ROWS;

  const [sort, setSort] = useState<SortState | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);

  // A new result (filters changed / refresh) starts at page 1.
  useEffect(() => setPage(1), [rows]);

  const numericKeys = useMemo(
    () => new Set(columns.filter((c) => isNumericColumn(c, rows)).map((c) => c.key)),
    [columns, rows],
  );
  const filtered = useMemo(
    () => (showFilters ? filterRows(rows, columns, terms, numericKeys) : rows),
    [rows, columns, terms, numericKeys, showFilters],
  );
  const sorted = useMemo(
    () => sortRows(filtered, sort, numericKeys),
    [filtered, sort, numericKeys],
  );
  useEffect(() => {
    viewRowsRef.current = sorted;
  }, [sorted, viewRowsRef]);

  const totals = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of columns) {
      if (!numericKeys.has(c.key) || !isSummable(c, filtered)) continue;
      out.set(
        c.key,
        filtered.reduce((s, r) => s + (r[c.key] == null ? 0 : Number(r[c.key])), 0),
      );
    }
    return out;
  }, [columns, filtered, numericKeys]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(start, start + PAGE_SIZE);

  const filtersOn = showFilters && Object.values(terms).some((t) => t.trim() !== '');
  const message = errorText
    ? { text: errorText, error: true }
    : !loading && total === 0
      ? {
          text: filtersOn ? 'No rows match the column filters' : 'No data for these filters',
          error: false,
        }
      : null;

  const updated = generatedAt ? fmtDateTime(generatedAt).split(' ')[1] : undefined;

  return (
    <>
      <div className="rpt-status">
        <span>
          {loading ? '… rows' : plural(total, 'row')}
          {filtersOn && !loading ? (
            <span className="rpt-muted"> (of {rows.length.toLocaleString('en-IN')})</span>
          ) : null}
        </span>
        {updated ? <span className="rpt-muted">Updated {updated}</span> : null}
        <div className="rpt-status-right">
          <button
            type="button"
            className={`btn btn-ghost btn-sm rpt-toggle${showFilters ? ' is-on' : ''}`}
            aria-pressed={showFilters}
            onClick={() => {
              setShowFilters((v) => !v);
              setPage(1);
            }}
          >
            Column filters
          </button>
        </div>
      </div>
      <div className="rpt-grid-wrap">
        {fetching ? <div className="rpt-bar" role="progressbar" aria-label="Loading" /> : null}
        <div className="rpt-grid">
          <GridTable
            columns={columns}
            numericKeys={numericKeys}
            rowLink={rowLink}
            rows={pageRows}
            firstRowNo={start + 1}
            totals={totals.size > 0 && total > 0 ? totals : null}
            sort={sort}
            onSort={(key) => {
              setSort((cur) => nextSort(cur, key));
              setPage(1);
            }}
            showFilters={showFilters}
            filterTerms={terms}
            onFilter={(key, value) => {
              setTerms((cur) => ({ ...cur, [key]: value }));
              setPage(1);
            }}
            skeleton={loading && !errorText}
            message={message}
          />
        </div>
      </div>
      {pages > 1 ? (
        <ListFooter
          total={total}
          page={safePage}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          noun="row"
        />
      ) : null}
    </>
  );
}
