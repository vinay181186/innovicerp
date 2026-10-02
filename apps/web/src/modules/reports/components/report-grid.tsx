// Report grid on the shared fit engine (ADR-199 Phase 4): a status line (row
// count · updated time · Column filters toggle), the optional column-filter
// strip, then <DataTable tableKey="report-<slug>"> — one line per row, always
// fits the width (text shrinks, then the rightmost unpinned columns move into
// ▸), Columns ▾ saved per user per report, Comfortable / Compact, '#' first
// and pinned, a pinned Total row — and the shared ListFooter pager under it.
//
// ADR-201 (2026-10-02): 25 rows a page, and only that page is loaded. Sort,
// column filters, the row count and the Total row are all worked out on the
// SERVER over every row of the report (apps/api reports/grid.ts); this
// component only shows the page it is handed and reports clicks back up.
import type { ReportColumn, ReportRow, ReportRowLink, RunReportResponse } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { fmtDateTime } from '@/lib/date';
import { LIST_PAGE_SIZE, useClampPage } from '@/lib/list-paging';
import { DataTable } from '@/ui/data';
import { TABLE_KEY_PREFIXES } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { plural } from '../lib/plural';
import { ROW_NO_ID, buildReportColumns, formatTotals } from '../lib/report-columns';
import { isNumericColumn } from '../lib/report-format';
import type { ReportGridState } from '../lib/use-report-grid';
import { useVisibleColumnKeys } from '../lib/use-visible-columns';
import { ReportColFilters } from './report-col-filters';
import '../report-grid.css';

const NO_ROWS: ReportRow[] = [];
/** Leaves the app header, the report header, the filter bar and the status
 *  line on screen, so the pinned Total row shows without a page scroll. */
const GRID_MAX_H = 'max(240px, calc(100vh - 360px))';

export interface ReportGridProps {
  slug: string;
  columns: ReportColumn[];
  /** The current page of the report (rows + server count / totals). */
  data: RunReportResponse | undefined;
  rowLink: ReportRowLink | undefined;
  /** No result yet — first load for these filters. */
  loading: boolean;
  /** A (re)fetch is in flight; previous rows stay on screen. */
  fetching: boolean;
  errorText: string | null;
  /** Page / sort / column filters — owned by the run page, sent to the server. */
  grid: ReportGridState;
}

export function ReportGrid(props: ReportGridProps): React.JSX.Element {
  const { slug, columns, data, rowLink, loading, fetching, errorText, grid } = props;
  const rows = data?.rows ?? NO_ROWS;
  const navigate = useNavigate();

  // The server judges number columns over EVERY row; an older API without
  // the field falls back to the page's rows.
  const serverNumeric = data?.numericKeys;
  const numericKeys = useMemo(
    () =>
      new Set(serverNumeric ?? columns.filter((c) => isNumericColumn(c, rows)).map((c) => c.key)),
    [serverNumeric, columns, rows],
  );

  // Total row: the server's sums over ALL matching rows, never the page.
  const serverTotals = data?.totals;
  const totals = useMemo(
    () => formatTotals(columns, new Map(Object.entries(serverTotals ?? {}))),
    [columns, serverTotals],
  );

  const total = data?.rowCount ?? 0;
  const offset = data?.offset ?? 0;
  useClampPage(grid.page, data ? total : undefined, grid.setPage);

  // A stable key per record, so an open ▸ stays on the same record across a
  // refetch: the row's document id when the report links rows and that id is
  // unique on this page, else its position in the whole result.
  const rowKeyOf = useMemo(() => {
    const idKey = rowLink?.idKey;
    const docIds = idKey ? rows.map((r) => r[idKey]) : [];
    const useDocId =
      idKey !== undefined &&
      docIds.every((v) => v != null && v !== '') &&
      new Set(docIds.map(String)).size === rows.length;
    return (row: ReportRow, i: number): string | number =>
      useDocId && idKey ? `d:${String(row[idKey])}` : offset + i;
  }, [rows, rowLink, offset]);

  const tableColumns = useMemo(
    () => buildReportColumns({ columns, numericKeys, rowLink, firstRowNo: offset + 1, totals }),
    [columns, numericKeys, rowLink, offset, totals],
  );

  // The engine's on-screen column order, read back off its header — lines the
  // Total row up and orders the filter strip.
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleKeys = useVisibleColumnKeys(rootRef);

  const filtersOn = grid.showFilters && Object.values(grid.terms).some((t) => t.trim() !== '');
  const emptyText = filtersOn ? 'No rows match the column filters' : 'No data for these filters';
  const updated = data?.generatedAt ? fmtDateTime(data.generatedAt).split(' ')[1] : undefined;
  const unfiltered = data?.unfilteredCount;

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
          {filtersOn && !loading && unfiltered !== undefined && unfiltered !== total ? (
            <span className="rpt-muted"> (of {unfiltered.toLocaleString('en-IN')})</span>
          ) : null}
        </span>
        {updated ? <span className="rpt-muted">Updated {updated}</span> : null}
        <div className="rpt-status-right">
          <button
            type="button"
            className={`btn btn-ghost btn-sm rpt-toggle${grid.showFilters ? ' is-on' : ''}`}
            aria-pressed={grid.showFilters}
            onClick={grid.toggleFilters}
          >
            Column filters
          </button>
        </div>
      </div>
      {grid.showFilters ? (
        <ReportColFilters
          columns={columns}
          visibleKeys={visibleKeys}
          numericKeys={numericKeys}
          terms={grid.terms}
          onFilter={grid.setTerm}
        />
      ) : null}
      <div className="rpt-grid-wrap" ref={rootRef}>
        {fetching ? <div className="rpt-bar" role="progressbar" aria-label="Loading" /> : null}
        <DataTable
          tableKey={reportTableKey(slug)}
          columns={tableColumns}
          rows={errorText ? NO_ROWS : rows}
          // Reports keep their own filter strip, totals and count (ADR-200 S4);
          // all three run on the server (ADR-201).
          sortFilter={false}
          rowKey={rowKeyOf}
          defaultPinned={defaultPinned}
          loading={loading && !errorText}
          emptyText={emptyText}
          empty={errorText ? <span className="rpt-error">{errorText}</span> : undefined}
          sortBy={grid.sort?.key}
          sortDir={grid.sort?.dir}
          onSort={grid.toggleSort}
          onRowClick={rowLink ? openRow : undefined}
          footer={footer}
          maxHeight={GRID_MAX_H}
          wrapClassName="rpt-table"
        />
      </div>
      {total > 0 ? (
        <ListFooter
          total={total}
          page={grid.page}
          pageSize={LIST_PAGE_SIZE}
          onPage={grid.setPage}
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
