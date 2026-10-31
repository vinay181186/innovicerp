// ADR-264 — the bell in the top bar, on every page. Red badge = unread events
// (the server's `unread`, whatever the filter). Click → popover: Notifications,
// Mark all as read, All | Unread (n), the newest NOTIFICATION_POPOVER_LIMIT
// items, View all notifications (→ /?view=notifications).
//
// Close behaviour is the row ⋯ menu's (ui/data/RowMenu.tsx): a mousedown
// outside the button and the popover closes it; Esc (window capture, so a
// dialog underneath does not also close) closes it and puts focus back on the
// bell. Opening moves focus into the popover.

import { NOTIFICATION_POPOVER_LIMIT, type NotificationFilter } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/ui/core';
import { useMarkAllNotificationsRead, useNotifications } from '../api';
import '../home.css';
import '../notifications.css';
import { NotificationRow, useOpenNotification } from './notification-row';

/** The newest event in the bell's own list (filter All) — what "Mark all as
 *  read" sends as `upTo`, so a later event stays unread. Shared by the bell and
 *  All notifications (same query key, one request). */
export function useMarkAllShown() {
  const all = useNotifications('all', NOTIFICATION_POPOVER_LIMIT);
  const markAll = useMarkAllNotificationsRead();
  const newest = all.data?.items.reduce<string | null>(
    (max, n) => (max == null || Date.parse(n.ts) > Date.parse(max) ? n.ts : max),
    null,
  );
  return {
    all,
    disabled: newest == null || (all.data?.unread ?? 0) === 0 || markAll.isPending,
    run: (): void => {
      if (newest) markAll.mutate({ upTo: new Date(newest).toISOString() });
    },
  };
}

export function NotificationBell(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Exclude<NotificationFilter, 'read'>>('all');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const markAll = useMarkAllShown();
  const unreadList = useNotifications(
    'unread',
    NOTIFICATION_POPOVER_LIMIT,
    open && filter === 'unread',
  );
  const unread = markAll.all.data?.unread ?? 0;
  const list = filter === 'unread' ? unreadList : markAll.all;

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);
  const openItem = useOpenNotification(() => close());

  useEffect(() => {
    if (!open) return undefined;
    popRef.current?.querySelector<HTMLElement>('button')?.focus();
    const inside = (): boolean => popRef.current?.contains(document.activeElement) ?? false;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close(inside());
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const items = list.data?.items ?? [];
  let body: React.ReactNode;
  if (list.isError && !list.data) {
    body = <div className="nb-empty">Could not load notifications. Try again.</div>;
  } else if (!list.data) {
    body = <div className="nb-empty">⟳ Loading…</div>;
  } else if (items.length === 0) {
    body = (
      <div className="nb-empty">
        {filter === 'unread' ? 'No unread notifications.' : 'No notifications.'}
      </div>
    );
  } else {
    body = items.map((n) => <NotificationRow key={n.key} n={n} onOpen={openItem} />);
  }

  return (
    <div className="nb">
      <button
        ref={btnRef}
        type="button"
        className="nb-btn"
        title="Notifications"
        aria-label={`Notifications, ${unread} unread`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={16} />
        {unread > 0 ? (
          <span className="nb-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div ref={popRef} className="nb-pop" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <h2>Notifications</h2>
            <button
              type="button"
              className="dh-textbtn"
              disabled={markAll.disabled}
              onClick={markAll.run}
            >
              Mark all as read
            </button>
          </div>
          <div className="dh-chips nb-chips" role="group" aria-label="Filter notifications">
            <button
              type="button"
              className="dh-chip"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className="dh-chip"
              aria-pressed={filter === 'unread'}
              onClick={() => setFilter('unread')}
            >
              Unread ({unread})
            </button>
          </div>
          <div className="nb-list">{body}</div>
          <button
            type="button"
            className="nb-all"
            onClick={() => {
              close();
              void navigate({ to: '/', search: { view: 'notifications' } });
            }}
          >
            View all notifications
          </button>
        </div>
      ) : null}
    </div>
  );
}
