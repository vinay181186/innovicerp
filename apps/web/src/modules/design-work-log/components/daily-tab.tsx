// Design Work Log — Daily View tab (ADR-203 frozen header). Chrome: the date
// navigator + engineer picker, whose options carry each engineer's hours (no
// tile row on a list, owner 2026-11-03); the Total sits in the ListFooter. The day's
// entries — formerly one block of cards per engineer — are ONE filled table
// with a group heading per Design Engineer carrying that engineer's hours
// (≥ 6 h green, else amber, as before).

import type { DesignWorkLogEntry } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { useDesignWorkLogList } from '../api';
import {
  addDays,
  CategoryText,
  dayName,
  todayStr,
  TrackerBadge,
  useReportCount,
  type TabListProps,
} from './work-log-shared';
import { SearchableSelect } from '@/ui/forms';

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

export function DailyTab({ term, onCount }: TabListProps): React.JSX.Element {
  const [viewDate, setViewDate] = useState(todayStr());
  const [viewEng, setViewEng] = useState<string>('All');
  const { data, isLoading } = useDesignWorkLogList({
    fromDate: viewDate,
    toDate: viewDate,
    limit: 500,
    offset: 0,
  });
  const allDayLogs = useMemo(() => data?.items ?? [], [data?.items]);

  // Legacy L7994-7997: the engineer options always show that engineer's full day,
  // while the entry list and the Total follow the selected engineer.
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

  const shownRows = rows.filter((l) =>
    matchesSearchTerm(
      [l.engineerText, l.projectName, l.taskText ?? 'General', l.category, l.hours, l.description],
      term,
    ),
  );
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
          onClick={() => setViewDate(addDays(viewDate, -1))}
        >
          ←
        </button>
        <div
          style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, minWidth: 160, textAlign: 'center' }}
        >
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
        <SearchableSelect
          style={{ minWidth: 200 }}
          ariaLabel="Design Engineer"
          value={viewEng === 'All' ? null : viewEng}
          onChange={(id) => setViewEng(id ?? 'All')}
          options={engineers.map((e) => ({
            id: e,
            name: `${e} · ${allDayLogs
              .filter((l) => l.engineerText === e)
              .reduce((s, l) => s + l.hours, 0)
              .toFixed(1)}h`,
          }))}
          valueLabel={viewEng === 'All' ? undefined : viewEng}
          placeholder="All Design Engineers"
          clearable
        />
      </div>

      <Panel fill bodyPadding="none">
        <DataTable<DesignWorkLogEntry>
          tableKey={TABLE_KEYS.designWorkLogDaily}
          columns={COLUMNS}
          rows={shownRows}
          rowKey={(l) => l.id}
          loading={isLoading}
          emptyText={term.trim() || viewEng !== 'All' ? 'No entries match.' : 'No entries yet.'}
          groupRow={(l, _i, prev) => {
            if (prev && prev.engineerText === l.engineerText) return null;
            const et = engHrs.get(l.engineerText) ?? 0;
            return (
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
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
      <ListFooter
        total={rows.length}
        shown={shownRows.length}
        noun="entry"
        nounPlural="entries"
        summary={`Total ${totalHrs.toFixed(1)}h`}
      />
    </>
  );
}
