// Day Log History PDF: the server's answer as the print tests need it.

import type { DayLogHistory, DayLogHistoryDay, DayLogHistoryEntry } from '@innovic/shared';
import { dayLogHistoryHtml } from './print-day-log-history';

const NOW = new Date('2026-11-06T10:42:00Z');
const REPLY_ID = '00000000-0000-4000-8000-000000000009';

export function entry(over: Partial<DayLogHistoryEntry> = {}): DayLogHistoryEntry {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    srNo: 1,
    kind: 'work',
    loggedAt: '2026-10-22T07:47:00Z',
    fromTime: '09:00',
    toTime: '11:00',
    minutes: 120,
    order: null,
    description: 'Route Card entry',
    entryRevNo: 0,
    entryRevisedAt: null,
    revisions: [
      {
        entryRevNo: 0,
        description: 'Route Card entry',
        fromTime: '09:00',
        toTime: '11:00',
        order: null,
        savedAt: '2026-10-22T07:47:00Z',
      },
    ],
    replies: [],
    pending: null,
    savedLaterOn: null,
    ...over,
  };
}

export function day(over: Partial<DayLogHistoryDay> = {}): DayLogHistoryDay {
  return {
    date: '2026-10-22',
    state: 'filled',
    holidayName: null,
    firstStart: '09:00',
    lastStop: '11:00',
    workMin: 120,
    breakMin: 0,
    leaveMin: 0,
    entryCount: 1,
    editedEntries: 0,
    edits: 0,
    replies: 0,
    savedLater: 0,
    entries: [entry()],
    dayReplies: [],
    ...over,
  };
}

export const blank = { firstStart: null, lastStop: null, workMin: 0, entryCount: 0, entries: [] };

export function history(
  days: DayLogHistoryDay[],
  over: Partial<DayLogHistory> = {},
): DayLogHistory {
  return {
    userId: '00000000-0000-4000-8000-000000000002',
    userName: 'Mayur',
    deptLabel: 'Planning',
    from: '2026-10-22',
    to: '2026-10-22',
    today: '2026-11-06',
    days,
    totals: {
      workingDays: 1,
      filledDays: 1,
      notEntered: 0,
      offDays: 0,
      leaveDays: 0,
      entries: 1,
      workMin: 120,
      avgDailyWorkMin: 120,
      breakMin: 0,
      leaveMin: 0,
      editedEntries: 0,
      edits: 0,
      replies: 0,
      savedLater: 0,
    },
    hasContent: true,
    ...over,
  };
}

export const reply = (
  over: { seenAt?: string | null; editedAt?: string | null; body?: string } = {},
) => ({
  id: REPLY_ID,
  body: over.body ?? 'Why was this changed?',
  authorName: 'Super Admin',
  sentAt: '2026-10-23T05:35:00Z',
  editedAt: over.editedAt ?? null,
  seenAt: over.seenAt ?? null,
  updatedAt: '2026-10-23T05:35:00Z',
  canEdit: true,
});

export const build = (h: DayLogHistory): string => dayLogHistoryHtml(h, null, NOW);

/** A range PDF over the fixture's dates, from/to as given. */
export const rangeHtml = (days: DayLogHistoryDay[], from: string, to: string): string =>
  build(history(days, { from, to }));

export const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;
