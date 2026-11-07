// Day Log History PDF (ADR-278): one date's part. Its header, its entries in full,
// under an entry what happened to it, oldest first, and the sign row.

import type { DayLogAdminReply, DayLogHistoryDay, DayLogHistoryEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { fmtStamp, istStamp, orderText, spanChanges, stopText } from './format';
import {
  cellsOn,
  editsOf,
  GRID,
  headRow,
  kindPrefix,
  SPAN,
  td,
  seenText,
  timesText,
  tr,
} from './print-history-cells';
import { dateHeaderRow, type HistoryPrintContext } from './print-history-header';
import { wordDiff } from './word-diff';

interface TimelineRow {
  action: string;
  at: string;
  /** Lines, plain text. */
  changed: string[];
  /** Ready HTML. */
  text: string;
}

function diffHtml(before: string, after: string): string {
  return wordDiff(before, after)
    .map((p) =>
      p.kind === 'del'
        ? `<del>${esc(p.text)}</del>`
        : p.kind === 'ins'
          ? `<ins>${esc(p.text)}</ins>`
          : esc(p.text),
    )
    .join('');
}

const changeLines = (
  b: Parameters<typeof spanChanges>[0],
  a: Parameters<typeof spanChanges>[1],
): string[] => spanChanges(b, a).map((c) => `${c.label} ${c.from} → ${c.to}`);

/** Characters that still fit a page in the Working On column (limit 2000 per text). */
const LONG_TEXT = 2000;

const NOT_CHANGED = '<i>Working On not changed</i>';

/** Every Entry Rev and reply of an entry merged by time, a waiting edit last. */
function timelineOf(e: DayLogHistoryEntry, person: string): TimelineRow[] {
  const oldestFirst = [...e.revisions].reverse();
  const revs: TimelineRow[] = oldestFirst.map((r, i) => {
    const prev = oldestFirst[i - 1];
    if (!prev) {
      const order = r.order ? ` · ${orderText(r.order)}` : '';
      return {
        action: `Entry Rev ${r.entryRevNo}${r.entryRevNo === 0 ? ' · First saved' : ''}`,
        at: r.savedAt,
        changed: [
          r.fromTime
            ? `Start ${fmt12(r.fromTime)} · Stop ${stopText(r.toTime)}${order}`
            : 'Times / SO not recorded',
        ],
        text: esc(r.description),
      };
    }
    const textChanged = prev.description !== r.description;
    const lines = [...(textChanged ? ['Working On'] : []), ...changeLines(prev, r)];
    return {
      action: `Entry Rev ${r.entryRevNo}${i === oldestFirst.length - 1 ? ' · Current' : ''}`,
      at: r.savedAt,
      changed: lines.length ? lines : [prev.fromTime ? 'No change' : 'Times / SO not recorded'],
      text: textChanged ? diffHtml(prev.description, r.description) : NOT_CHANGED,
    };
  });
  const merged = [...revs, ...e.replies.map((r) => replyRow(r, person))].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  if (!e.pending) return merged;
  const w = e.pending;
  const textChanged = w.description !== e.description;
  const lines = [...(textChanged ? ['Working On'] : []), ...changeLines(e, w)];
  return [
    ...merged,
    {
      action: 'Waiting approval',
      at: w.requestedAt,
      changed: lines.length ? lines : ['No change'],
      text: textChanged ? diffHtml(e.description, w.description) : NOT_CHANGED,
    },
  ];
}

function replyRow(r: DayLogAdminReply, person: string): TimelineRow {
  return {
    action: `Reply · ${r.authorName}`,
    at: r.sentAt,
    changed: [seenText(r, person), ...(r.editedAt ? [`Edited ${fmtStamp(r.editedAt)}`] : [])],
    text: esc(r.body),
  };
}

/** The small heading + rows; `key` carries the heading onto a new page. */
function timelineRows(items: readonly TimelineRow[], dayKey: string, key: string): string {
  const spans = SPAN.timeline;
  const head = tr(
    cellsOn(spans, ['', 'Action', 'Date and time', 'What changed', 'Working On at that time']),
    { cls: 'tlh', keepNext: true, headFor: key, carry: dayKey },
  );
  const carry = `${dayKey} ${key}`;
  const rows = items.map((t) => {
    // A row never splits, and a full rewrite in the narrow column is taller than
    // a page and would be cut off: its text takes the full width on its own row.
    const long = t.text.replace(/<[^>]+>/g, '').length > LONG_TEXT;
    const facts = cellsOn(spans, [
      '',
      esc(t.action),
      esc(fmtStamp(t.at)),
      t.changed.map(esc).join('<br>'),
      long ? 'Below' : [t.text, 'wo'],
    ]);
    const first = spans[0];
    return long
      ? tr(facts, { cls: 'tl', keepNext: true, carry }) +
          tr(td(first, '') + td(GRID - first, t.text, 'wo'), { cls: 'tl', carry })
      : tr(facts, { cls: 'tl', carry });
  });
  return head + rows.join('');
}

function entryRows(e: DayLogHistoryEntry, dayKey: string, person: string): string {
  const logged = istStamp(e.loggedAt);
  const edits = editsOf(e);
  const flag = edits > 0 ? `<b>[Edited ${timesText(edits)}]</b> ` : '';
  const timeline = edits > 0 || e.replies.length > 0 || e.pending ? timelineOf(e, person) : [];
  const row = tr(
    cellsOn(SPAN.day, [
      [String(e.srNo), 'b'],
      esc(fmt12(e.fromTime)),
      esc(stopText(e.toTime)),
      [esc(fmtDuration(e.minutes)), 'r'],
      [esc(orderText(e.order)), 'b'],
      esc(logged.date),
      esc(logged.time),
      [`${flag}${kindPrefix(e.kind)}${esc(e.description)}`, 'wo'],
    ]),
    {
      cls: e.kind === 'work' ? undefined : 'nw',
      keepNext: timeline.length > 0,
      carry: dayKey,
    },
  );
  return row + (timeline.length ? timelineRows(timeline, dayKey, `tl-${e.id}`) : '');
}

export function dayRows(d: DayLogHistoryDay, ctx: HistoryPrintContext): string {
  const dayKey = `day-${d.date}`;
  const replies = d.dayReplies.length
    ? timelineRows(
        d.dayReplies.map((r) => replyRow(r, ctx.person)),
        dayKey,
        `tl-${d.date}`,
      )
    : '';
  const head =
    d.entries.length === 0
      ? ''
      : tr(
          headRow(
            SPAN.day,
            [
              'Sr No',
              'Start Time',
              'Stop Time',
              'Working Hours',
              'SO / JWSO',
              'Log Date',
              'Log Time',
              'Working On',
            ],
            ['Working Hours'],
          ),
          { cls: 'hd', keepNext: true, headFor: dayKey },
        );
  const sign = tr(
    td(GRID / 2, `Logged by: ${esc(ctx.person)}`) + td(GRID / 2, 'Seen by (Department Admin):'),
    { cls: 'sign', carry: dayKey },
  );
  return (
    dateHeaderRow(d, dayKey, ctx) +
    head +
    d.entries.map((e) => entryRows(e, dayKey, ctx.person)).join('') +
    replies +
    sign
  );
}
