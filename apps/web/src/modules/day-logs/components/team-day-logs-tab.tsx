// "Team Day Logs" tab (owner final 2026-10-27; clean-up 2026-10-30): one day,
// one row a person the viewer may see — everyone for a Super Admin, the
// department for a Dept Admin, their team mates for anyone a Super Admin
// paired on Teams Config (the server decides the rows). Columns: User (link
// to the person page) · First start · Last stop · Working hours · Entries on
// the FIT table (ADR-199) with the ADR-200 Sort & Filter ▾ and a User search,
// both in the browser (the whole team for the day is loaded); a row click
// opens the person page. No count strip, no Now / Late columns (owner
// 2026-10-30). The table reads again every minute (api.ts).

import type { TeamDayLogRow } from '@innovic/shared';
import { useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { Input, SearchInput } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import { errText } from '../lib/format';
import { printTeamDayLogs } from '../lib/print-day-log';
import { PrintExportTools } from './print-export-tools';
import { teamColumns } from './team-day-logs-columns';
import '../day-log-sheet.css';

export function TeamDayLogsTab({
  date,
  onDate,
  onOpenPerson,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
  onOpenPerson: (userId: string, date: string) => void;
}): React.JSX.Element {
  const query = useTeamDayLogs(date);
  const team = query.data;
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

  const needle = normalizeSearchTerm(term);
  const rows = needle
    ? team.rows.filter((r) => matchesSearchTerm([r.userName], needle))
    : team.rows;

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
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="dl-searchbar" role="search">
        <SearchInput value={term} onChange={setTerm} placeholder="Search User…" />
        {needle ? (
          <span className="text3 dl-small">
            Showing {rows.length} of {team.rows.length}
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
        columns={teamColumns()}
        rows={rows}
        rowKey={(r) => r.userId}
        empty={needle ? `No user matches "${needle}".` : 'No one to show for this day.'}
        onRowClick={(r) => onOpenPerson(r.userId, team.date)}
      />
    </div>
  );
}
