// ADR-273: the Super Admin's Day Log replies on a task, oldest first — the same
// words as the Team Day Logs replies pane (day-logs/components/person-replies).
// Used by the Task Board row's ▸ and the task detail. The Seen line is for the
// sender's side only; the person the reply went to does not get it.

import type { TaskDayLogReply } from '@innovic/shared';
import { fmtStamp } from '@/modules/day-logs/lib/format';
import '@/modules/day-logs/day-log-sheet.css';

export function TaskDayLogReplies({
  replies,
  first,
  showSeen,
}: {
  replies: readonly TaskDayLogReply[];
  /** First name of the person the replies went to. */
  first: string;
  showSeen: boolean;
}): React.JSX.Element {
  return (
    <>
      {replies.map((r, i) => (
        <div key={r.id} className="dl-reply">
          <span className="dl-reply-h">
            Reply {i + 1} · {r.authorName} · {fmtStamp(r.sentAt)}
            {r.editedAt ? ` · edited ${fmtStamp(r.editedAt)}` : ''}
          </span>
          {r.body}
          {showSeen ? (
            <span className={r.seenAt ? 'dl-seen dl-green' : 'dl-seen dl-orange'}>
              {r.seenAt ? `✓ Seen by ${first} · ${fmtStamp(r.seenAt)}` : '● Not seen yet'}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}
