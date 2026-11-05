// Pending Entries › a person (owner 2026-11-05, Option D): a pop-up with the
// person's calendar, green = filled, red = pending, and the picked date beside it.
// A red date: the Reply box on the blank day. A green date: the entries, and the
// reply under an entry. Both are the person page's own reply panes, so what a reply
// does is decided in one place. The server sends the dates (§6.1); the screen only
// draws them. An old Leave day, a Sunday, a holiday and today are not clickable.

import type { DayLogPersonDayEntry } from '@innovic/shared';
import { isWorkingDay } from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate } from '@/lib/date';
import { ExitConfirmDialog } from '@/lib/exit-guard';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Modal } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { usePendingCalendar, usePersonDay } from '../api';
import { errText, firstName, shiftDate, weekday } from '../lib/format';
import { sortEntries } from '../lib/sheet';
import { personDayColumns } from './person-day-logs';
import { DayReplies, PersonReplies } from './person-replies';
import '../day-log-sheet.css';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** One month's move: 'YYYY-MM' ± n. */
function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const monthName = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Text typed in a reply box and not sent yet. The boxes own their text and clear
 *  it on send, so the pop-up reads them at the moment it is about to throw them away. */
const hasUnsent = (root: HTMLElement | null): boolean =>
  Array.from(root?.querySelectorAll('textarea') ?? []).some((t) => t.value.trim() !== '');

const ENTRY_COLUMNS = personDayColumns().filter((c) =>
  ['srNo', 'start', 'stop', 'hours', 'order', 'work'].includes(c.id ?? ''),
);

function PickedDay({
  userId,
  date,
  filled,
}: {
  userId: string;
  date: string;
  /** As the calendar says, so the cell and this pane never disagree. */
  filled: boolean;
}): React.JSX.Element {
  const query = usePersonDay(userId, date);
  // A Set, as on the person page: opening a second entry keeps a reply being typed.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const p = query.data;
  // A read of the previous date never stands in for this one.
  if (!p || p.date !== date) {
    return query.isError ? (
      <PageState state="error" message={errText(query.error, 'Could not load this date.')} />
    ) : (
      <PageState state="loading" />
    );
  }
  const toggle = (id: string): void =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <div className="dl-cal-day">
        {fmtDate(date)} · {weekday(date)}
        <span className={filled ? 'badge dl-cal-filled' : 'badge dl-cal-pending'}>
          {filled ? 'Filled' : 'Pending'}
        </span>
      </div>
      {filled ? (
        <>
          <DataTable<DayLogPersonDayEntry>
            tableKey={TABLE_KEYS.dayLogCalendarDay}
            wrapClassName="dl-fit"
            columns={ENTRY_COLUMNS}
            rows={sortEntries(p.entries)}
            empty="No timed entry on this date."
            onRowClick={(r) => toggle(r.id)}
            onToggleExpanded={(r) => toggle(r.id)}
            renderExpanded={(r) =>
              open.has(r.id) ? (
                <div className="dl-expand">
                  <div className="dl-full">{r.description}</div>
                  {p.canReply ? (
                    <PersonReplies
                      entryId={r.id}
                      replies={r.replies}
                      first={firstName(p.userName)}
                      goesToInbox={p.replyGoesToInbox}
                    />
                  ) : null}
                </div>
              ) : null
            }
          />
          <div className="text3 dl-small dl-cal-hint">Click an entry to reply on it.</div>
        </>
      ) : (
        <div className="text3 dl-small dl-cal-hint">No entry on this date.</div>
      )}
      {p.canReplyDay || p.dayReplies.length > 0 ? <DayReplies key={p.date} p={p} /> : null}
    </>
  );
}

