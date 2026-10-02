// Design Work Log — Daily View tab (ADR-203 frozen header). Chrome: the date
// navigator + engineer picker and the engineer hour tiles (+ Total). The day's
// entries — formerly one block of cards per engineer — are ONE filled table
// with a group heading per Design Engineer carrying that engineer's hours
// (≥ 6 h green, else amber, as before).

import type { DesignWorkLogEntry } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { useDesignWorkLogList } from '../api';
import { addDays, CategoryText, dayName, todayStr, TrackerBadge } from './work-log-shared';

const COLUMNS: DataTableColumn<DesignWorkLogEntry>[] = [
  {
    id: 'project',
    header: 'Project',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (l) => l.projectName ?? '',
    title: (l) => l.projectName ?? '',
  },
  {
    id: 'task',
    header: 'Task',
    kind: 'text',
    align: 'left',
    render: (l) => (
      <b>
        {l.taskText ?? 'General'}
        <TrackerBadge designTrackerId={l.designTrackerId} />
      </b>
    ),
  },
  {
    id: 'category',
    header: 'Category',
    kind: 'text',
    align: 'left',
    nowrap: true,
    render: (l) => <CategoryText category={l.category} />,
  },
  {
    id: 'hours',
    header: 'Hours',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (l) => `${l.hours}h`,
  },
  {
    id: 'description',
    header: 'Description',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (l) => <span className="text3">{l.description ?? ''}</span>,
    title: (l) => l.description ?? '',
  },
];

export function DailyTab(): React.JSX.Element {
  const [viewDate, setViewDate] = useState(todayStr());
  const [viewEng, setViewEng] = useState<string>('All');
  const { data, isLoading } = useDesignWorkLogList({
    fromDate: viewDate,
    toDate: viewDate,
    limit: 500,
    offset: 0,
  });
  const allDayLogs = useMemo(() => data?.items ?? [], [data?.items]);

  // Legacy L7994-7997: the engineer cards always show that engineer's full day,
  // while the entry list and the Total tile follow the selected engineer.
  const logs =
    viewEng === 'All' ? allDayLogs : allDayLogs.filter((l) => l.engineerText === viewEng);
  const totalHrs = logs.reduce((s, l) => s + l.hours, 0);

  const engineers = useMemo(() => {
    const s = new Set<string>();
    allDayLogs.forEach((l) => s.add(l.engineerText));
    return Array.from(s).sort();
  }, [allDayLogs]);

  // Group by engineer (first-seen order, as the cards were), flattened for the
  // one table; each engineer's hours for the heading.
  const { rows, engHrs } = useMemo(() => {
    const byEng: Record<string, DesignWorkLogEntry[]> = {};
    logs.forEach((l) => {
      if (!byEng[l.engineerText]) byEng[l.engineerText] = [];
      byEng[l.engineerText]!.push(l);
    });
    const totals = new Map<string, number>();
    for (const [eng, entries] of Object.entries(byEng)) {
      totals.set(
        eng,
        entries.reduce((s, l) => s + l.hours, 0),
      );
    }
    return { rows: Object.values(byEng).flat(), engHrs: totals };
  }, [logs]);

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
          onClick={() => setViewDate(addDays(viewDate, -1))}
        >
          ←
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 160, textAlign: 'center' }}>
          {fmtDate(viewDate)} ({dayName(viewDate)})
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setViewDate(addDays(viewDate, 1))}
        >
          →
        </button>
        <div style={{ flex: 1 }} />
        <input
          type="date"
          className="innovic-input"
          value={viewDate}
          onChange={(e) => setViewDate(e.target.value)}
        />
        <select
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
          }}
          value={viewEng}
          onChange={(e) => setViewEng(e.target.value)}
        >
          <option value="All">All Design Engineers</option>
          {engineers.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
          marginBottom: 'var(--panel-gap)',
        }}
      >
        {engineers.map((eng) => {
          const hrs = allDayLogs
            .filter((l) => l.engineerText === eng)
            .reduce((s, l) => s + l.hours, 0);
          return (
            <div
              key={eng}
              className="panel"
              style={{
                textAlign: 'center',
                padding: 10,
                marginBottom: 0,
                cursor: 'pointer',
                border: `1px solid ${viewEng === eng ? 'var(--blue)' : 'var(--border)'}`,
              }}
              onClick={() => setViewEng(viewEng === eng ? 'All' : eng)}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  color: hrs >= 6 ? 'var(--green)' : hrs > 0 ? 'var(--amber)' : 'var(--red)',
                }}
              >
                {hrs.toFixed(1)}h
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{eng}</div>
            </div>
          );
        })}
        <div className="panel" style={{ textAlign: 'center', padding: 10, marginBottom: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              color: 'var(--blue)',
            }}
          >
            {totalHrs.toFixed(1)}h
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total</div>
        </div>
      </div>

      <Panel fill bodyPadding="none">
        <DataTable<DesignWorkLogEntry>
          columns={COLUMNS}
          rows={rows}
          rowKey={(l) => l.id}
          loading={isLoading}
          emptyText="No entries yet."
          frozen
          groupRow={(l, _i, prev) => {
            if (prev && prev.engineerText === l.engineerText) return null;
            const et = engHrs.get(l.engineerText) ?? 0;
            return (
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <span>👤 {l.engineerText}</span>
                <span>·</span>
                <span
                  className="mono fw-700"
                  style={{ color: et >= 6 ? 'var(--green)' : 'var(--amber)' }}
                >
                  {et.toFixed(1)}h
                </span>
              </span>
            );
          }}
        />
      </Panel>
    </>
  );
}
