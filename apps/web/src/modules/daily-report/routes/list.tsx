// Daily Production Report — mirrors legacy renderDailyReport (HTML L10823).

import type { DailyReportResponse } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachinesList } from '../../machines/api';
import { useMyCompany } from '../../settings/api';
import { useDailyReport } from '../api';
import { printDailyReport } from '../lib/print-daily-report';

const searchSchema = z.object({
  date: z.string().optional(),
  machineId: z.string().optional(),
});

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const dailyReportRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'daily-report',
  validateSearch: (search) => searchSchema.parse(search),
  component: DailyReportPage,
});

function DailyReportPage(): React.JSX.Element {
  const search = dailyReportRoute.useSearch();
  const navigate = dailyReportRoute.useNavigate();
  const date = search.date ?? todayStr();
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
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📊 Daily Production Report</div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onPrint}
          disabled={!data || data.groups.length === 0}
          title="Print daily production report"
        >
          🖨 Print Full Report
        </button>
      </div>

      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
            >
              Date
            </div>
            <input
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ fontSize: 12 }}
            />
          </div>
          <div>
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
            >
              Machine
            </div>
            <select
              className="innovic-select"
              value={machineId}
              onChange={(e) => setMachine(e.target.value)}
              style={{ fontSize: 12, minWidth: 240 }}
            >
              <option value="">All Machines</option>
              {(machinesData?.machines ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Tip: Select a machine for per-machine report. Each machine panel has its own 🖨 print
            button.
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <KpiTile label="Total Pieces" value={summary.totalPieces} color="var(--green)" sub={date} />
        <KpiTile label="Log Entries" value={summary.logEntries} color="var(--text)" />
        <KpiTile label="Machines Active" value={summary.machinesActive} color="var(--cyan)" />
        <KpiTile label="Job Cards Active" value={summary.jcsActive} color="var(--amber)" />
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        </div>
      ) : !data || data.groups.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 56 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
            <b>No production entries for {date}</b>
            <br />
            <span className="text3" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
              Log completions via Op Entry to see them here
            </span>
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
                <span className="mono fw-700" style={{ fontSize: 15 }}>
                  {g.machineCode}
                </span>
                <span className="text2" style={{ fontSize: 12 }}>
                  {g.machineName ?? ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontWeight: 700,
                    color: 'var(--green)',
                    fontSize: 15,
                  }}
                >
                  {g.totalQty} pcs
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onPrintMachine(g)}
                  title={`Print report for ${g.machineCode}`}
                  style={{ fontSize: 11 }}
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
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th className="td-ctr">Op</th>
                    <th>Operation</th>
                    <th className="td-ctr">Shift</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>
                      Qty Produced
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
                      <td className="mono" style={{ color: 'var(--purple)' }}>
                        {r.itemCode ?? '—'}
                      </td>
                      <td>{r.itemName ?? '—'}</td>
                      <td className="td-ctr mono">{r.opSeq}</td>
                      <td>{r.operation}</td>
                      <td className="td-ctr">
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontSize: 10,
                            fontWeight: 700,
                            background: 'var(--bg4)',
                            color: 'var(--text2)',
                          }}
                        >
                          {r.shift}
                        </span>
                      </td>
                      <td
                        className="td-ctr mono fw-700"
                        style={{ fontSize: 15, color: 'var(--green)' }}
                      >
                        {r.qty}
                      </td>
                      <td>{r.operator ?? '—'}</td>
                      <td className="text3" style={{ fontSize: 11 }}>
                        {r.remarks ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: number;
  color: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 800, color }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>
      ) : null}
    </div>
  );
}
