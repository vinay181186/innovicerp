// ADR-264 — the home's `?view=` values: the three personal views, the bell's
// All notifications page, and one view per department that carries checks.

import { DASH_CHECK_DEPTS, type DashCheckDept } from '@innovic/shared';

export const HOME_VIEWS = [
  'todo',
  'daylog',
  'approvals',
  'notifications',
  'so-jwso-status', // ADR-325: the Reports days list, as a Home menu view
  ...DASH_CHECK_DEPTS,
] as const;
export type HomeView = (typeof HOME_VIEWS)[number];

export function isDeptView(v: HomeView): v is DashCheckDept {
  return (DASH_CHECK_DEPTS as readonly string[]).includes(v);
}

/** The Day Log page (Task Board route, Day Log view) — gate and link. */
export const DAY_LOG_HREF = '/task-board?view=daylog';

/** The SO / JWSO Status report (ADR-325) — the Home view's gate. */
export const SO_JWSO_STATUS_HREF = '/so-jwso-status';
