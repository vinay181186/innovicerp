// ADR-264 — one notification: initials circle · text (document codes through
// DashTextView → ActionLink fallback="text") · relative time · blue dot while
// unread. Clicking the row marks it read and opens its document; the bell and
// All notifications share this row and the click rule (useOpenNotification).

import type { NotificationItem } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCanOpen } from '@/components/shared/action-link';
import { useMarkNotificationsRead } from '../api';
import { firstHref, initials, relTime } from '../notify-format';
import { DashTextView, linkProps } from './dash-text';

/** Mark the item read (when unread) and open its first document link (when
 *  the caller may open that page). A click ON a link inside the text lets the
 *  link navigate itself. */
export function useOpenNotification(after?: () => void) {
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();
  const canOpen = useCanOpen();
  return (n: NotificationItem, onLink: boolean): void => {
    if (!n.read) mark.mutate({ items: [{ key: n.key, ts: n.ts }], read: true });
    const href = firstHref(n.text);
    if (!onLink && href && canOpen(href)) void navigate(linkProps(href));
    after?.();
  };
}

export function NotificationRow({
  n,
  onOpen,
  page = false,
  right,
}: {
  n: NotificationItem;
  /** `onLink`: the click landed on a document link inside the text. */
  onOpen: (n: NotificationItem, onLink: boolean) => void;
  page?: boolean;
  right?: React.ReactNode;
}): React.JSX.Element {
  const unread = !n.read;
  return (
    <div className={`nr${unread ? ' nr-unread' : ''}${page ? ' nr-page' : ''}`}>
      <span className={`nr-av t-${n.tone}`} aria-hidden="true" title={n.actorName ?? undefined}>
        {initials(n.actorName)}
      </span>
      {/* The row's own click target; the document code inside stays a real
          link (a link inside a <button> is invalid HTML). */}
      <div
        className="nr-body nr-open"
        role="button"
        tabIndex={0}
        onClick={(e) => onOpen(n, (e.target as Element).closest('a') != null)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen(n, false);
          }
        }}
      >
        {/* The server's text is the whole sentence (actor included, as on the
            ADR-250 home); actorName feeds only the initials circle. */}
        <span className="nr-text">
          <DashTextView text={n.text} />
        </span>
        <span className="nr-time">{relTime(n.ts)}</span>
      </div>
      {unread ? <span className="nr-dot" aria-label="Unread" role="img" /> : null}
      {right}
    </div>
  );
}
