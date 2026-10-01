// Report columns → DataTable columns for the fit engine (ADR-199 Phase 4).
// Owner rules for reports: text LEFT, numbers RIGHT; codes (`*_code`, `*_no`,
// pol) and dates in mono; Item Code bold mono in the body colour; status and
// type columns as pills with readable words; one '#' row-number column first.
import type { ReportColumn, ReportRow, ReportRowLink } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Badge } from '@/ui/core';
import type { DataTableColumn, DataTableColumnKind } from '@/ui/data';
import {
  cellTone,
  formatCell,
  formatNumber,
  isBlank,
  isCodeColumn,
  isQtyColumn,
  isStatusColumn,
  isTypeColumn,
} from './report-format';

/** Column id of the '#' row-number column (a code name, never a report key). */
export const ROW_NO_ID = 'rpt_rn';
/** Floor for the '#' column so the Total row's label fits in it. */
const ROW_NO_MIN_W = 56;
/** Width per character of a mono 13px digit, plus the cell's padding — a
 *  floor so a total wider than every value in its column is never cut. */
const MONO_CHAR_W = 8;
const CELL_PAD_W = 22;

export interface ReportColumnsInput {
  columns: ReportColumn[];
  numericKeys: ReadonlySet<string>;
  rowLink: ReportRowLink | undefined;
  /** Row number of the current page's first row (1-based). */
  firstRowNo: number;
  /** Formatted totals per column key — widens a column that needs it. */
  totals: ReadonlyMap<string, string>;
}

/** The engine's column kind for one report column. */
export function reportColumnKind(col: ReportColumn, numeric: boolean): DataTableColumnKind {
  if (isStatusColumn(col) || isTypeColumn(col)) return 'badge';
  if (isCodeColumn(col)) return 'code';
  if (numeric) return 'num';
  if (col.type === 'date' || col.type === 'datetime') return 'date';
  // Any other column stays text even when some cells hold a legacy status
  // word (DELAYED, ON TIME…): cellContent pills just those cells, so a
  // free-text column (remarks) is still cut with an ellipsis.
  return 'text';
}

/** The plain text a cell shows — the tooltip, and what a filter matches. */
function cellText(col: ReportColumn, row: ReportRow): string | undefined {
  const raw = row[col.key];
  return isBlank(raw) ? undefined : formatCell(col, raw);
}

function cellContent(
  col: ReportColumn,
  kind: DataTableColumnKind,
  row: ReportRow,
  numeric: boolean,
  rowLink: ReportRowLink | undefined,
): ReactNode {
  const raw = row[col.key];
  if (isBlank(raw)) return <span className="rpt-muted">—</span>;
  const text = formatCell(col, raw);
  if (numeric && Number(raw) === 0) return <span className="rpt-muted">{text}</span>;
  if (typeof raw === 'string') {
    const tone = cellTone(col, raw);
    // A status / type column pills every value; any other column pills only
    // a cell that holds a legacy status word (a tone), else plain text.
    if (kind === 'badge') return <Badge tone={tone ?? 'grey'}>{text}</Badge>;
    if (tone && kind === 'text') return <Badge tone={tone}>{text}</Badge>;
  }
  // ADR-190: one column opens the row's document. A real link, so ctrl-click
  // opens a new tab; it swallows the click so the row's own click does not
  // navigate the current tab as well.
  const linkId = rowLink && rowLink.column === col.key ? row[rowLink.idKey] : undefined;
  if (rowLink && linkId != null && linkId !== '') {
    return (
      <Link
        to={rowLink.route.replace('$id', String(linkId))}
        className="rpt-link"
        onClick={(e) => e.stopPropagation()}
      >
        {text}
      </Link>
    );
  }
  return text;
}

function cellClass(col: ReportColumn, kind: DataTableColumnKind): string | undefined {
  if (col.key === 'item_code') return 'mono fw-700 rpt-item-code';
  if (kind === 'code' || kind === 'date' || kind === 'num') return 'mono';
  return undefined;
}

export function buildReportColumns(input: ReportColumnsInput): DataTableColumn<ReportRow>[] {
  const { columns, numericKeys, rowLink, firstRowNo, totals } = input;
  const rowNo: DataTableColumn<ReportRow> = {
    id: ROW_NO_ID,
    header: <span data-rpt-col={ROW_NO_ID}>#</span>,
    label: '#',
    kind: 'num',
    align: 'right',
    className: 'mono rpt-rn',
    minWidth: ROW_NO_MIN_W,
    render: (_row, i) => firstRowNo + i,
  };
  return [
    rowNo,
    ...columns.map((col): DataTableColumn<ReportRow> => {
      const numeric = numericKeys.has(col.key);
      const kind = reportColumnKind(col, numeric);
      const total = totals.get(col.key);
      return {
        id: col.key,
        key: col.key,
        // The data attribute lets the grid read the engine's visible column
        // order back off the header (Total row + column filters).
        header: <span data-rpt-col={col.key}>{col.label}</span>,
        label: col.label,
        kind,
        align: numeric && kind === 'num' ? 'right' : 'left',
        className: cellClass(col, kind),
        sortField: col.key,
        ...(total !== undefined ? { minWidth: total.length * MONO_CHAR_W + CELL_PAD_W } : {}),
        title: (row) => cellText(col, row) ?? '',
        render: (row) => cellContent(col, kind, row, numeric, rowLink),
      };
    }),
  ];
}

/** Formatted totals per summable column key (see isSummable). */
export function formatTotals(
  columns: ReportColumn[],
  sums: ReadonlyMap<string, number>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of columns) {
    const t = sums.get(c.key);
    if (t !== undefined) out.set(c.key, formatNumber(t, isQtyColumn(c)));
  }
  return out;
}
