// Day Log History PDF (ADR-278): the Day detail part. One date: its band, its
// entries in full, and under an entry what happened to it, oldest first.

import type { DayLogAdminReply, DayLogHistoryDay, DayLogHistoryEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { esc } from '@/lib/print/doc-print';
import { fmtStamp, istStamp, orderText, spanChanges, stopText, weekdayName } from './format';
import {
  cellsOn,
  dateAnchor,
  editsOf,
  entryAnchor,
  GRID,
  headRow,
  SPAN,
  statusText,
  td,
  seenText,
  timesText,
  tr,
} from './print-history-cells';
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
  const rows = items.map((t) =>
    tr(
      cellsOn(spans, [
        '',
        esc(t.action),
        esc(fmtStamp(t.at)),
        t.changed.map(esc).join('<br>'),
        [t.text, 'wo'],
      ]),
      { cls: 'tl', carry: `${dayKey} ${key}` },
    ),
  );
  return head + rows.join('');
}

function entryRows(e: DayLogHistoryEntry, dayKey: string, person: string): string {
  const logged = istStamp(e.loggedAt);
  const edits = editsOf(e);
  const flag = edits > 0 ? `<b>[Edited ${timesText(edits)}]</b> ` : '';
  const others = e.kind === 'leave' ? 'Others · ' : e.kind === 'break' ? 'Break · ' : '';
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
      [`${flag}${others}${esc(e.description)}`, 'wo'],
    ]),
    {
      cls: e.kind === 'work' ? undefined : 'nw',
      keepNext: timeline.length > 0,
      carry: dayKey,
      anchor: entryAnchor(e.id),
    },
  );
  return row + (timeline.length ? timelineRows(timeline, dayKey, `tl-${e.id}`) : '');
}

export function dayRows(d: DayLogHistoryDay, person: string): string {
  const dayKey = `day-${d.date}`;
  const replies = d.dayReplies.length
    ? timelineRows(
        d.dayReplies.map((r) => replyRow(r, person)),
        dayKey,
        `tl-${d.date}`,
      )
    : '';
  const title = `${fmtDate(d.date)} · ${weekdayName(d.date)}`;
  const opts = {
    cls: 'band',
    headFor: dayKey,
    contd: true,
    anchor: dateAnchor(d.date),
  };
  if (d.entries.length === 0) {
    const band = tr(td(GRID, esc(`${title} · ${statusText(d)}`)), {
      ...opts,
      keepNext: replies !== '',
    });
    return band + replies;
  }
  const word = d.state === 'filled' ? '' : ` · ${statusText(d)}`;
  const facts = [
    `First start ${fmt12(d.firstStart)}`,
    `Last stop ${fmt12(d.lastStop)}`,
    `Working hours ${fmtDuration(d.workMin)}`,
    `Entries ${d.entryCount}`,
    ...(d.edits > 0 ? [`Edits ${d.edits}`] : []),
    ...(d.replies > 0 ? [`Replies ${d.replies}`] : []),
  ].join(' · ');
  const band = tr(td(GRID, `${esc(title + word)}<div class="facts">${esc(facts)}</div>`), {
    ...opts,
    keepNext: true,
  });
  const head = tr(
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
  return band + head + d.entries.map((e) => entryRows(e, dayKey, person)).join('') + replies;
}
