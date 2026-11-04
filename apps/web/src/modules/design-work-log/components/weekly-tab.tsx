// Design Work Log — Weekly View tab (ADR-203 frozen header). Chrome: the week
// navigator. The engineers × days grid (with its TOTAL row) is the one fit
// table of the tab; the seven day columns are generated from the week, with ids
// seeded off the weekday so a saved layout survives moving to another week.

import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { DataTable, Panel, dynamicColumns, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { useDesignWorkLogList } from '../api';
import {
  addDays,
  dayName,
  localYmd,
  todayStr,
  useReportCount,
  type TabListProps,
} from './work-log-shared';

interface WeekRow {
  engineer: string;
  hrsByDate: Record<string, number>;
  total: number;
}

function sumHours(rows: WeekRow[], hoursOf: (r: WeekRow) => number): number {
  return rows.reduce((s, r) => s + hoursOf(r), 0);
}

function buildColumns(weekDates: string[]): DataTableColumn<WeekRow>[] {
  return [
    {
      id: 'engineer',
      header: 'Design Engineer',
      kind: 'text',
      className: 'fw-700',
      filterValue: (r) => r.engineer,
      render: (r) => <span style={{ fontSize: 12 }}>{r.engineer}</span>,
    },
    ...dynamicColumns<string, WeekRow>('day', weekDates, (dt) => ({
      idSeed: dayName(dt),
      label: dayName(dt),
      header: (
        <span style={{ fontSize: 11 }}>
          {dayName(dt)}
          <br />
          {fmtDate(dt)}
        </span>
      ),
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (r) => r.hrsByDate[dt] ?? 0,
      total: (rows) => sumHours(rows, (r) => r.hrsByDate[dt] ?? 0).toFixed(1),
      render: (r) => {
        const hrs = r.hrsByDate[dt] ?? 0;
        return (
          <span style={{ color: hrs >= 7 ? 'var(--green)' : hrs > 0 ? undefined : 'var(--text3)' }}>
            {hrs > 0 ? hrs.toFixed(1) : '0'}
          </span>
        );
      },
    })),
    {
      id: 'total',
      header: 'Total',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (r) => r.total,
      total: (rows) => (
        <span style={{ color: 'var(--blue)' }}>{sumHours(rows, (r) => r.total).toFixed(1)}h</span>
      ),
      render: (r) => (
        <span
          style={{
            color: r.total >= 30 ? 'var(--green)' : r.total >= 20 ? 'var(--amber)' : 'var(--red)',
          }}
        >
          {r.total.toFixed(1)}h
        </span>
      ),
    },
  ];
}

export function WeeklyTab({ term, onCount }: TabListProps): React.JSX.Element {
  const [refDate, setRefDate] = useState(todayStr());
  const weekDates = useMemo(() => {
    const d = new Date(refDate + 'T00:00:00');
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(mon);
      dd.setDate(mon.getDate() + i);
      out.push(localYmd(dd));
    }
    return out;
  }, [refDate]);

  const { data, isLoading } = useDesignWorkLogList({
    fromDate: weekDates[0],
    toDate: weekDates[6],
    limit: 2000,
    offset: 0,
  });
  const logs = useMemo(() => data?.items ?? [], [data?.items]);

  const rows = useMemo((): WeekRow[] => {
    const engineers = Array.from(new Set(logs.map((l) => l.engineerText))).sort();
    return engineers.map((engineer) => {
      const hrsByDate: Record<string, number> = {};
      for (const dt of weekDates) {
        hrsByDate[dt] = logs
          .filter((l) => l.engineerText === engineer && l.logDate === dt)
          .reduce((s, l) => s + l.hours, 0);
      }
      const total = Object.values(hrsByDate).reduce((s, h) => s + h, 0);
      return { engineer, hrsByDate, total };
    });
  }, [logs, weekDates]);
  const columns = useMemo(() => buildColumns(weekDates), [weekDates]);
  const shownRows = rows.filter((r) => matchesSearchTerm([r.engineer], term));
  useReportCount(onCount, isLoading ? undefined : shownRows.length);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 'var(--panel-gap)',
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, -7))}
        >
          ←
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {fmtDate(weekDates[0])} — {fmtDate(weekDates[6])}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, 7))}
        >
          →
        </button>
      </div>

      <Panel fill bodyPadding="none">
        <DataTable<WeekRow>
          tableKey={TABLE_KEYS.designWorkLogWeekly}
          columns={columns}
          rows={shownRows}
          rowKey={(r) => r.engineer}
          loading={isLoading}
          emptyText={term.trim() ? 'No Design Engineers match.' : 'No Design Engineers yet.'}
          showTotals
          totalsLabel={<span style={{ color: 'var(--blue)' }}>TOTAL</span>}
        />
      </Panel>
      <ListFooter total={rows.length} shown={shownRows.length} noun="Design Engineer" />
    </>
  );
}
