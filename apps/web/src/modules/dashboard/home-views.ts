// ADR-264 — the home's `?view=` values: the three personal views, the bell's
// All notifications page, and one view per department that carries checks.

import { DASH_CHECK_DEPTS, type DashCheckDept } from '@innovic/shared';

export const HOME_VIEWS = [
  'todo',
  'daylog',
  'approvals',
  'notifications',
  ...DASH_CHECK_DEPTS,
] as const;
export type HomeView = (typeof HOME_VIEWS)[number];

export function isDeptView(v: HomeView): v is DashCheckDept {
  return (DASH_CHECK_DEPTS as readonly string[]).includes(v);
}

/** The Day Log page (Task Board route, Day Log view) — gate and link. */
export const DAY_LOG_HREF = '/task-board?view=daylog';
