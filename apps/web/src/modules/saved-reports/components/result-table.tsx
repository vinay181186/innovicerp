// Renders the result of a run / preview: optional summary table, then the row
// table with CSV / Excel export. Shared by the run route and the builder live
// preview. House panel + innovic-table look (was shadcn Card + Table).

import type { AdHocColumn, RunAdHocResponse } from '@innovic/shared';
import { Download, Loader2 } from 'lucide-react';
import { fmtDate, fmtDateTime } from '@/lib/date';
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
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-hdr">
            <span className="panel-title">
              Summary
              <span className="text3" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
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
                  <th className="td-right">Count</th>
                  {summaryColLabel ? (
                    <th className="td-right">
                      {fnLabel(data.summaryFunction)} of {summaryColLabel}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.summary.map((row, i) => (
                  <tr key={`${row.group}-${i}`}>
                    <td className="fw-700">{row.group}</td>
                    <td className="td-right mono">{row.count.toLocaleString('en-IN')}</td>
                    {summaryColLabel ? (
                      <td className="td-right mono">
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
            <span className="text3" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
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
            >
              <Download size={13} /> Export CSV
            </button>
            {onExcel ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onExcel}
                disabled={!data || data.rowCount === 0 || excelLoading}
              >
                {excelLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
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
                  <th key={col.key} className={col.type === 'number' ? 'td-right' : ''}>
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
                      <td key={col.key} className={col.type === 'number' ? 'td-right mono' : ''}>
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
