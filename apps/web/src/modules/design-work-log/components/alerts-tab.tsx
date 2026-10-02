// Design Work Log — Alerts tab (ADR-203 frozen header). Chrome: the
// Unlogged Days / Low Hours StatStrip and a small TabStrip "Unlogged Days (n) |
// Low Hours (n) | Utilization" (sub-tab in the URL `alert`). Each sub-tab is ONE
// filled table — the three stacked tables of before. Every figure is worked out
// exactly as before over the last 10 working days (Mon–Fri, back from today).

import type { DesignWorkLogEntry } from '@innovic/shared';
import { useMemo } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { fmtDate } from '@/lib/date';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TabStrip } from '@/ui/navigation/TabStrip';
import { useDesignWorkLogList } from '../api';
import { dayName, localYmd, todayStr } from './work-log-shared';

export const ALERT_TABS = ['unlogged', 'low', 'util'] as const;
export type AlertTab = (typeof ALERT_TABS)[number];

interface DayRow {
  date: string;
  engineer: string;
  hours: number;
}
interface UtilRow {
  engineer: string;
  days: number;
  missing: number;
  hours: number;
  util: number;
}

const DATE_COLS: DataTableColumn<DayRow>[] = [
  {
    id: 'log_date',
    header: 'Log Date',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (u) => fmtDate(u.date),
  },
  { id: 'day', header: 'Day', nowrap: true, render: (u) => dayName(u.date) },
  {
    id: 'engineer',
    header: 'Design Engineer',
    kind: 'text',
    align: 'left',
    className: 'fw-700',
    render: (u) => u.engineer,
  },
];

const LOW_COLS: DataTableColumn<DayRow>[] = [
  ...DATE_COLS,
  {
    id: 'hours',
    header: 'Hours',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (u) => <span style={{ color: 'var(--amber2)' }}>{u.hours.toFixed(1)}h</span>,
  },
];

const UTIL_COLS: DataTableColumn<UtilRow>[] = [
  {
    id: 'engineer',
    header: 'Design Engineer',
    kind: 'text',
    align: 'left',
    className: 'fw-700',
    render: (u) => u.engineer,
  },
  {
    id: 'logged',
    header: 'Logged',
    className: 'mono',
    nowrap: true,
    render: (u) => `${u.days}/10`,
  },
  {
    id: 'missing',
    header: 'Missing',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (u) => (
      <span style={{ color: u.missing > 2 ? 'var(--red)' : undefined }}>{u.missing}</span>
    ),
  },
  {
    id: 'hours',
    header: 'Hours',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (u) => `${u.hours.toFixed(1)}h`,
  },
  {
    id: 'avg',
    header: 'Avg',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (u) => `${u.days ? (u.hours / u.days).toFixed(1) : '0'}h`,
  },
  {
    id: 'util',
    header: '%',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (u) => (
      <span
        style={{
          color: u.util >= 75 ? 'var(--green)' : u.util >= 50 ? 'var(--amber)' : 'var(--red)',
        }}
      >
        {u.util}%
      </span>
    ),
  },
];

function hoursOn(logs: DesignWorkLogEntry[], date: string, eng: string): number {
  return logs
    .filter((l) => l.logDate === date && l.engineerText === eng)
    .reduce((s, l) => s + l.hours, 0);
}

export function AlertsTab({
  sub,
  onSub,
}: {
  sub: AlertTab;
  onSub: (k: AlertTab) => void;
}): React.JSX.Element {
  // Last 10 working days (skip Sat/Sun) starting from today, going back
  const checkDays = useMemo(() => {
    const out: string[] = [];
    const d = new Date(todayStr() + 'T00:00:00');
    while (out.length < 10) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) out.push(localYmd(d));
      d.setDate(d.getDate() - 1);
    }
    return out;
  }, []);

  const oldest = checkDays[checkDays.length - 1] ?? todayStr();
  const newest = checkDays[0] ?? todayStr();
  const { data, isLoading } = useDesignWorkLogList({
    fromDate: oldest,
    toDate: newest,
    limit: 2000,
    offset: 0,
  });

  const { unlogged, lowHours, utilisation } = useMemo(() => {
    const logs = data?.items ?? [];
    const engineers = Array.from(new Set(logs.map((l) => l.engineerText))).sort();
    const un: DayRow[] = [];
    const low: DayRow[] = [];
    checkDays.forEach((date) => {
      engineers.forEach((eng) => {
        const hrs = hoursOn(logs, date, eng);
        if (hrs === 0) un.push({ date, engineer: eng, hours: 0 });
        else if (hrs < 4) low.push({ date, engineer: eng, hours: hrs });
      });
    });
    const util: UtilRow[] = engineers.map((eng) => {
      const dl = checkDays.filter((dt) =>
        logs.some((l) => l.logDate === dt && l.engineerText === eng),
      ).length;
      const th = checkDays.reduce((s, dt) => s + hoursOn(logs, dt, eng), 0);
      const up = Math.round((th / (10 * 8)) * 100);
      return { engineer: eng, days: dl, missing: 10 - dl, hours: th, util: up };
    });
    return { unlogged: un, lowHours: low, utilisation: util };
  }, [data?.items, checkDays]);

  return (
    <>
      <div style={{ marginBottom: 'var(--panel-gap)' }}>
        <StatStrip
          items={[
            {
              key: 'unlogged',
              label: 'Unlogged Days',
              count: unlogged.length,
              color: 'var(--red2)',
            },
            { key: 'low', label: 'Low Hours', count: lowHours.length, color: 'var(--amber2)' },
          ]}
        />
      </div>

      <TabStrip
        label="Alerts views"
        activeKey={sub}
        onChange={(k) => onSub(ALERT_TABS.find((t) => t === k) ?? 'unlogged')}
        tabs={[
          { key: 'unlogged', label: 'Unlogged Days', count: isLoading ? null : unlogged.length },
          { key: 'low', label: 'Low Hours (<4h)', count: isLoading ? null : lowHours.length },
          { key: 'util', label: 'Utilization', note: '(Last 10 Working Days)' },
        ]}
      />

      <Panel fill bodyPadding="none">
        {sub === 'unlogged' ? (
          // Own `key` per sub-tab: each table is a fresh instance, so one
          // tab's sort / filter never carries over to the next.
          <DataTable<DayRow>
            key="unlogged"
            columns={DATE_COLS}
            // The list has always shown the first 30 (the count is the full one).
            rows={unlogged.slice(0, 30)}
            rowKey={(u) => `${u.date}:${u.engineer}`}
            loading={isLoading}
            emptyText="No unlogged working days."
          />
        ) : sub === 'low' ? (
          <DataTable<DayRow>
            key="low"
            columns={LOW_COLS}
            rows={lowHours}
            rowKey={(u) => `${u.date}:${u.engineer}`}
            loading={isLoading}
            emptyText="No low-hour days."
          />
        ) : (
          <DataTable<UtilRow>
            key="util"
            columns={UTIL_COLS}
            rows={utilisation}
            rowKey={(u) => u.engineer}
            loading={isLoading}
            emptyText="No work logged in the last 10 working days."
          />
        )}
      </Panel>
    </>
  );
}
