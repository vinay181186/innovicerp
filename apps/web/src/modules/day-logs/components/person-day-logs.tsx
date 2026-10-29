// Person page (Team Day Logs → a name, ADR-255): ONE person, ONE day.
// Header: ← Team Day Logs, the name, the department, a date box (max today;
// opens on the team date, else today) and Print / Export. Then the day's
// entries on the FIT table: Sr No · Start Time · Stop Time · Working Hours ·
// Text Rev No · Text Rev Date · Text Rev Time · Working On (one line). The
// three Text Rev columns are a Super Admin's only (the server sends them null
// to anyone else). ▸ opens, for a Super Admin, every Working On version with
// a word diff (LEFT) and the replies with Send reply (RIGHT); for anyone
// else the full text only. Search (Working On, SO / JWSO — and every earlier
// Text Rev for a Super Admin) and the ADR-200 Sort & Filter ▾ run in the
// browser: the whole day is loaded.

import type { DayLogPersonDay, DayLogPersonDayEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { Input } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { usePersonDay } from '../api';
import { personDayTable, fileSlug } from '../lib/export';
import { errText, firstName, fmtDmy, istStamp } from '../lib/format';
import { printPersonDay } from '../lib/print-day-log';
import { sortEntries } from '../lib/sheet';
import { EntrySearch } from './entry-search';
import { PersonReplies } from './person-replies';
import { PersonRevisions } from './person-revisions';
import { PrintExportTools } from './print-export-tools';
import '../day-log-sheet.css';

type Entry = DayLogPersonDayEntry;

const REV_IDS = ['textRevNo', 'textRevDate', 'textRevTime'];

function columns(): DataTableColumn<Entry>[] {
  const revAt = (r: Entry) => (r.textRevNo ? istStamp(r.textRevisedAt) : null);
  return [
    { id: 'srNo', header: 'Sr No', kind: 'code', className: 'mono', render: (r) => r.srNo },
    {
      id: 'start',
      header: 'Start Time',
      kind: 'date',
      className: 'mono',
      render: (r) => fmt12(r.fromTime),
      filterValue: (r) => r.fromTime,
    },
    {
      id: 'stop',
      header: 'Stop Time',
      kind: 'date',
      className: 'mono',
      render: (r) => fmt12(r.toTime),
      filterValue: (r) => r.toTime,
    },
    {
      id: 'hours',
      header: 'Working Hours',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      render: (r) => fmtDuration(r.minutes),
      filterValue: (r) => r.minutes,
    },
    {
      id: 'textRevNo',
      header: 'Text Rev No',
      kind: 'num',
      align: 'right',
      className: 'mono',
      render: (r) => r.textRevNo ?? '—',
      filterValue: (r) => r.textRevNo,
    },
    {
      id: 'textRevDate',
      header: 'Text Rev Date',
      kind: 'date',
      className: 'mono',
      render: (r) => revAt(r)?.date ?? '—',
      filterValue: (r) => (r.textRevNo ? r.textRevisedAt : null),
    },
    {
      id: 'textRevTime',
      header: 'Text Rev Time',
      kind: 'date',
      className: 'mono',
      render: (r) => revAt(r)?.time ?? '—',
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
          {r.replies.length ? (
            <span
              className="dl-rc"
              title={`${r.replies.length} repl${r.replies.length > 1 ? 'ies' : 'y'}`}
            >
              💬{r.replies.length}{' '}
            </span>
          ) : null}
          {r.description}
        </>
      ),
    },
  ];
}

function PersonExpand({ r, p }: { r: Entry; p: DayLogPersonDay }): React.JSX.Element {
  if (!p.isSuperAdmin) {
    return (
      <div className="dl-expand">
        <span className="dl-xl">Working On</span>
        <div className="dl-full">{r.description}</div>
      </div>
    );
  }
  return (
    <div className="dl-expand dl-panes">
      <PersonRevisions revisions={r.revisions} />
      <PersonReplies entryId={r.id} replies={r.replies} first={firstName(p.userName)} />
    </div>
  );
}

export function PersonDayLogs({
  userId,
  date,
  onDate,
  onBack,
}: {
  userId: string;
  /** ?date= — the team date the page was opened from; none = today. */
  date: string | undefined;
  onDate: (d: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const query = usePersonDay(userId, date);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [term, setTerm] = useState('');
  const p = query.data;
  if (!p) {
    return query.isError ? (
      <PageState
        state="error"
        message={errText(query.error, "Could not load this person's day.")}
      />
    ) : (
      <PageState state="loading" />
    );
  }

  const rows = sortEntries(p.entries);
  const needle = normalizeSearchTerm(term);
  const shown = needle
    ? rows.filter((r) =>
        matchesSearchTerm(
          [r.description, r.order?.code, ...r.revisions.map((v) => v.description)],
          needle,
        ),
      )
    : rows;
  const cols = columns().filter((c) => p.isSuperAdmin || !REV_IDS.includes(c.id ?? ''));
  const toggle = (id: string): void =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const goDate = (d: string): void => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= p.today && d !== p.date) {
      setOpen(new Set());
      onDate(d);
    }
  };

  return (
    <div>
      <div className="dl-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Team Day Logs
        </button>
        <span className="section-hdr dl-name">{p.userName}</span>
        {p.deptLabel ? <span className="text3">{p.deptLabel}</span> : null}
        <Input
          type="date"
          mono
          fieldWidth="md"
          aria-label="Day"
          max={p.today}
          value={p.date}
          onChange={(e) => goDate(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <PrintExportTools
          table={personDayTable(p)}
          fileName={`day-log-${fileSlug(p.userName)}-${p.date}`}
          sheetName="Day Log"
          onPrint={(company) => printPersonDay(p, company)}
        />
      </div>
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <EntrySearch
        value={term}
        onChange={setTerm}
        placeholder={
          p.isSuperAdmin
            ? 'Search Working On (every Text Rev), SO / JWSO…'
            : 'Search Working On, SO / JWSO…'
        }
        shown={shown.length}
        total={rows.length}
      />
      <DataTable<Entry>
        tableKey={TABLE_KEYS.personDayLog}
        wrapClassName="dl-fit"
        columns={cols}
        rows={shown}
        empty={needle ? `No entries match "${needle}".` : `Nothing logged on ${fmtDmy(p.date)}.`}
        onRowClick={(r) => toggle(r.id)}
        onToggleExpanded={(r) => toggle(r.id)}
        renderExpanded={(r) => (open.has(r.id) ? <PersonExpand r={r} p={p} /> : null)}
      />
    </div>
  );
}
