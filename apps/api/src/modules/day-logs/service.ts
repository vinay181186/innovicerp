// Day Log service (owner 2026-10-26; migration 0222). The user's From–To log
// of the working day, on the Daily Task Report tables. The logic is split by
// concern so each file stays reviewable:
//   writes.ts — Work Status, remove last entry     manage.ts — read, Submit, Reopen / Leave / Remind
//   team.ts   — Team Day Logs                      breaks.ts — break template, holidays
//   timer.ts  — Start / Stop                       detail.ts — D3 / D10 checks, the DayLogDetail
//   day.ts    — read / open / lock one day         access.ts — who sees and manages whose day
// Rules of the day itself live in packages/shared day-log.ts (summarizeDay…).

export { deleteEntry, setEntryStatus } from './writes';
export { startTimer, stopTimer } from './timer';
export { getDay, markLeave, remindUser, reopenDay, submitDay } from './manage';
export { getTeam } from './team';
export {
  addHoliday,
  deleteHoliday,
  getAccess,
  getMyBreaks,
  listHolidays,
  saveMyBreaks,
} from './breaks';
