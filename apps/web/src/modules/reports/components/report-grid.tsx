// Report grid on the shared fit engine (ADR-199 Phase 4): a status line (row
// count · updated time · Column filters toggle), the optional column-filter
// strip, then <DataTable tableKey="report-<slug>"> — one line per row, always
// fits the width (text shrinks, then the rightmost unpinned columns move into
// ▸), Columns ▾ saved per user per report, Comfortable / Compact, '#' first
// and pinned, a pinned Total row — and the shared ListFooter pager under it
// when the result runs past one page. Sorting and column filters run on the
// loaded rows, BEFORE paging; the row count, the totals and the CSV export
// follow the filtered + sorted set.
import type { ReportColumn, ReportRow, ReportRowLink } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { fmtDateTime } from '@/lib/date';
import { DataTable } from '@/ui/data';
import { TABLE_KEY_PREFIXES } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { filterRows, nextSort, sortRows, type SortState } from '../lib/grid-model';
import { plural } from '../lib/plural';
import { ROW_NO_ID, buildReportColumns, formatTotals } from '../lib/report-columns';
import { isNumericColumn, isSummable } from '../lib/report-format';
import { useVisibleColumnKeys } from '../lib/use-visible-columns';
import { ReportColFilters } from './report-col-filters';
import '../report-grid.css';

/** Client-side page size (ERPNext pages its report view too). */
export const PAGE_SIZE = 200;
const NO_ROWS: ReportRow[] = [];
/** Leaves the app header, the report header, the filter bar and the status
 *  line on screen, so the pinned Total row shows without a page scroll. */
const GRID_MAX_H = 'max(240px, calc(100vh - 360px))';

export interface ReportGridProps {
  slug: string;
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
  const { slug, columns, rowLink, loading, fetching, errorText, generatedAt, viewRowsRef } = props;
  const rows = props.rows ?? NO_ROWS;
  const navigate = useNavigate();

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
    const sums = new Map<string, number>();
    for (const c of columns) {
      if (!numericKeys.has(c.key) || !isSummable(c, filtered)) continue;
      sums.set(
        c.key,
        filtered.reduce((s, r) => s + (r[c.key] == null ? 0 : Number(r[c.key])), 0),
      );
    }
    return formatTotals(columns, sums);
  }, [columns, filtered, numericKeys]);

  // A stable key per record, so an open ▸ stays on the same record after a
  // sort / filter / page change: the row's document id when the report links
  // rows and that id is unique in this result, else an id given to each row
  // object as the rows arrive (the objects survive sort and filter).
  const rowKeyOf = useMemo(() => {
    const ids = new WeakMap<ReportRow, number>();
    rows.forEach((r, i) => ids.set(r, i));
    const idKey = rowLink?.idKey;
    const docIds = idKey ? rows.map((r) => r[idKey]) : [];
    const useDocId =
      idKey !== undefined &&
      docIds.every((v) => v != null && v !== '') &&
      new Set(docIds.map(String)).size === rows.length;
    return (row: ReportRow, i: number): string | number => {
      if (useDocId && idKey) return `d:${String(row[idKey])}`;
      const id = ids.get(row);
      return id === undefined ? `p:${i}` : id;
    };
  }, [rows, rowLink]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = useMemo(() => sorted.slice(start, start + PAGE_SIZE), [sorted, start]);

  const tableColumns = useMemo(
    () => buildReportColumns({ columns, numericKeys, rowLink, firstRowNo: start + 1, totals }),
    [columns, numericKeys, rowLink, start, totals],
  );

  // The engine's on-screen column order, read back off its header — lines the
  // Total row up and orders the filter strip.
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleKeys = useVisibleColumnKeys(rootRef);

  const filtersOn = showFilters && Object.values(terms).some((t) => t.trim() !== '');
  const emptyText = filtersOn ? 'No rows match the column filters' : 'No data for these filters';
  const updated = generatedAt ? fmtDateTime(generatedAt).split(' ')[1] : undefined;

  const footer =
    totals.size > 0 && visibleKeys.length > 0 ? (
      <tr className="rpt-total">
        {visibleKeys.map((k) =>
          k === ROW_NO_ID ? (
            <td key={k}>Total</td>
          ) : (
            <td key={k} className={totals.has(k) ? 'td-num mono' : undefined}>
              {totals.get(k) ?? ''}
            </td>
          ),
        )}
      </tr>
    ) : undefined;

  const openRow = (row: ReportRow): void => {
    const id = rowLink ? row[rowLink.idKey] : undefined;
    if (!rowLink || id == null || id === '') return;
    void navigate({ to: rowLink.route.replace('$id', String(id)) });
  };

  const firstKey = columns[0]?.key;
  const defaultPinned = [
    ...(firstKey ? [firstKey] : []),
    ...(columns.some((c) => c.key === 'item_code') && firstKey !== 'item_code'
      ? ['item_code']
      : []),
  ];

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
      {showFilters ? (
        <ReportColFilters
          columns={columns}
          visibleKeys={visibleKeys}
          numericKeys={numericKeys}
          terms={terms}
          onFilter={(key, value) => {
            setTerms((cur) => ({ ...cur, [key]: value }));
            setPage(1);
          }}
        />
      ) : null}
      <div className="rpt-grid-wrap" ref={rootRef}>
        {fetching ? <div className="rpt-bar" role="progressbar" aria-label="Loading" /> : null}
        <DataTable
          tableKey={reportTableKey(slug)}
          columns={tableColumns}
          rows={errorText ? NO_ROWS : pageRows}
          rowKey={rowKeyOf}
          defaultPinned={defaultPinned}
          loading={loading && !errorText}
          emptyText={emptyText}
          empty={errorText ? <span className="rpt-error">{errorText}</span> : undefined}
          sortBy={sort?.key}
          sortDir={sort?.dir}
          onSort={(key) => {
            setSort((cur) => nextSort(cur, key));
            setPage(1);
          }}
          onRowClick={rowLink ? openRow : undefined}
          footer={footer}
          maxHeight={GRID_MAX_H}
          wrapClassName="rpt-table"
        />
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

/** The saved-layout key of one report: `report-<slug>`, kept inside the
 *  table-key rule (lower-case letters, digits, hyphens, ≤ 64). */
export function reportTableKey(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${TABLE_KEY_PREFIXES.report}${safe}`.slice(0, 64);
}
