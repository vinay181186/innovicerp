// Renders the result of a run / preview: optional summary table, then the row
// table with CSV / Excel export. Shared by the run route and the builder live
// preview. House panel + innovic-table look (was shadcn Card + Table).

import { Icon } from '@/ui/core';
import {
  columnAlign,
  isMoneyHeading,
  type AdHocColumn,
  type RunAdHocResponse,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { alignSuffix } from '@/ui/data/data-table-head';
import { downloadCsv, rowsToCsv } from '../lib/csv';

interface Props {
  data: RunAdHocResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string | undefined;
  filenamePrefix: string;
  /** Optional Excel-export trigger. When provided, an "Export Excel"
   *  button renders next to "Export CSV"; the parent owns the API call
   *  (saved-report id vs preview spec) and the loading state. */
  onExcel?: (() => void) | undefined;
  excelLoading?: boolean | undefined;
}

/** SUM → Sum. The function code stays what the API sends. */
function fnLabel(fn: string | null): string {
  return fn ? fn.charAt(0) + fn.slice(1).toLowerCase() : '';
}

export function ResultTable({
  data,
  isLoading,
  isError,
  errorMessage,
  filenamePrefix,
  onExcel,
  excelLoading,
}: Props): JSX.Element {
  const onCsv = () => {
    if (!data) return;
    const csv = rowsToCsv(data.columns, data.rows);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    downloadCsv(`${filenamePrefix}-${stamp}.csv`, csv);
  };

  // The summary column is a field key; show its label when the run carries it.
  const summaryColLabel = data?.summaryColumn
    ? (data.columns.find((c) => c.key === data.summaryColumn)?.label ?? data.summaryColumn)
    : null;
  const colSpan = Math.max(1, data?.columns.length ?? 1);

  return (
    <div>
      {data && data.summary.length > 0 ? (
        <div className="panel" style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="panel-hdr">
            <span className="panel-title">
              Summary
              <span
                className="text3"
                style={{ fontSize: 'var(--fs-xs)', fontWeight: 400, marginLeft: 'var(--sp-2)' }}
              >
                Count per group
                {summaryColLabel ? ` + ${fnLabel(data.summaryFunction)} of ${summaryColLabel}` : ''}
              </span>
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="th-num">Count</th>
                  {summaryColLabel ? (
                    <th className={isMoneyHeading(summaryColLabel) ? 'th-money' : 'th-num'}>
                      {fnLabel(data.summaryFunction)} of {summaryColLabel}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.summary.map((row, i) => (
                  <tr key={`${row.group}-${i}`}>
                    <td className="fw-700">{row.group}</td>
                    <td className="td-num mono">{row.count.toLocaleString('en-IN')}</td>
                    {summaryColLabel ? (
                      <td
                        className={`${isMoneyHeading(summaryColLabel) ? 'td-money' : 'td-num'} mono`}
                      >
                        {row.aggregate ? Number(row.aggregate).toLocaleString('en-IN') : '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            Results
            <span
              className="text3"
              style={{ fontSize: 'var(--fs-xs)', fontWeight: 400, marginLeft: 'var(--sp-2)' }}
            >
              {data
                ? `${data.rowCount} rows · refreshed ${fmtDateTime(data.generatedAt)}`
                : 'No results yet.'}
            </span>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCsv}
              disabled={!data || data.rowCount === 0}
              title={!data || data.rowCount === 0 ? 'No rows to export' : undefined}
            >
              <Icon name="download" size={13} /> Export CSV
            </button>
            {onExcel ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onExcel}
                disabled={!data || data.rowCount === 0 || excelLoading}
                title={!data || data.rowCount === 0 ? 'No rows to export' : undefined}
              >
                {excelLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Icon name="download" size={13} />
                )}{' '}
                Export Excel
              </button>
            ) : null}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                {(data?.columns ?? []).map((col) => (
                  <th key={col.key} className={colAlignClass(col, 'th')}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Running…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state" style={{ color: 'var(--red2)' }}>
                    {errorMessage ?? 'Could not run report. Try again.'}
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state">
                    No rows match.
                  </td>
                </tr>
              ) : (
                data.rows.map((row, i) => (
                  <tr key={i}>
                    {data.columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${colAlignClass(col, 'td')}${col.type === 'number' ? ' mono' : ''}`}
                      >
                        {renderCell(col, row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** ADR-280: money right, other numbers centre, dates centre, text left. A report
 *  column only says "number", so its heading decides whether it is money. */
function colAlignClass(col: AdHocColumn, part: 'th' | 'td'): string {
  const numeric = col.type === 'number';
  const fixed = col.type === 'date' || col.type === 'datetime';
  return `${part}-${alignSuffix(columnAlign({ heading: col.label, numeric, fixed }), numeric)}`;
}

function renderCell(col: AdHocColumn, raw: unknown): JSX.Element {
  if (raw === null || raw === undefined) {
    return <span className="text3">—</span>;
  }
  if (col.type === 'number') {
    return <span>{Number(raw).toLocaleString('en-IN')}</span>;
  }
  if ((col.type === 'date' || col.type === 'datetime') && typeof raw === 'string') {
    return <span>{col.type === 'date' ? fmtDate(raw) : fmtDateTime(raw)}</span>;
  }
  return <span>{String(raw)}</span>;
}
