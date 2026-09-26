// The table inside the report grid (frappe-datatable look): sticky header,
// optional column-filter row, sticky "#" column, pinned totals row. Pure
// rendering — sort / filter / paging state lives in report-grid.tsx.
import type { ReportColumn, ReportRow, ReportRowLink } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Skeleton } from '@/ui/data/Skeleton';
import type { SortState } from '../lib/grid-model';
import { formatCell, formatNumber, isBlank, statusBadge } from '../lib/report-format';

const SKELETON_ROWS = 6;

export interface GridTableProps {
  columns: ReportColumn[];
  numericKeys: ReadonlySet<string>;
  rowLink: ReportRowLink | undefined;
  /** The rows of the current page. */
  rows: ReportRow[];
  /** Row number of rows[0] (1-based). */
  firstRowNo: number;
  totals: ReadonlyMap<string, number> | null;
  sort: SortState | null;
  onSort: (key: string) => void;
  showFilters: boolean;
  filterTerms: Readonly<Record<string, string>>;
  onFilter: (key: string, value: string) => void;
  /** First load — nothing to show yet. */
  skeleton: boolean;
  /** Replaces the body with a message (empty / error). */
  message: { text: string; error: boolean } | null;
}

export function GridTable(props: GridTableProps): React.JSX.Element {
  const { columns, numericKeys, rows, firstRowNo, totals, sort, showFilters } = props;
  const span = columns.length + 1;

  return (
    <table>
      <thead>
        <tr>
          <th className="rpt-rn" scope="col">
            #
          </th>
          {columns.map((col) => {
            const isNum = numericKeys.has(col.key);
            const dir = sort?.key === col.key ? sort.dir : null;
            return (
              <th
                key={col.key}
                scope="col"
                className={isNum ? 'is-num' : undefined}
                aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              >
                {/* A real button: Tab reaches it, Enter / Space sort. */}
                <button
                  type="button"
                  className="rpt-sort-btn"
                  title={`${col.label} — click to sort`}
                  onClick={() => props.onSort(col.key)}
                >
                  <span className="rpt-cell">{col.label}</span>
                  {dir ? <span className="rpt-sort">{dir === 'asc' ? '▲' : '▼'}</span> : null}
                </button>
              </th>
            );
          })}
        </tr>
        {showFilters ? (
          <tr className="rpt-grid-filters">
            <th className="rpt-rn" aria-hidden="true" />
            {columns.map((col) => (
              <th key={col.key}>
                <input
                  className="rpt-colfilter"
                  value={props.filterTerms[col.key] ?? ''}
                  placeholder={numericKeys.has(col.key) ? '>0, <10, =5' : 'contains'}
                  aria-label={`Filter ${col.label}`}
                  onChange={(e) => props.onFilter(col.key, e.target.value)}
                />
              </th>
            ))}
          </tr>
        ) : null}
      </thead>
      <tbody>
        {props.skeleton ? (
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <tr key={i}>
              <td className="rpt-rn" />
              {columns.map((col) => (
                <td key={col.key}>
                  <Skeleton width={i % 2 === 0 ? '80%' : '60%'} />
                </td>
              ))}
            </tr>
          ))
        ) : props.message ? (
          <tr>
            <td colSpan={span} className={`rpt-grid-msg${props.message.error ? ' is-error' : ''}`}>
              {props.message.text}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={firstRowNo + i}>
              <td className="rpt-rn">{firstRowNo + i}</td>
              {columns.map((col) => (
                <GridCell
                  key={col.key}
                  col={col}
                  row={row}
                  isNum={numericKeys.has(col.key)}
                  rowLink={props.rowLink}
                />
              ))}
            </tr>
          ))
        )}
      </tbody>
      {totals && !props.skeleton && !props.message ? (
        <tfoot>
          <tr>
            <td className="rpt-rn">Total</td>
            {columns.map((col) => {
              const t = totals.get(col.key);
              return (
                <td key={col.key} className={numericKeys.has(col.key) ? 'is-num' : undefined}>
                  <span className="rpt-cell">{t != null ? formatNumber(t) : ''}</span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function GridCell(props: {
  col: ReportColumn;
  row: ReportRow;
  isNum: boolean;
  rowLink: ReportRowLink | undefined;
}): React.JSX.Element {
  const { col, row, isNum, rowLink } = props;
  const raw = row[col.key];
  const text = formatCell(col, raw);
  const blank = isBlank(raw);
  const zero = isNum && !blank && Number(raw) === 0;
  const cls = [isNum ? 'is-num' : '', blank || zero ? 'is-muted' : ''].filter(Boolean).join(' ');

  const tone = typeof raw === 'string' ? statusBadge(raw) : undefined;
  // ADR-190: a report may name one column that opens its document; the id sits
  // under `idKey` on the row and is never shown as a column itself.
  const linkId = rowLink && rowLink.column === col.key ? row[rowLink.idKey] : undefined;

  let content: React.ReactNode = text;
  if (tone) {
    content = <span className={`rpt-pill tone-${tone}`}>{text}</span>;
  } else if (rowLink && linkId != null && linkId !== '') {
    content = (
      <Link to={rowLink.route.replace('$id', String(linkId))} className="rpt-link">
        {text}
      </Link>
    );
  }
  return (
    <td className={cls || undefined} title={blank ? undefined : text}>
      {/* The clip lives on this block: an auto-layout table ignores a td's
          own max-width, so the ellipsis has to come from inside the cell. */}
      <span className="rpt-cell">{content}</span>
    </td>
  );
}
