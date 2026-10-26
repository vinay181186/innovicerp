// The Day Log's two tabs on the Task Board (owner 2026-10-26): "My Day Log"
// (everyone) and "Team Day Logs" (only when GET /day-logs/access says
// canSeeTeam, §20.5). They are not task views — shared TASK_VIEWS stays as
// it is — so the board accepts these keys in its own `view` param and draws
// this body instead of the task table. `?date=` / `?user=` open a person's day.

import { z } from 'zod';
import { useDayLogAccess } from '../api';
import { DayLogTab } from './day-log-tab';
import { TeamDayLogsTab } from './team-day-logs-tab';

export const DAY_LOG_TABS = ['daylog', 'team'] as const;
export type DayLogTabKey = (typeof DAY_LOG_TABS)[number];

const LABELS: Record<DayLogTabKey, string> = {
  daylog: 'My Day Log',
  team: 'Team Day Logs',
};

/** The board's extra search params. A bad value is dropped, not an error. */
export const dayLogSearchShape = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  user: z.string().uuid().optional().catch(undefined),
};

export function isDayLogTab(v: string): v is DayLogTabKey {
  return v === 'daylog' || v === 'team';
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
  view?: DayLogTabKey;
  date?: string | undefined;
  user?: string | undefined;
}

export function DayLogBoardBody({
  tab,
  date,
  user,
  onNav,
}: {
  tab: DayLogTabKey;
  date: string | undefined;
  user: string | undefined;
  onNav: (n: DayLogNav) => void;
}): React.JSX.Element {
  if (tab === 'team') {
    return (
      <TeamDayLogsTab
        date={date}
        onDate={(d) => onNav({ date: d })}
        onOpenDay={(u, d) => onNav({ view: 'daylog', user: u, date: d })}
      />
    );
  }
  return (
    <DayLogTab
      date={date}
      userId={user}
      onDate={(d) => onNav({ date: d })}
      onUser={(u) => onNav({ user: u })}
    />
  );
}
