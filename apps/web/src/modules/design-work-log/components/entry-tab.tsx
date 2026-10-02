// Design Work Log — My Log tab (ADR-203 frozen header). Chrome: the three-figure
// StatStrip and the Log Work Entry form (entry permission only). Then the
// "Recent Work Log" — formerly one card per entry under a date chip — as ONE
// filled table with a group heading per Log Date carrying that day's total
// hours (same colours: ≥ 6 h green, ≥ 3 h amber, else red). Same rows as
// before: the latest 50 entries, their 10 most recent dates.

import type { DesignWorkLogEntry } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useSession } from '@/lib/session';
import { DataTable, Panel, RowMenu } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { ConfirmDialog } from '@/ui/feedback';
import { useDeleteDesignWorkLog, useDesignWorkLogList } from '../api';
import { EntryForm } from './entry-form';
import { catColor, CategoryText, todayStr, TrackerBadge } from './work-log-shared';

const COLUMNS: DataTableColumn<DesignWorkLogEntry>[] = [
  {
    id: 'log_date',
    header: 'Log Date',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (l) => fmtDate(l.logDate),
  },
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
      <span style={{ fontWeight: 600 }}>
        {l.taskText ?? 'General'}
        <TrackerBadge designTrackerId={l.designTrackerId} />
      </span>
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
    render: (l) => <span style={{ color: catColor(l.category) }}>{l.hours}h</span>,
  },
  {
    id: 'description',
    header: 'Description',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (l) => <span className="text2">{l.description ?? ''}</span>,
    title: (l) => l.description ?? '',
  },
];

function dayHrsColor(h: number): string {
  return h >= 6 ? 'var(--green)' : h >= 3 ? 'var(--amber)' : 'var(--red)';
}

export function EntryTab(): React.JSX.Element {
  const { data: me } = useSession();
  // Tier-driven (dsnworklog_create, Design dept). Create → entry; delete → the
  // edit+approve pair (L5 Dept Admin and up).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnworklog_create');
  const canAdd = perms.entry;
  const canDelete = perms.edit && perms.approve;
  const engineer = me?.email ?? '';

  const { data, isLoading } = useDesignWorkLogList({
    engineer: engineer || undefined,
    limit: 100,
    offset: 0,
  });
  const myLogs = useMemo(() => data?.items ?? [], [data?.items]);
  const todayLogs = myLogs.filter((l) => l.logDate === todayStr());
  const todayHrs = todayLogs.reduce((s, l) => s + l.hours, 0);
  const totalHrs = myLogs.reduce((s, l) => s + l.hours, 0);

  const deleteMut = useDeleteDesignWorkLog();
  const [askDelete, setAskDelete] = useState<string | null>(null);

  // Latest 50 entries, grouped by Log Date, the 10 most recent dates.
  const { rows, dayHrs } = useMemo(() => {
    const grouped: Record<string, DesignWorkLogEntry[]> = {};
    myLogs.slice(0, 50).forEach((l) => {
      if (!grouped[l.logDate]) grouped[l.logDate] = [];
      grouped[l.logDate]!.push(l);
    });
    const dates = Object.keys(grouped)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 10);
    const totals = new Map<string, number>();
    for (const d of dates)
      totals.set(
        d,
        grouped[d]!.reduce((s, l) => s + l.hours, 0),
      );
    return { rows: dates.flatMap((d) => grouped[d]!), dayHrs: totals };
  }, [myLogs]);

  return (
    <>
      <div style={{ marginBottom: 'var(--panel-gap)' }}>
        <StatStrip
          items={[
            { key: 'today', label: 'Today', count: `${todayHrs.toFixed(1)}h` },
            { key: 'entries', label: 'Entries Today', count: todayLogs.length },
            { key: 'total', label: 'Booked Hours', count: `${totalHrs.toFixed(0)}h` },
          ]}
        />
      </div>

      {canAdd ? <EntryForm /> : null}

      <ConfirmDialog
        open={askDelete !== null}
        title="Delete this work entry?"
        message="The hours are removed from the log."
        confirmLabel="Delete"
        onCancel={() => setAskDelete(null)}
        onConfirm={async () => {
          if (askDelete) await deleteMut.mutateAsync(askDelete);
          setAskDelete(null);
        }}
      />

      <Panel fill bodyPadding="none" title="Recent Work Log">
        <DataTable<DesignWorkLogEntry>
          columns={COLUMNS}
          rows={rows}
          rowKey={(l) => l.id}
          loading={isLoading}
          emptyText="No work logged yet."
          frozen
          groupRow={(l, _i, prev) => {
            if (prev && prev.logDate === l.logDate) return null;
            const h = dayHrs.get(l.logDate) ?? 0;
            return (
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <span className="mono fw-700">{fmtDate(l.logDate)}</span>
                <span>·</span>
                <span className="mono fw-700" style={{ color: dayHrsColor(h) }}>
                  {h.toFixed(1)}h
                </span>
              </span>
            );
          }}
          {...(canDelete
            ? {
                rowActionsWidth: '1%',
                rowActions: (l: DesignWorkLogEntry) => (
                  <RowMenu
                    items={[
                      {
                        key: 'delete',
                        label: 'Delete',
                        icon: 'trash-2',
                        group: 'danger',
                        disabledReason: deleteMut.isPending ? 'Deleting…' : undefined,
                        onSelect: () => setAskDelete(l.id),
                      },
                    ]}
                  />
                ),
              }
            : {})}
        />
      </Panel>
    </>
  );
}
