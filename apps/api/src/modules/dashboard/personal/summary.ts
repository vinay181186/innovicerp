// ADR-250 — the cues strip and the headline, made ONLY from figures the
// blocks already hold (a cue's count IS its list's total — never a second
// query for the same fact).

import type { ApprovalInboxResponse, DashCue, DashList, DashText } from '@innovic/shared';
import { plural } from './util';

export interface ListWithLate {
  list: DashList;
  lateTotal: number;
}

/** Everything waiting for the caller's sign-off — every inbox section,
 *  Route Cards included (ADR-253). One sum for the cue and the headline. */
export function toApproveCount(approvals: ApprovalInboxResponse): number {
  const c = approvals.counts;
  return c.pr + c.po + c.logEntry + (c.rc ?? 0);
}

export function buildCues(
  lists: readonly ListWithLate[],
  approvals: ApprovalInboxResponse | null,
  waitingCount: number,
  doneToday: number,
): DashCue[] {
  const cues: DashCue[] = lists.map(({ list, lateTotal }) => ({
    key: list.key,
    label: list.title,
    count: list.total,
    sub: lateTotal > 0 ? `${lateTotal} late` : '',
    tone: lateTotal > 0 ? 'late' : list.total > 0 ? 'due' : 'none',
    href: list.href,
  }));
  if (approvals) {
    const n = toApproveCount(approvals);
    cues.unshift({
      key: 'approvals',
      label: 'To approve',
      count: n,
      sub: '',
      tone: n > 0 ? 'due' : 'none',
      href: '/approvals',
    });
  }
  cues.push(
    {
      key: 'waiting',
      label: 'Waiting',
      count: waitingCount,
      sub: '',
      tone: waitingCount > 0 ? 'due' : 'none',
      href: null,
    },
    { key: 'done_today', label: 'Done today', count: doneToday, sub: '', tone: 'none', href: null },
  );
  return cues;
}

/** One or two short sentences from the top facts, in block order. */
export function buildHeadline(
  lists: readonly ListWithLate[],
  approvals: ApprovalInboxResponse | null,
): DashText {
  const out: DashText = [];
  const toApprove = approvals ? toApproveCount(approvals) : 0;
  if (toApprove > 0)
    out.push({ text: `${plural(toApprove, 'document')} waiting for your approval. ` });

  const late = lists.find((l) => l.lateTotal > 0);
  const busy = late ?? lists.find((l) => l.list.total > 0);
  if (busy) {
    const first = busy.list.rows[0];
    const lead = late
      ? `${busy.lateTotal} late in ${busy.list.title}`
      : `${busy.list.total} in ${busy.list.title}`;
    out.push({ text: first ? `${lead} — oldest ` : `${lead}.` });
    if (first) {
      out.push({ code: first.docCode, href: first.docHref });
      out.push({ text: '.' });
    }
  }
  if (out.length === 0) out.push({ text: 'Nothing is waiting for you.' });
  return out;
}
