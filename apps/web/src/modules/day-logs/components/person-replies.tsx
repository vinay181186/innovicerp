// Team Day Logs › a person — Super Admin's RIGHT pane under an entry (ADR-255):
// "Replies to <first name> (n)". Each reply: number, author, when, "edited
// <when>", ✎ to edit it in place (Save off while unchanged), and "● Not seen
// yet" (orange) or "✓ Seen by <first name> · <when>" (green). Then the Reply
// box + "Send reply" (off while empty). One click = one send / one save: each
// form owns one Idempotency-Key (useSaveKey, ADR-172); an edit carries the
// reply's updatedAt (§20.4).

import type { DayLogAdminReply } from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useEditDayLogReply, useSendDayLogReply } from '../api';
import { errText, fmtStamp } from '../lib/format';
import { RowError } from './work-line';

function ReplyEdit({ r, onDone }: { r: DayLogAdminReply; onDone: () => void }): React.JSX.Element {
  const saveKey = useSaveKey();
  const edit = useEditDayLogReply(saveKey);
  const [body, setBody] = useState(r.body);
  const [loadedAt] = useState(r.updatedAt);
  const [err, setErr] = useState<string | null>(null);
  const text = body.trim();
  const off = !text || text === r.body.trim();

  async function save(): Promise<void> {
    if (edit.isPending || off) return;
    setErr(null);
    try {
      await edit.mutateAsync({ replyId: r.id, body: text, updatedAt: loadedAt });
      onDone();
    } catch (x) {
      setErr(errText(x));
    }
  }

  return (
    <>
      <textarea
        className="innovic-textarea dl-rbox"
        aria-label="Edit reply"
        rows={2}
        maxLength={2000}
        value={body}
        disabled={edit.isPending}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="dl-btns">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={edit.isPending || off}
          onClick={() => void save()}
        >
          {edit.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={edit.isPending}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
      {err ? <RowError text={err} /> : null}
    </>
  );
}

function SendBox({ entryId, first }: { entryId: string; first: string }): React.JSX.Element {
  const saveKey = useSaveKey();
  const send = useSendDayLogReply(saveKey);
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const text = body.trim();

  async function go(): Promise<void> {
    if (send.isPending || !text) return;
    setErr(null);
    try {
      await send.mutateAsync({ entryId, body: text });
      setBody('');
    } catch (x) {
      setErr(errText(x));
    }
  }

  return (
    <>
      <label className="dl-xl" htmlFor={`dl-reply-${entryId}`}>
        Reply
      </label>
      <textarea
        id={`dl-reply-${entryId}`}
        className="innovic-textarea dl-rbox"
        rows={2}
        maxLength={2000}
        placeholder={`Write to ${first} about this entry…`}
        value={body}
        disabled={send.isPending}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="dl-btns">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={send.isPending || !text}
          onClick={() => void go()}
        >
          {send.isPending ? 'Sending…' : 'Send reply'}
        </button>
        <span className="text3 dl-small">{first} gets a 🔔 notification.</span>
      </div>
      {err ? <RowError text={err} /> : null}
    </>
  );
}

export function PersonReplies({
  entryId,
  replies,
  first,
}: {
  entryId: string;
  /** Oldest first. */
  replies: readonly DayLogAdminReply[];
  /** The person's first name. */
  first: string;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="dl-pane">
      <div className="dl-sec-h">
        Replies to {first} ({replies.length})
      </div>
      {replies.length === 0 ? <div className="text3 dl-small">No reply yet.</div> : null}
      {replies.map((r, i) => (
        <div key={r.id} className="dl-reply">
          {editing === r.id ? (
            <>
              <span className="dl-reply-h">Edit reply {i + 1}</span>
              <ReplyEdit r={r} onDone={() => setEditing(null)} />
            </>
          ) : (
            <>
              <span className="dl-reply-h dl-reply-hrow">
                <span>
                  Reply {i + 1} · {r.authorName} · {fmtStamp(r.sentAt)}
                  {r.editedAt ? ` · edited ${fmtStamp(r.editedAt)}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm dl-icon"
                  title="Edit this reply"
                  aria-label={`Edit reply ${i + 1}`}
                  onClick={() => setEditing(r.id)}
                >
                  ✎
                </button>
              </span>
              {r.body}
              <span className={r.seenAt ? 'dl-seen dl-green' : 'dl-seen dl-orange'}>
                {r.seenAt ? `✓ Seen by ${first} · ${fmtStamp(r.seenAt)}` : '● Not seen yet'}
              </span>
            </>
          )}
        </div>
      ))}
      <SendBox entryId={entryId} first={first} />
    </div>
  );
}
