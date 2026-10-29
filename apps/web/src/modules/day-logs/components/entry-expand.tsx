// My Day Log — what ▸ opens under a saved entry (ADR-255): the full Working On
// text (or one of the two edit forms), the "⏳ times / SO edit waiting" or
// "Edit rejected" line, and the Super Admin replies under it
// ("💬 Reply from <author> · dd-mm-yyyy hh:mm AM · edited hh:mm AM").
// Opening an entry that has unread replies marks them seen — once per open.

import type { DayLogEntry } from '@innovic/shared';
import { useEffect, useRef } from 'react';
import { useMarkDayLogRepliesSeen, type DayQuery } from '../api';
import { fmtStamp, istStamp } from '../lib/format';
import { spanText } from '../lib/sheet';
import { EditTimesForm, EditWorkForm } from './entry-edit';

export type EntryMode = 'view' | 'work' | 'times';

/** The id of an entry's ▸ area — `?line=` scrolls it into view. */
export function entryAreaId(entryId: string): string {
  return `dl-entry-${entryId}`;
}

function ApprovalLines({ e }: { e: DayLogEntry }): React.JSX.Element | null {
  const p = e.pending;
  if (p) {
    return (
      <div className="dl-small fw-700 dl-orange">
        ⏳ Times / SO edit waiting for approval → {spanText(p.fromTime, p.toTime)}
        {p.order ? ` · ${p.order.code}` : ''}
      </div>
    );
  }
  if (e.rejectReason) {
    return <div className="dl-small fw-700 dl-orange">Edit rejected: {e.rejectReason}</div>;
  }
  return null;
}

function Replies({ e }: { e: DayLogEntry }): React.JSX.Element | null {
  if (e.replies.length === 0) return null;
  return (
    <>
      {e.replies.map((r) => (
        <div key={r.id} className="dl-reply">
          <span className="dl-reply-h">
            💬 Reply from {r.authorName} · {fmtStamp(r.sentAt)}
            {r.editedAt ? ` · edited ${istStamp(r.editedAt).time}` : ''}
          </span>
          {r.body}
        </div>
      ))}
    </>
  );
}

export function EntryExpand({
  e,
  q,
  mode,
  isOwner,
  nowMin,
  onMode,
  onTimesSent,
}: {
  e: DayLogEntry;
  q: DayQuery;
  mode: EntryMode;
  /** The signed-in user's own day — only then does opening mark replies seen. */
  isOwner: boolean;
  nowMin: number | null;
  onMode: (m: EntryMode) => void;
  onTimesSent: () => void;
}): React.JSX.Element {
  const markSeen = useMarkDayLogRepliesSeen();
  const unread = e.replies.some((r) => r.unread);
  // Once per open (and again only if a NEW unread reply arrives while open).
  const sentFor = useRef<string | null>(null);
  const unreadKey = e.replies
    .filter((r) => r.unread)
    .map((r) => `${r.id}:${r.editedAt ?? ''}`)
    .join(',');
  const { mutate } = markSeen;
  useEffect(() => {
    if (!isOwner || !unread || sentFor.current === unreadKey) return;
    sentFor.current = unreadKey;
    mutate(e.id);
  }, [isOwner, unread, unreadKey, e.id, mutate]);

  return (
    <div id={entryAreaId(e.id)} className="dl-expand">
      {mode === 'work' ? (
        <EditWorkForm e={e} q={q} onDone={() => onMode('view')} />
      ) : mode === 'times' ? (
        <EditTimesForm
          e={e}
          q={q}
          nowMin={nowMin}
          onSent={onTimesSent}
          onCancel={() => onMode('view')}
        />
      ) : (
        <>
          <span className="dl-xl">Working On</span>
          <div className="dl-full">{e.description}</div>
        </>
      )}
      {mode !== 'times' ? <ApprovalLines e={e} /> : null}
      <Replies e={e} />
    </div>
  );
}
