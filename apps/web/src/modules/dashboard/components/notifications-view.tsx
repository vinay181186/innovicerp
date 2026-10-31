// ADR-262 — All notifications (behind the bell's "View all notifications"):
// All | Unread | Read with counts, Mark all as read, items grouped Today /
// Yesterday / Earlier (IST), each with Mark as read / Mark as unread.

import {
  NOTIFICATION_DAYS,
  NOTIFICATION_PAGE_LIMIT,
  type NotificationFilter,
  type NotificationItem,
} from '@innovic/shared';
import { useState } from 'react';
import { PageState } from '@/ui/layout';
import { useMarkNotificationsRead, useNotifications } from '../api';
import { dayGroup, type DayGroup } from '../notify-format';
import { useMarkAllShown } from './notification-bell';
import { NotificationRow, useOpenNotification } from './notification-row';
import { ViewHead } from './view-head';

const GROUPS: DayGroup[] = ['Today', 'Yesterday', 'Earlier'];
const FILTERS: ReadonlyArray<{ key: NotificationFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
];

export function NotificationsView(): React.JSX.Element {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const list = useNotifications(filter, NOTIFICATION_PAGE_LIMIT);
  const markAll = useMarkAllShown();
  const mark = useMarkNotificationsRead();
  const openItem = useOpenNotification();
  const busyKey = mark.isPending ? mark.variables?.items[0]?.key : undefined;

  const d = list.data;
  const counts: Record<NotificationFilter, number | null> = {
    all: d ? d.total : null,
    unread: d ? d.unread : null,
    read: d ? Math.max(0, d.total - d.unread) : null,
  };

  const flip = (n: NotificationItem): void =>
    mark.mutate({ items: [{ key: n.key, ts: n.ts }], read: !n.read });

  let body: React.ReactNode;
  if (list.isError && !d) {
    body = <PageState state="error" message="Could not load notifications. Try again." />;
  } else if (!d) {
    body = <PageState state="loading" />;
  } else if (d.items.length === 0) {
    body = (
      <PageState
        state="empty"
        message={
          filter === 'unread'
            ? 'No unread notifications.'
            : filter === 'read'
              ? 'No read notifications.'
              : 'No notifications.'
        }
      />
    );
  } else {
    body = GROUPS.map((g) => {
      const items = d.items.filter((n) => dayGroup(n.ts) === g);
      if (items.length === 0) return null;
      return (
        <section key={g} aria-label={g}>
          <div className="dh-dayhead">{g}</div>
          {items.map((n) => (
            <NotificationRow
              key={n.key}
              n={n}
              page
              onOpen={openItem}
              right={
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyKey === n.key}
                  onClick={() => flip(n)}
                >
                  {n.read ? 'Mark as unread' : 'Mark as read'}
                </button>
              }
            />
          ))}
        </section>
      );
    });
  }

  return (
    <>
      <ViewHead title="All notifications" hint={`Last ${NOTIFICATION_DAYS} days`}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={markAll.disabled}
          onClick={markAll.run}
        >
          Mark all as read
        </button>
      </ViewHead>
      <div className="dh-body" style={{ paddingBottom: 0 }}>
        <div className="dh-chips" role="group" aria-label="Filter notifications">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="dh-chip"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {counts[f.key] == null ? '' : ` (${counts[f.key]})`}
            </button>
          ))}
        </div>
      </div>
      <div>{body}</div>
    </>
  );
}
