// "Team Day Logs" tab (owner final 2026-10-27): one day, one row a person the
// viewer may see. ONE strip — today: Working · Idle · Not started · Team
// working hours · Edits to approve; a past day: Logged · No entries · Team
// working hours. A count click filters the table to it, a second click shows
// all; "Edits to approve" opens the Approvals tab. Columns: User (link to
// the person page) · Now · First start · Last stop · Working hours · Entries
// · Late (the LATE count — this tab is the admins' only) on the FIT table
// (ADR-199) with the ADR-200 Sort & Filter ▾ and a User search, both in the
// browser (the whole team for the day is loaded); a row click opens the
// person page. The table reads again every minute (api.ts).

import type { TeamDayLogRow } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { DataTable, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { Input, SearchInput } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { useDayLogAccess, useDayLogApprovals, useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import { errText, nowChip } from '../lib/format';
import { printTeamDayLogs } from '../lib/print-day-log';
import { PrintExportTools } from './print-export-tools';
import { teamColumns } from './team-day-logs-columns';
import '../day-log-sheet.css';

/** The strip's status cells, by the Now chip's label. */
const TODAY_CELLS: { label: string; color?: string }[] = [
  { label: 'Working', color: 'var(--blue)' },
  { label: 'Idle', color: 'var(--amber2)' },
  { label: 'Not started' },
];
const PAST_CELLS: typeof TODAY_CELLS = [
  { label: 'Logged', color: 'var(--green2)' },
  { label: 'No entries' },
];

export function TeamDayLogsTab({
  date,
  onDate,
  onOpenPerson,
  onApprovals,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
  onOpenPerson: (userId: string, date: string) => void;
  onApprovals: () => void;
}): React.JSX.Element {
  const query = useTeamDayLogs(date);
  const access = useDayLogAccess();
  const canApprove = Boolean(access.data?.canApprove);
  const approvals = useDayLogApprovals(canApprove);
  const team = query.data;
  const [only, setOnly] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  if (!team) {
    return query.isError ? (
      <PageState
        state="error"
        message={errText(query.error, 'Could not load the team day logs.')}
      />
    ) : (
      <PageState state="loading" />
    );
  }

  const isToday = team.date === team.today;
  const cells = isToday ? TODAY_CELLS : PAST_CELLS;
  const labelOf = (r: TeamDayLogRow): string => nowChip(r, isToday).label;
  const filter = cells.find((c) => c.label === only) ?? null;
  const byChip = filter ? team.rows.filter((r) => labelOf(r) === filter.label) : team.rows;
  const needle = normalizeSearchTerm(term);
  const rows = needle ? byChip.filter((r) => matchesSearchTerm([r.userName], needle)) : byChip;
  const teamWork = team.rows.reduce((n, r) => n + r.workMin, 0);
  const toApprove = approvals.data?.rows.length ?? 0;

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <label className="text3" htmlFor="dl-team-day">
          Day
        </label>
        <Input
          id="dl-team-day"
          type="date"
          mono
          fieldWidth="md"
          max={team.today}
          value={team.date}
          onChange={(e) => {
            const d = e.target.value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > team.today || d === team.date) return;
            setOnly(null);
            onDate(d === team.today ? undefined : d);
          }}
        />
        {!team.workingDay ? <span className="badge b-grey">Not a working day</span> : null}
        {query.isFetching ? <span className="text3">⟳ Updating…</span> : null}
        <span style={{ flex: 1 }} />
        <PrintExportTools
          table={teamTable(team)}
          fileName={`team-day-logs-${team.date}`}
          sheetName="Team Day Logs"
          onPrint={(company) => printTeamDayLogs(team, company)}
        />
      </div>
      <StatStrip
        style={{ marginBottom: 10 }}
        items={[
          ...cells.map((c) => ({
            key: c.label,
            label: c.label,
            count: team.rows.filter((r) => labelOf(r) === c.label).length,
            color: c.color,
            active: only === c.label,
            onClick: () => setOnly(only === c.label ? null : c.label),
          })),
          { key: 'hours', label: 'Team working hours', count: fmtDuration(teamWork) },
          ...(isToday && canApprove
            ? [
                {
                  key: 'approve',
                  label: 'Edits to approve',
                  count: toApprove,
                  color: toApprove > 0 ? 'var(--amber2)' : undefined,
                  onClick: onApprovals,
                },
              ]
            : []),
        ]}
      />
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="dl-searchbar" role="search">
        <SearchInput value={term} onChange={setTerm} placeholder="Search User…" />
        {needle ? (
          <span className="text3 dl-small">
            Showing {rows.length} of {byChip.length}
          </span>
        ) : null}
        {needle ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTerm('')}>
            Clear search
          </button>
        ) : null}
      </div>
      <DataTable<TeamDayLogRow>
        tableKey={TABLE_KEYS.teamDayLogs}
        columns={teamColumns(isToday)}
        rows={rows}
        rowKey={(r) => r.userId}
        empty={
          needle
            ? `No user matches "${needle}".`
            : filter
              ? `No one is ${filter.label} — click the count again to show all.`
              : 'No one to show for this day.'
        }
        onRowClick={(r) => onOpenPerson(r.userId, team.date)}
      />
    </div>
  );
}
