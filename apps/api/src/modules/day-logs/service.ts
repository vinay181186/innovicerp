// Day Log service (owner 2026-10-26, simple sheet 2026-10-27; migrations 0222–0225). The user's own
// log of the working day, on the Daily Task Report tables. Split by concern
// so each file stays reviewable:
//   entries.ts — add one row / ask for an edit     manage.ts — read one day
//   approvals.ts — list / approve / reject edits   writes.ts — guards + the ONE row check
//   team.ts    — Team Day Logs                     person-day.ts — a person, one day
//   orders.ts  — SO / JWSO picker + check          day.ts    — header / line SQL
//   detail.ts  — the DayLogDetail                   lock.ts  — the day lock
//   sheet.ts   — many new rows at once (one sheet)
//   text.ts    — Working On edited directly + revisions, replies seen (ADR-255)
//   replies.ts — Super Admin replies
//   day-replies.ts — replies on a blank day          pending.ts — Pending Entries
//   holidays.ts — holidays, tab access            access.ts — who sees and manages whose day
//   team-mates.ts — Teams Config (who sees whose Day Log, one-way: User → mate)
//   person-history.ts — a person's From-To range (ADR-278)
//   entry-facts.ts — Entry Revs and replies shared by person-day and History
// Rules of the day itself live in packages/shared day-log.ts (summarizeDay…).

export { addEntry, updateEntry } from './entries';
export { addEntries } from './sheet';
export { markRepliesSeen, updateWork } from './text';
export { editReply, sendReply } from './replies';
export { editDayReply, markDayRepliesSeen, sendDayReply } from './day-replies';
export { getMyPending, getPending, getPendingCalendar } from './pending';
export { getPersonDay } from './person-day';
export { getPersonHistory } from './person-history';
export { approveEntry, getApprovals, rejectEntry } from './approvals';
export { getDay } from './manage';
export { getTeam } from './team';
export { orderOptions } from './orders';
export { addHoliday, deleteHoliday, getAccess, listHolidays } from './holidays';
export { addTeamMate, listTeamMates, listTeamPeople, removeTeamMate } from './team-mates';
