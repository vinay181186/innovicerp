// The Day Log's tabs on the Task Board (owner 2026-10-26): "My Day Log"
// (everyone), "Team Day Logs" (only when GET /day-logs/access says
// canSeeTeam — a Dept / Super Admin, or anyone a Super Admin gave team mates),
// "Teams Config" (only when it says canManageTeams — Super Admin; owner
// 2026-10-30), "Pending Entries" (only when it says canSeePending — Super Admin;
// owner 2026-11-05) and "Approvals · Day Log (N)" (only when it says canApprove AND
// N > 0: since ADR-256 no new Day Log approvals are raised, so the tab stays
// only while old waiting edits are left to decide; §20.5). They are not task
// views — shared TASK_VIEWS stays as it is — so the board accepts these keys in
// its own `view` param and draws this body instead of the task table.
//   view=daylog&date=&line=    my day (line = the entry to open, ADR-255)
//   view=team&date=            the team table for a day
//   view=person&user=&date=&from=  one person's day (Team tab stays lit; from=pending
//                              = opened from Pending Entries, that tab stays lit)
//   view=pending               days not entered, everyone
//   view=teams                 Teams Config — who sees whose Day Log
//   view=approvals              Day Log edits waiting for the caller's approval

import { DAY_LOG_VIEWS } from '@innovic/shared';
import { z } from 'zod';
import { useDayLogAccess, useDayLogApprovals, usePendingEntries } from '../api';
import { DayLogApprovals } from './day-log-approvals';
import { DayLogTab } from './day-log-tab';
import { PendingEntriesTab } from './pending-entries-tab';
import { PersonDayLogs } from './person-day-logs';
import { TeamDayLogsTab } from './team-day-logs-tab';
import { TeamsConfig } from './teams-config';

/** The tabs drawn on the strip. */
export const DAY_LOG_TABS = ['daylog', 'team', 'pending', 'teams', 'approvals'] as const;
export type DayLogTabKey = (typeof DAY_LOG_TABS)[number];
/** Every `view` the day log answers (the person page has no tab of its own) —
 *  the shared DAY_LOG_VIEWS, which page access reads too (daylog_view). */
export type DayLogViewKey = (typeof DAY_LOG_VIEWS)[number];

const LABELS: Record<DayLogTabKey, string> = {
  daylog: 'My Day Log',
  team: 'Team Day Logs',
  pending: 'Pending Entries',
  teams: 'Teams Config',
  approvals: 'Approvals · Day Log',
};

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** The board's extra search params. A bad value is dropped, not an error. */
export const dayLogSearchShape = {
  date: dateParam,
  user: z.string().uuid().optional().catch(undefined),
  /** My Day Log: the entry to open and scroll to (Home notification link). */
  line: z.string().uuid().optional().catch(undefined),
  /** Person page: opened from Pending Entries — the back button goes there. */
  from: z.enum(['pending']).optional().catch(undefined),
};

export function isDayLogTab(v: string): v is DayLogViewKey {
  return (DAY_LOG_VIEWS as readonly string[]).includes(v);
}

/** The tab to light on the strip: the person page belongs to the tab it was
 *  opened from. */
export function dayLogTabOf(v: DayLogViewKey, from?: 'pending'): DayLogTabKey {
  if (v !== 'person') return v;
  return from === 'pending' ? 'pending' : 'team';
}

/** The tabs to draw: Team / Pending Entries / Teams Config / Approvals only for
 *  whoever the server lets see them. Pending Entries carries its people count. Approvals carries its waiting count and is drawn
 *  while that count is above 0 — and also while it is loading or failed (a
 *  failed read must never look like "nothing waiting"), and while the
 *  caller is ON it (`current`), so deciding the last edit does not pull the
 *  lit tab away. `enabled` false (Day Log page hidden for this person) → no
 *  tabs and no request. */
export function useDayLogBoardTabs(
  enabled = true,
  current?: DayLogViewKey | null,
): { key: DayLogTabKey; label: string; count?: number | null }[] {
  const access = useDayLogAccess(enabled);
  const canApprove = enabled && Boolean(access.data?.canApprove);
  const approvals = useDayLogApprovals(canApprove);
  const waiting = approvals.data?.rows.length ?? 0;
  const canSeePending = enabled && Boolean(access.data?.canSeePending);
  const pending = usePendingEntries(canSeePending);
  const pendingPeople = pending.data ? new Set(pending.data.rows.map((r) => r.userId)).size : null;
  const shown: Record<DayLogTabKey, boolean> = {
    daylog: true,
    team: Boolean(access.data?.canSeeTeam),
    pending: canSeePending,
    teams: Boolean(access.data?.canManageTeams),
    approvals:
      canApprove &&
      (approvals.isLoading || approvals.isError || waiting > 0 || current === 'approvals'),
  };
  if (!enabled) return [];
  return DAY_LOG_TABS.filter((t) => shown[t]).map((key) => ({
    key,
    label:
      key === 'approvals'
        ? `${LABELS[key]} (${approvals.isError ? '!' : approvals.isLoading ? '…' : waiting})`
        : LABELS[key],
    ...(key === 'pending' ? { count: pendingPeople } : {}),
  }));
}

export interface DayLogNav {
  view?: DayLogViewKey;
  date?: string | undefined;
  user?: string | undefined;
  line?: string | undefined;
  from?: 'pending' | undefined;
}

export function DayLogBoardBody({
  tab,
  date,
  user,
  line,
  from,
  onNav,
}: {
  tab: DayLogViewKey;
  date: string | undefined;
  user: string | undefined;
  line: string | undefined;
  from: 'pending' | undefined;
  onNav: (n: DayLogNav) => void;
}): React.JSX.Element {
  if (tab === 'person' && user) {
    return (
      <PersonDayLogs
        userId={user}
        date={date}
        onDate={(d) => onNav({ date: d })}
        backLabel={from === 'pending' ? '← Pending Entries' : '← Team Day Logs'}
        onBack={() =>
          from === 'pending'
            ? onNav({ view: 'pending', user: undefined, date: undefined, from: undefined })
            : onNav({ view: 'team', user: undefined })
        }
      />
    );
  }
  if (tab === 'approvals') return <DayLogApprovals />;
  if (tab === 'teams') return <TeamsConfig />;
  if (tab === 'pending') {
    return <PendingEntriesTab />;
  }
  if (tab === 'team' || tab === 'person') {
    return (
      <TeamDayLogsTab
        date={date}
        onDate={(d) => onNav({ date: d })}
        onOpenPerson={(u, d) => onNav({ view: 'person', user: u, date: d, line: undefined })}
      />
    );
  }
  return <DayLogTab date={date} line={line} onDate={(d) => onNav({ date: d, line: undefined })} />;
}
