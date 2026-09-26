// Daily Production Report — mirrors legacy renderDailyReport (HTML L10823).

import type { DailyReportResponse } from '@innovic/shared';
import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell, reportTotalRowStyle } from '@/ui/data/ReportShell';
import { useMachinesList } from '../../machines/api';
import { useMyCompany } from '../../settings/api';
import { useDailyReport } from '../api';
import { printDailyReport } from '../lib/print-daily-report';

const searchSchema = z.object({
  date: z.string().optional(),
  machineId: z.string().optional(),
});

export const dailyReportRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'daily-report',
  validateSearch: (search) => searchSchema.parse(search),
  component: DailyReportPage,
});

function DailyReportPage(): React.JSX.Element {
  const search = dailyReportRoute.useSearch();
  const navigate = dailyReportRoute.useNavigate();
  // IST today, not the UTC date: before 05:30 IST the UTC date is yesterday.
  const date = search.date ?? todayIst();
  const machineId = search.machineId ?? '';

  const { data: machinesData } = useMachinesList({
    limit: 200,
    offset: 0,
  });
  const { data: company } = useMyCompany();

  const { data, isLoading, isError, error } = useDailyReport({
    date,
    machineId: machineId || undefined,
  });

  const machineLabel = machineId
    ? (() => {
        const m = (machinesData?.machines ?? []).find((x) => x.id === machineId);
        return m ? `${m.code} — ${m.name}` : 'Selected Machine';
      })()
    : 'All Machines';

  const onPrint = (): void => {
    if (!data) return;
    if (!printDailyReport({ report: data, machineLabel, company })) {
      window.alert('Allow popups to print.');
    }
  };

  // Per-machine 🖨 (legacy L10882). Legacy re-derives the report from the
  // machine's logs alone, so the summary tiles count that machine only — not
  // the page-level totals.
  const onPrintMachine = (g: DailyReportResponse['groups'][number]): void => {
    if (!data) return;
    const scoped: DailyReportResponse = {
      ...data,
      groups: [g],
      summary: {
        totalPieces: g.totalQty,
        logEntries: g.rows.length,
        machinesActive: 1,
        jcsActive: new Set(g.rows.map((r) => r.jcCode)).size,
      },
    };
    if (!printDailyReport({ report: scoped, machineLabel: g.machineCode, company })) {
      window.alert('Allow popups to print.');
    }
  };

  const setDate = (next: string): void => {
    void navigate({ search: (prev) => ({ ...prev, date: next || undefined }) });
  };
  const setMachine = (next: string): void => {
    void navigate({ search: (prev) => ({ ...prev, machineId: next || undefined }) });
  };

  const summary = data?.summary ?? {
    totalPieces: 0,
    logEntries: 0,
    machinesActive: 0,
    jcsActive: 0,
  };

  return (
    <ReportShell
      title="Daily Production Report"
      actions={
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onPrint}
          disabled={!data || data.groups.length === 0}
          title="Print daily production report"
        >
          🖨 Print Full Report
        </button>
      }
      filters={
        <>
          <ReportFilter label="Report Date" htmlFor="dr-date">
            <input
              id="dr-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </ReportFilter>
          <ReportFilter label="Machine" htmlFor="dr-machine" size="lg">
            <select
              id="dr-machine"
              className="innovic-select"
              value={machineId}
              onChange={(e) => setMachine(e.target.value)}
            >
              <option value="">All Machines</option>
              {(machinesData?.machines ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </ReportFilter>
        </>
      }
      kpis={
        <StatStrip
          items={[
            {
              key: 'pieces',
              label: 'Total Pieces',
              count: summary.totalPieces,
              color: 'var(--green)',
              sub: fmtDate(date),
            },
            { key: 'logs', label: 'Log Entries', count: summary.logEntries },
            {
              key: 'machines',
              label: 'Machines Active',
              count: summary.machinesActive,
              color: 'var(--cyan)',
            },
            {
              key: 'jcs',
              label: 'Job Cards Active',
              count: summary.jcsActive,
              color: 'var(--amber)',
            },
          ]}
        />
      }
    >
      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3">
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load daily report. Try again.'}
            </div>
          </div>
        </div>
      ) : !data || data.groups.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 56 }}>
            <b>No production entries for {fmtDate(date)}.</b>
          </div>
        </div>
      ) : (
        data.groups.map((g) => (
          <div key={g.machineId ?? g.machineCode} className="panel" style={{ marginBottom: 14 }}>
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="mono fw-700" style={{ fontSize: 'var(--fs-md)' }}>
                  {g.machineCode}
                </span>
                <span className="text2">{g.machineName ?? ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontWeight: 700,
                    color: 'var(--green2)',
                    fontSize: 'var(--fs-md)',
                  }}
                >
                  {g.totalQty} pcs
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onPrintMachine(g)}
                  title={`Print report for ${g.machineCode}`}
                >
                  🖨
                </button>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>JC No.</th>
                    {/* POL — the line number printed on the CUSTOMER's own
                        purchase order, immediately before the item code. */}
                    <th style={{ color: 'var(--purple)' }}>POL</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Op</th>
                    <th>Operation</th>
                    <th>Shift</th>
                    <th className="th-num" style={{ color: 'var(--green2)' }}>
                      Completed
                    </th>
                    <th>Operator</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.logId}>
                      <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                        {r.jcCode}
                      </td>
                      {/* POL — '—' when no sales order sits behind the card. */}
                      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                        {r.clientPoLineNo ?? '—'}
                      </td>
                      <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(r.itemCode, r.itemRevision)}
                      </td>
                      <td>{r.itemName ?? '—'}</td>
                      <td className="mono">Op {opSrNo(r.opSeq)}</td>
                      <td>{r.operation}</td>
                      <td>
                        <span className="badge b-grey">
                          {SHIFT_LABELS[r.shift as Shift] ?? r.shift}
                        </span>
                      </td>
                      <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
                        {r.qty}
                      </td>
                      <td>{r.operator ?? '—'}</td>
                      <td className="text3">{r.remarks ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Machine total — the server's own per-machine figure. */}
                <tfoot>
                  <tr style={reportTotalRowStyle}>
                    <td colSpan={7} style={{ color: 'var(--text2)' }}>
                      Total ({g.rows.length} entries)
                    </td>
                    <td className="td-num mono" style={{ color: 'var(--green2)' }}>
                      {g.totalQty}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
    </ReportShell>
  );
}