export function PendingCalendar({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}): React.JSX.Element {
  const query = usePendingCalendar(userId);
  const [picked, setPicked] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  /** What to do once "Are you sure you want to exit?" is answered Exit. */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusPicked = useRef(false);
  const focusBack = useRef<HTMLElement | null>(null);
  const c = query.data;
  const oldest = c?.pending[0] ?? null;

  // Opens on the oldest pending date, once: a later save never moves the pick.
  useEffect(() => {
    if (!oldest) return;
    setPicked((p) => p ?? oldest);
    setMonth((m) => m ?? oldest.slice(0, 7));
  }, [oldest]);

  // An arrow key moves the pick; focus follows it, into the next month too.
  useEffect(() => {
    if (!focusPicked.current) return;
    focusPicked.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${picked}"]`)?.focus();
  }, [picked, month]);

  const guarded = (go: () => void): void => {
    if (!hasUnsent(bodyRef.current)) return go();
    focusBack.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLeaving(() => go);
  };
  /** Stay: focus goes back into the pop-up, or Tab would walk the page behind it. */
  const stay = (): void => {
    setLeaving(null);
    focusBack.current?.focus();
  };

  const title = c ? (c.deptLabel ? `${c.userName} · ${c.deptLabel}` : c.userName) : 'Day Log';
  const close = (): void => {
    // Esc while the question is up means "stay", as on every pop-up.
    if (leaving) stay();
    else guarded(onClose);
  };

  let body: React.JSX.Element;
  if (!c) {
    body = query.isError ? (
      <PageState state="error" message={errText(query.error, 'Could not load the calendar.')} />
    ) : (
      <PageState state="loading" />
    );
  } else {
    const shown = month ?? c.today.slice(0, 7);
    const filled = new Set(c.filled);
    const pending = new Set(c.pending);
    const replied = new Set(c.replied);
    const first = `${shown}-01`;
    const count = new Date(
      Date.UTC(Number(shown.slice(0, 4)), Number(shown.slice(5, 7)), 0),
    ).getUTCDate();
    const blanks = new Date(`${first}T00:00:00Z`).getUTCDay();
    const pick = (date: string, focus = false): void => {
      if (date === picked) return;
      guarded(() => {
        focusPicked.current = focus;
        setPicked(date);
        setMonth(date.slice(0, 7));
      });
    };
    const onArrow = (e: React.KeyboardEvent): void => {
      const step = ARROWS[e.key];
      const from = (e.target as HTMLElement).dataset['date'] ?? picked;
      if (!step || !from) return;
      e.preventDefault();
      const start = `${c.firstMonth}-01`;
      for (let d = shiftDate(from, step); d >= start && d <= c.today; d = shiftDate(d, step)) {
        if (filled.has(d) || pending.has(d)) return pick(d, true);
      }
    };
    const cell = (date: string): { cls: string; word: string } => {
      if (filled.has(date)) return { cls: 'filled', word: 'Filled' };
      if (pending.has(date)) return { cls: 'pending', word: 'Pending' };
      if (date === c.today) return { cls: 'today', word: 'Today' };
      if (date > c.today) return { cls: 'none', word: 'Not yet' };
      if (!isWorkingDay(date, c.holidays)) return { cls: 'off', word: 'Sunday or holiday' };
      return { cls: 'none', word: 'Not counted' };
    };
    body = (
      <div className="dl-cal-wrap" ref={bodyRef}>
        <div className="dl-cal">
          <div className="dl-cal-head">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Previous month"
              disabled={shown <= c.firstMonth}
              onClick={() => setMonth(shiftMonth(shown, -1))}
            >
              ‹
            </button>
            <span>{monthName(shown)}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Next month"
              disabled={shown >= c.today.slice(0, 7)}
              onClick={() => setMonth(shiftMonth(shown, 1))}
            >
              ›
            </button>
          </div>
          <div className="dl-cal-grid dl-cal-week">
            {WEEK.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="dl-cal-grid" ref={gridRef} onKeyDown={onArrow}>
            {Array.from({ length: blanks }, (_, i) => (
              <span key={i} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const day = i + 1;
              const date = `${shown}-${String(day).padStart(2, '0')}`;
              const { cls, word } = cell(date);
              const can = cls === 'filled' || cls === 'pending';
              return (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  className={`dl-cal-cell ${cls}${date === picked ? ' on' : ''}`}
                  disabled={!can}
                  aria-pressed={date === picked}
                  aria-label={`${fmtDate(date)} ${word}`}
                  title={`${fmtDate(date)} · ${weekday(date)} · ${word}`}
                  onClick={() => pick(date)}
                >
                  {day}
                  {replied.has(date) ? <span className="dl-cal-dot" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          <div className="dl-cal-count">
            <span className="dl-cal-red">{c.pending.length} pending</span> ·{' '}
            <span className="dl-cal-green">{c.filled.length} filled</span>
          </div>
          <div className="dl-cal-legend">
            <span>
              <i className="dl-cal-key filled" />
              Filled
            </span>
            <span>
              <i className="dl-cal-key pending" />
              Pending
            </span>
            <span>
              <i className="dl-cal-key off" />
              Sunday / holiday
            </span>
            <span>
              <i className="dl-cal-dot dl-cal-key-dot" />
              Replied
            </span>
          </div>
        </div>
        <div className="dl-cal-side">
          {picked ? (
            <PickedDay key={picked} userId={userId} date={picked} filled={filled.has(picked)} />
          ) : (
            <div className="text3 dl-small">Click a green or red date.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Modal title={title} onClose={close} confirmExit={false}>
        {body}
      </Modal>
      {leaving
        ? createPortal(
            <ExitConfirmDialog
              onStay={stay}
              onExit={() => {
                const go = leaving;
                setLeaving(null);
                go();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}
