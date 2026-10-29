// The Day Log's tabs on the Task Board (owner 2026-10-26): "My Day Log"
// (everyone), "Team Day Logs" (only when GET /day-logs/access says
// canSeeTeam) and "Approvals · Day Log (N)" (only when it says canApprove,
// §20.5; owner 2026-10-27). They are not task views — shared TASK_VIEWS stays as
// it is — so the board accepts these keys in its own `view` param and draws
// this body instead of the task table.
//   view=daylog&date=&line=    my day (line = the entry to open, ADR-255)
//   view=team&date=            the team table for a day
//   view=person&user=&date=    one person's day (Team tab stays lit)
//   view=approvals              Day Log edits waiting for the caller's approval

import { z } from 'zod';
import { useDayLogAccess, useDayLogApprovals } from '../api';
import { DayLogApprovals } from './day-log-approvals';
import { DayLogTab } from './day-log-tab';
import { PersonDayLogs } from './person-day-logs';
import { TeamDayLogsTab } from './team-day-logs-tab';

/** The tabs drawn on the strip. */
export const DAY_LOG_TABS = ['daylog', 'team', 'approvals'] as const;
export type DayLogTabKey = (typeof DAY_LOG_TABS)[number];
/** Every `view` the day log answers (the person page has no tab of its own). */
export const DAY_LOG_VIEWS = ['daylog', 'team', 'person', 'approvals'] as const;
export type DayLogViewKey = (typeof DAY_LOG_VIEWS)[number];

const LABELS: Record<DayLogTabKey, string> = {
  daylog: 'My Day Log',
  team: 'Team Day Logs',
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
};

export function isDayLogTab(v: string): v is DayLogViewKey {
  return (DAY_LOG_VIEWS as readonly string[]).includes(v);
}

/** The tab to light on the strip: the person page belongs to Team. */
export function dayLogTabOf(v: DayLogViewKey): DayLogTabKey {
  return v === 'person' ? 'team' : v;
}

/** The tabs to draw: Team / Approvals only for whoever the server lets see
 *  them; Approvals carries its waiting count. */
export function useDayLogBoardTabs(): { key: DayLogTabKey; label: string }[] {
  const access = useDayLogAccess();
  const canApprove = Boolean(access.data?.canApprove);
  const approvals = useDayLogApprovals(canApprove);
  const shown: Record<DayLogTabKey, boolean> = {
    daylog: true,
    team: Boolean(access.data?.canSeeTeam),
    approvals: canApprove,
  };
  return DAY_LOG_TABS.filter((t) => shown[t]).map((key) => ({
    key,
    label:
      key === 'approvals' ? `${LABELS[key]} (${approvals.data?.rows.length ?? 0})` : LABELS[key],
  }));
}

export interface DayLogNav {
  view?: DayLogViewKey;
  date?: string | undefined;
  user?: string | undefined;
  line?: string | undefined;
}

export function DayLogBoardBody({
  tab,
  date,
  user,
  line,
  onNav,
}: {
  tab: DayLogViewKey;
  date: string | undefined;
  user: string | undefined;
  line: string | undefined;
  onNav: (n: DayLogNav) => void;
}): React.JSX.Element {
  if (tab === 'person' && user) {
    return (
      <PersonDayLogs
        userId={user}
        date={date}
        onDate={(d) => onNav({ date: d })}
        onBack={() => onNav({ view: 'team', user: undefined })}
      />
    );
  }
  if (tab === 'approvals') return <DayLogApprovals />;
  if (tab === 'team' || tab === 'person') {
    return (
      <TeamDayLogsTab
        date={date}
        onDate={(d) => onNav({ date: d })}
        onApprovals={() => onNav({ view: 'approvals', user: undefined })}
        onOpenPerson={(u, d) => onNav({ view: 'person', user: u, date: d, line: undefined })}
      />
    );
  }
  return <DayLogTab date={date} line={line} onDate={(d) => onNav({ date: d, line: undefined })} />;
}
