// Day Log service (owner 2026-10-26; migrations 0222 / 0223). The user's own
// log of the working day, on the Daily Task Report tables. Split by concern
// so each file stays reviewable:
//   entries.ts — add / edit / Stop / remove      manage.ts — read, Submit, Reopen / Leave
//   writes.ts  — guards + the ONE entry check     team.ts   — Team Day Logs
//   person.ts  — one person over a date range     orders.ts — SO / JWSO picker + check
//   day.ts     — read / open / lock one day       detail.ts — D3, stray Open, the DayLogDetail
//   holidays.ts — holidays, tab access            access.ts — who sees and manages whose day
// Rules of the day itself live in packages/shared day-log.ts (summarizeDay…).

export { addEntry, deleteEntry, stopEntry, updateEntry } from './entries';
export { getDay, markLeave, reopenDay, submitDay } from './manage';
export { getTeam } from './team';
export { getPerson } from './person';
export { orderOptions } from './orders';
export { addHoliday, deleteHoliday, getAccess, listHolidays } from './holidays';
