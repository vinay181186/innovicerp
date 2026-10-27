// Day Log service (owner 2026-10-26, simple sheet 2026-10-27; migrations 0222–0225). The user's own
// log of the working day, on the Daily Task Report tables. Split by concern
// so each file stays reviewable:
//   entries.ts — add one row / ask for an edit     manage.ts — read one day
//   approvals.ts — list / approve / reject edits   writes.ts — guards + the ONE row check
//   team.ts    — Team Day Logs                     person.ts — one person over a date range
//   orders.ts  — SO / JWSO picker + check          day.ts    — header / line SQL
//   detail.ts  — yesterday first, the DayLogDetail  lock.ts  — the day lock
//   sheet.ts   — many new rows at once (one sheet)
//   holidays.ts — holidays, tab access            access.ts — who sees and manages whose day
// Rules of the day itself live in packages/shared day-log.ts (summarizeDay…).

export { addEntry, updateEntry } from './entries';
export { addEntries } from './sheet';
export { approveEntry, getApprovals, rejectEntry } from './approvals';
export { getDay } from './manage';
export { getTeam } from './team';
export { getPerson } from './person';
export { orderOptions } from './orders';
export { addHoliday, deleteHoliday, getAccess, listHolidays } from './holidays';
