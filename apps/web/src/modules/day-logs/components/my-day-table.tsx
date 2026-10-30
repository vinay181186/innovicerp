// My Day Log — the day's SAVED entries on the FIT table (ADR-199, ADR-255):
// Sr No · Start Time · Stop Time · Working Hours · SO / JWSO · Working On (one
// line; 🔔 while a reply is unread) · ⋯. A row click or ▸ opens the entry
// (entry-expand.tsx). ⋯ "Edit Working on" and ⋯ "Edit times / SO" both save
// directly (ADR-255/256). ⏳ beside the Stop Time only for an OLD times / SO
// edit still waiting from before ADR-256 (decided on Approvals · Day Log). `line` (the
// ?line= of a Home notification) opens that entry and scrolls to it.
// Search (Working On, SO / JWSO) and the ADR-200 Sort & Filter ▾ run in the
// browser — the whole day is loaded. Rows come in Start Time order and keep
// their Sr No whatever the sort.

import type { DayLogDetail, DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import type { DayQuery } from '../api';
import { fmtDmy } from '../lib/format';
import { sortEntries } from '../lib/sheet';
import { EntryExpand, entryAreaId, type EntryMode } from './entry-expand';
import { EntrySearch } from './entry-search';

type Row = DayLogEntry & { srNo: number };

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'srNo',
    header: 'Sr No',
    kind: 'code',
    render: (r) => r.srNo,
    filterValue: (r) => r.srNo,
    className: 'mono',
  },
  {
    id: 'start',
    header: 'Start Time',
    kind: 'date',
    render: (r) => fmt12(r.fromTime),
    filterValue: (r) => r.fromTime,
    className: 'mono',
  },
  {
    id: 'stop',
    header: 'Stop Time',
    kind: 'date',
    className: 'mono',
    filterValue: (r) => r.toTime,
    render: (r) => (
      <>
        {fmt12(r.toTime)}
        {r.pending ? (
          <span className="dl-orange" title="A times / SO edit is waiting for approval">
            {' '}
            ⏳
          </span>
        ) : r.rejectReason ? (
          <span className="dl-orange fw-700" title={`Edit rejected: ${r.rejectReason}`}>
            {' '}
            !
          </span>
        ) : null}
      </>
    ),
  },
  {
    id: 'hours',
    header: 'Working Hours',
    kind: 'num',
    align: 'right',
    className: 'mono',
    render: (r) => fmtDuration(r.minutes),
    filterValue: (r) => r.minutes,
  },
  {
    id: 'order',
    header: 'SO / JWSO',
    kind: 'code',
    className: 'td-code',
    render: (r) => r.order?.code ?? '—',
    filterValue: (r) => r.order?.code ?? '',
  },
  {
    id: 'work',
    header: 'Working On',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (r) => r.description,
    filterValue: (r) => r.description,
    render: (r) => (
      <>
        {r.replies.some((x) => x.unread) ? (
          <span title="New reply — open the entry to read it">🔔 </span>
        ) : null}
        {r.description}
      </>
    ),
  },
];

export function MyDayTable({
  day,
  q,
  nowMin,
  canWrite,
  line,
  onMessage,
}: {
  day: DayLogDetail;
  q: DayQuery;
  nowMin: number | null;
  /** The server lets the owner write this day (and it is not loading). */
  canWrite: boolean;
  /** Entry to open and scroll to (?line=). */
  line: string | undefined;
  onMessage: (text: string) => void;
}): React.JSX.Element {
  const rows = useMemo<Row[]>(
    () => sortEntries(day.entries).map((e, i) => ({ ...e, srNo: i + 1 })),
    [day.entries],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(line ? [line] : []));
  const [modes, setModes] = useState<Record<string, EntryMode>>({});
  const [term, setTerm] = useState('');
  const needle = normalizeSearchTerm(term);
  const shown = needle
    ? rows.filter((r) => matchesSearchTerm([r.description, r.order?.code], needle))
    : rows;
  const lineFound = Boolean(line && rows.some((r) => r.id === line));

  // ?line= — open that entry (also when the link lands while already here)
  // and bring it on screen; opening it marks its replies seen.
  useEffect(() => {
    if (!line || !lineFound) return;
    setOpen((s) => (s.has(line) ? s : new Set([...s, line])));
    const t = window.setTimeout(() => {
      document.getElementById(entryAreaId(line))?.scrollIntoView({ block: 'center' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [line, lineFound]);

  const toggle = (id: string): void => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setModes((m) => ({ ...m, [id]: 'view' }));
  };
  const openIn = (id: string, mode: EntryMode): void => {
    setOpen((s) => new Set([...s, id]));
    setModes((m) => ({ ...m, [id]: mode }));
  };
  const setMode = (id: string, mode: EntryMode): void => setModes((m) => ({ ...m, [id]: mode }));

  return (
    <>
      <EntrySearch
        value={term}
        onChange={setTerm}
        placeholder="Search Working On, SO / JWSO…"
        shown={shown.length}
        total={rows.length}
      />
      <DataTable<Row>
        tableKey={TABLE_KEYS.myDayLog}
        wrapClassName="dl-fit"
        columns={COLUMNS}
        rows={shown}
        empty={needle ? `No entries match "${needle}".` : `Nothing logged on ${fmtDmy(day.date)}.`}
        onRowClick={(r) => toggle(r.id)}
        onToggleExpanded={(r) => toggle(r.id)}
        renderExpanded={(r) =>
          open.has(r.id) ? (
            <EntryExpand
              e={r}
              q={q}
              mode={canWrite ? (modes[r.id] ?? 'view') : 'view'}
              isOwner={day.isOwner}
              nowMin={nowMin}
              onMode={(m) => setMode(r.id, m)}
              onTimesSent={() => {
                setMode(r.id, 'view');
                onMessage('Saved.');
              }}
            />
          ) : null
        }
        rowMenuLabel={(r) => `Actions for entry ${r.srNo}`}
        rowMenu={(r) => [
          {
            key: 'edit-work',
            label: 'Edit Working on',
            icon: 'pencil',
            // Old Break / Others rows cannot be edited (server rule).
            hidden: !canWrite || r.kind !== 'work',
            onSelect: () => openIn(r.id, 'work'),
          },
          {
            key: 'edit-times',
            label: 'Edit times / SO',
            icon: 'pencil',
            hidden: !canWrite || r.kind !== 'work',
            disabledReason: r.pending ? 'Waiting for approval' : undefined,
            onSelect: () => openIn(r.id, 'times'),
          },
        ]}
      />
    </>
  );
}
