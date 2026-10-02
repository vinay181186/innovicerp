// Daily Production Report — mirrors legacy renderDailyReport (HTML L10823).
//
// 25 rows per page (ADR-201): the server sends one page of the day's log
// entries, grouped by machine inside the page; the KPI strip and every machine
// group's Completed total are whole-day figures from the server. Both prints
// fetch the WHOLE day (fetchFullDailyReport), never just the page.

import type { DailyReportResponse, DailyReportRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { fmtDate, todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter } from '@/ui/layout';
import { DataTable, StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useMachinesList } from '../../machines/api';
import { useMyCompany } from '../../settings/api';
import { dailyGroupKey, fetchFullDailyReport, useDailyReport } from '../api';
import { DAILY_REPORT_HIDDEN, dailyReportColumnsFor } from '../components/daily-report-columns';
import { printDailyReport } from '../lib/print-daily-report';

const searchSchema = z.object({
  date: z.string().optional(),
  machineId: z.string().optional(),
  page: pageSearchParam,
});

export const dailyReportRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'daily-report',
  validateSearch: searchSchema,
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
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.page),
  });
  const total = data?.total;

  const setPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, total, setPage);

  // Prints read the WHOLE day, fetched page by page.
  const [printing, setPrinting] = useState(false);
  const loadFullDay = async (): Promise<DailyReportResponse | null> => {
    setPrinting(true);
    try {
      return await fetchFullDailyReport({ date, machineId: machineId || undefined });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not load the report to print.');
      return null;
    } finally {
      setPrinting(false);
    }
  };

  const machineLabel = machineId
    ? (() => {
        const m = (machinesData?.machines ?? []).find((x) => x.id === machineId);
        return m ? `${m.code} — ${m.name}` : 'Selected Machine';
      })()
    : 'All Machines';

  const onPrint = async (): Promise<void> => {
    const full = await loadFullDay();
    if (!full) return;
    if (!printDailyReport({ report: full, machineLabel, company })) {
      window.alert('Allow popups to print.');
    }
  };

  // Per-machine 🖨 (legacy L10882). Legacy re-derives the report from the
  // machine's logs alone, so the summary tiles count that machine only — not
  // the page-level totals.
  const onPrintMachine = async (
    pageGroup: DailyReportResponse['groups'][number],
  ): Promise<void> => {
    const full = await loadFullDay();
    if (!full) return;
    const g = full.groups.find((x) => dailyGroupKey(x) === dailyGroupKey(pageGroup));
    if (!g) return;
    const scoped: DailyReportResponse = {
      ...full,
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
    void navigate({ search: (prev) => ({ ...prev, date: next || undefined, page: 1 }) });
  };
  const setMachine = (next: string): void => {
    void navigate({ search: (prev) => ({ ...prev, machineId: next || undefined, page: 1 }) });
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
          onClick={() => void onPrint()}
          disabled={!data || data.groups.length === 0 || printing}
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
                  onClick={() => void onPrintMachine(g)}
                  disabled={printing}
                  title={`Print report for ${g.machineCode}`}
                >
                  🖨
                </button>
              </div>
            </div>
            {/* One fit table per machine group on this page. The Completed
                total is the group's WHOLE-day total from the server (a page may
                hold only part of a machine's rows). POL, Item Name and Remarks
                live in each row's ▸ detail. */}
            <DataTable<DailyReportRow>
              tableKey={TABLE_KEYS.dailyReport}
              columns={dailyReportColumnsFor(g.totalQty)}
              rows={g.rows}
              rowKey={(r) => r.logId}
              defaultHidden={DAILY_REPORT_HIDDEN}
              showTotals
              totalsLabel="Total"
            />
          </div>
        ))
      )}
      <ListFooter
        total={total ?? 0}
        noun="log entry"
        nounPlural="log entries"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={setPage}
      />
    </ReportShell>
  );
}
