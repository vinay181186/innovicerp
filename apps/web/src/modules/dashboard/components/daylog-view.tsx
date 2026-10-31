// ADR-264 — Day Log on the home: today's figures (server summary) and today's
// entries, read-only. Editing stays on the Day Log page ("Open Day Log").
// Names per NAMING.md: Working On, SO / JWSO, Status Open / Closed, Working hours.

import { type DayLogDetail, fmt12, fmtDuration } from '@innovic/shared';
import { ActionLink } from '@/components/shared/action-link';
import { useDayLog } from '@/modules/day-logs/api';
import { PageState } from '@/ui/layout';
import { DataTable, type DataTableColumn, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { DAY_LOG_HREF } from '../home-views';
import { linkProps } from './dash-text';
import { ViewHead } from './view-head';

type Entry = DayLogDetail['entries'][number];

const COLUMNS: DataTableColumn<Entry>[] = [
  { id: 'from', header: 'From', kind: 'date', render: (e) => fmt12(e.fromTime) },
  { id: 'to', header: 'To', kind: 'date', render: (e) => (e.toTime ? fmt12(e.toTime) : '—') },
  {
    id: 'working_on',
    header: 'Working On',
    kind: 'text',
    ellipsis: true,
    align: 'left',
    filterValue: (e) => e.description,
    title: (e) => e.description,
    render: (e) => e.description || '—',
  },
  {
    id: 'order',
    header: 'SO / JWSO',
    kind: 'code',
    filterValue: (e) => e.order?.code ?? '',
    render: (e) => (e.order ? <span className="dh-doc">{e.order.code}</span> : '—'),
  },
  {
    id: 'status',
    header: 'Status',
    kind: 'badge',
    filterValue: (e) => (e.toTime ? 'Closed' : 'Open'),
    render: (e) =>
      e.toTime ? (
        <span className="dh-pill t-none">Closed</span>
      ) : (
        <span className="dh-pill t-due">Open</span>
      ),
  },
];

export function DayLogView(): React.JSX.Element {
  const day = useDayLog({});
  const d = day.data;
  const openLink = (
    <ActionLink {...linkProps(DAY_LOG_HREF)} check={DAY_LOG_HREF} className="btn btn-ghost btn-sm">
      Open Day Log
    </ActionLink>
  );

  let body: React.ReactNode;
  if (day.isError && !d) {
    body = <PageState state="error" message="Could not load your Day Log. Try again." />;
  } else if (!d) {
    body = <PageState state="loading" />;
  } else {
    const waiting = d.entries.filter((e) => e.pending != null).length;
    const openNow = d.entries.filter((e) => e.toTime == null).length;
    body = (
      <>
        <StatStrip
          items={[
            { key: 'entries', label: 'Entries today', count: d.summary.entryCount },
            { key: 'hours', label: 'Working hours', count: fmtDuration(d.summary.workMin) },
            {
              key: 'open',
              label: 'Open now',
              count: openNow,
              color: openNow > 0 ? 'var(--amber2)' : undefined,
            },
            { key: 'waiting', label: 'Waiting approval', count: waiting },
          ]}
        />
        <DataTable
          tableKey={TABLE_KEYS.dashDayLog}
          columns={COLUMNS}
          rows={d.entries}
          rowKey={(e) => e.id}
          emptyText="No entries yet today."
        />
      </>
    );
  }

  return (
    <>
      <ViewHead title="Day Log" hint="My entries today">
        {openLink}
      </ViewHead>
      <div className="dh-body">{body}</div>
    </>
  );
}
