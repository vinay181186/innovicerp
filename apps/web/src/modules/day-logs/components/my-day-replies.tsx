// My Day Log — "Replies on this day": a Super Admin's replies sent while the day
// had no entries, above the table. Opening the date marks unread ones seen, once
// per open (and again only if a NEW unread reply arrives), like entry-expand.tsx.

import type { DayLogDetail } from '@innovic/shared';
import { useEffect, useRef } from 'react';
import { useMarkDayLogDayRepliesSeen } from '../reply-api';
import { fmtStamp } from '../lib/format';

export function MyDayReplies({ day }: { day: DayLogDetail }): React.JSX.Element | null {
  const { mutate } = useMarkDayLogDayRepliesSeen();
  const sentFor = useRef<string | null>(null);
  const unreadKey = day.dayReplies
    .filter((r) => r.unread)
    .map((r) => `${r.id}:${r.editedAt ?? ''}`)
    .join(',');
  useEffect(() => {
    if (!day.isOwner || !unreadKey || sentFor.current === unreadKey) return;
    sentFor.current = unreadKey;
    mutate(day.date);
  }, [day.isOwner, day.date, unreadKey, mutate]);

  if (day.dayReplies.length === 0) return null;
  return (
    <div className="dl-daypane">
      <div className="dl-sec-h">Replies on this day</div>
      {day.dayReplies.map((r) => (
        <div key={r.id} className="dl-reply">
          <span className="dl-reply-h">
            Reply from {r.authorName} · {fmtStamp(r.sentAt)}
            {r.editedAt ? ' · edited' : ''}
          </span>
          {r.body}
        </div>
      ))}
    </div>
  );
}
