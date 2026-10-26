// The Day Log's tabs on the Task Board (owner 2026-10-26): "My Day Log"
// (everyone) and "Team Day Logs" (only when GET /day-logs/access says
// canSeeTeam, §20.5). They are not task views — shared TASK_VIEWS stays as
// it is — so the board accepts these keys in its own `view` param and draws
// this body instead of the task table.
//   view=daylog&date=          my day
//   view=team&date=            the team table for a day
//   view=person&user=&from=&to=&date=   one person's days (Team tab stays lit)

import { z } from 'zod';
import { useDayLogAccess } from '../api';
import { DayLogTab } from './day-log-tab';
import { PersonDayLogs } from './person-day-logs';
import { TeamDayLogsTab } from './team-day-logs-tab';

/** The tabs drawn on the strip. */
export const DAY_LOG_TABS = ['daylog', 'team'] as const;
export type DayLogTabKey = (typeof DAY_LOG_TABS)[number];
/** Every `view` the day log answers (the person page has no tab of its own). */
export const DAY_LOG_VIEWS = ['daylog', 'team', 'person'] as const;
export type DayLogViewKey = (typeof DAY_LOG_VIEWS)[number];

const LABELS: Record<DayLogTabKey, string> = {
  daylog: 'My Day Log',
  team: 'Team Day Logs',
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
  from: dateParam,
  to: dateParam,
};

export function isDayLogTab(v: string): v is DayLogViewKey {
  return v === 'daylog' || v === 'team' || v === 'person';
}

/** The tab to light on the strip: the person page belongs to Team. */
export function dayLogTabOf(v: DayLogViewKey): DayLogTabKey {
  return v === 'person' ? 'team' : v;
}

/** The tabs to draw: Team only for whoever the server lets see it. */
export function useDayLogBoardTabs(): { key: DayLogTabKey; label: string }[] {
  const access = useDayLogAccess();
  return DAY_LOG_TABS.filter((t) => t === 'daylog' || access.data?.canSeeTeam).map((key) => ({
    key,
    label: LABELS[key],
  }));
}

export interface DayLogNav {
  view?: DayLogViewKey;
  date?: string | undefined;
  user?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export function DayLogBoardBody({
  tab,
  date,
  user,
  from,
  to,
  onNav,
}: {
  tab: DayLogViewKey;
  date: string | undefined;
  user: string | undefined;
  from: string | undefined;
  to: string | undefined;
  onNav: (n: DayLogNav) => void;
}): React.JSX.Element {
  if (tab === 'person' && user) {
    return (
      <PersonDayLogs
        userId={user}
        date={date}
        from={from}
        to={to}
        onRange={(f, t) => onNav({ from: f, to: t })}
        onBack={() => onNav({ view: 'team', user: undefined, from: undefined, to: undefined })}
      />
    );
  }
  if (tab === 'team' || tab === 'person') {
    return (
      <TeamDayLogsTab
        date={date}
        onDate={(d) => onNav({ date: d })}
        onOpenPerson={(u, d) =>
          onNav({ view: 'person', user: u, date: d, from: undefined, to: undefined })
        }
      />
    );
  }
  return <DayLogTab date={date} onDate={(d) => onNav({ date: d })} />;
}
