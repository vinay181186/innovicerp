// Team Day Logs › a person — the Super Admin's replies pane: "Replies to <first
// name> (n)". Each reply: number, author, when, "edited <when>", ✎ to edit it in
// place (Save off while unchanged), and "● Not seen yet" (orange) or "✓ Seen by
// <first name> · <when>" (green). Then the Reply box + "Send reply" (off while
// empty). One click = one send / one save: each form owns one Idempotency-Key
// (useSaveKey, ADR-172); an edit carries the reply's updatedAt (§20.4).
// One UI for both kinds of reply: PersonReplies (RIGHT pane under an entry,
// ADR-255) and DayReplies (on a blank day, owner 2026-11-05) only say what Send
// and Save call.

import { Icon } from '@/ui/core';
import type { DayLogAdminReply, DayLogPersonDay } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { type SaveKey, useSaveKey } from '@/lib/use-save-key';
import {
  useEditDayLogDayReply,
  useEditDayLogReply,
  useSendDayLogDayReply,
  useSendDayLogReply,
} from '../reply-api';
import { errText, firstName, fmtStamp } from '../lib/format';
import { RowError } from './work-line';
import { useToast } from '@/ui/feedback';

type OnSend = (body: string, saveKey: SaveKey) => Promise<unknown>;
type OnEdit = (
  r: DayLogAdminReply,
  body: string,
  updatedAt: string,
  key: SaveKey,
) => Promise<unknown>;

/** The words beside Send reply. goesToInbox comes from the server (ADR-273, §20.5). */
function sendHint(first: string, goesToInbox: boolean, inboxTail = ''): string {
  return goesToInbox
    ? `${first} gets a 🔔 and a task in Inbox${inboxTail}.`
    : `${first} gets a 🔔 only. Task Board is hidden for ${first}.`;
}

function ReplyEdit({
  r,
  onEdit,
  onDone,
}: {
  r: DayLogAdminReply;
  onEdit: OnEdit;
  onDone: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const toast = useToast();
  const [body, setBody] = useState(r.body);
  const [loadedAt] = useState(r.updatedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const text = body.trim();
  const off = !text || text === r.body.trim();

  async function save(): Promise<void> {
    if (busy || off) return;
    setErr(null);
    setBusy(true);
    try {
      await onEdit(r, text, loadedAt, saveKey);
      toast.ok('Reply saved');
      onDone();
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
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
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="dl-btns">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || off}
          title={off ? (!text ? 'Type the reply first' : 'No changes to save') : undefined}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
      {err ? <RowError text={err} /> : null}
    </>
  );
}

function SendBox({
  inputId,
  first,
  placeholder,
  hint,
  onSend,
}: {
  inputId: string;
  first: string;
  placeholder: string;
  hint: string;
  onSend: OnSend;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const text = body.trim();

  async function go(): Promise<void> {
    if (busy || !text) return;
    setErr(null);
    setBusy(true);
    try {
      await onSend(text, saveKey);
      toast.ok(`Reply sent to ${first}`);
      setBody('');
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="dl-xl" htmlFor={inputId}>
        Reply
      </label>
      <textarea
        id={inputId}
        className="innovic-textarea dl-rbox"
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="dl-btns">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !text}
          title={!text ? 'Type the reply first' : undefined}
          onClick={() => void go()}
        >
          {busy ? 'Sending…' : 'Send reply'}
        </button>
        <span className="text3 dl-small">{hint}</span>
      </div>
      {err ? <RowError text={err} /> : null}
    </>
  );
}

function RepliesPane({
  replies,
  first,
  onEdit,
  send,
}: {
  /** Oldest first. */
  replies: readonly DayLogAdminReply[];
  /** The person's first name. */
  first: string;
  /** Left out: no ✎ on the replies. */
  onEdit?: OnEdit | undefined;
  /** Left out: no Reply box. */
  send?: { inputId: string; placeholder: string; hint: string; onSend: OnSend } | undefined;
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
          {editing === r.id && onEdit ? (
            <>
              <span className="dl-reply-h">Edit reply {i + 1}</span>
              <ReplyEdit r={r} onEdit={onEdit} onDone={() => setEditing(null)} />
            </>
          ) : (
            <>
              <span className="dl-reply-h dl-reply-hrow">
                <span>
                  Reply {i + 1} · {r.authorName} · {fmtStamp(r.sentAt)}
                  {r.editedAt ? ` · edited ${fmtStamp(r.editedAt)}` : ''}
                </span>
                {onEdit && r.canEdit ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm dl-icon"
                    title="Edit this reply"
                    aria-label={`Edit reply ${i + 1}`}
                    onClick={() => setEditing(r.id)}
                  >
                    <Icon name="pencil" size={12} />
                  </button>
                ) : null}
              </span>
              {r.body}
              <span className={r.seenAt ? 'dl-seen dl-green' : 'dl-seen dl-orange'}>
                {r.seenAt ? `✓ Seen by ${first} · ${fmtStamp(r.seenAt)}` : '● Not seen yet'}
              </span>
            </>
          )}
        </div>
      ))}
      {send ? (
        <SendBox
          inputId={send.inputId}
          first={first}
          placeholder={send.placeholder}
          hint={send.hint}
          onSend={send.onSend}
        />
      ) : null}
    </div>
  );
}

/** Replies on one entry (ADR-255). */
export function PersonReplies({
  entryId,
  replies,
  first,
  goesToInbox,
}: {
  entryId: string;
  /** Oldest first. */
  replies: readonly DayLogAdminReply[];
  /** The person's first name. */
  first: string;
  /** DayLogPersonDay.replyGoesToInbox. */
  goesToInbox: boolean;
}): React.JSX.Element {
  const send = useSendDayLogReply();
  const edit = useEditDayLogReply();
  return (
    <RepliesPane
      replies={replies}
      first={first}
      onEdit={(r, body, updatedAt, saveKey) =>
        edit.mutateAsync({ replyId: r.id, body, updatedAt, saveKey })
      }
      send={{
        inputId: `dl-reply-${entryId}`,
        placeholder: `Write to ${first} about this entry…`,
        hint: sendHint(first, goesToInbox),
        onSend: (body, saveKey) => send.mutateAsync({ entryId, body, saveKey }),
      }}
    />
  );
}

/** Replies on a person's blank day: the Reply box only while the server offers
 *  it (canReplyDay), ✎ only for the Super Admin on someone else's day. */
export function DayReplies({ p }: { p: DayLogPersonDay }): React.JSX.Element {
  const send = useSendDayLogDayReply();
  const edit = useEditDayLogDayReply();
  const first = firstName(p.userName);
  return (
    <RepliesPane
      replies={p.dayReplies}
      first={first}
      onEdit={
        p.canReply
          ? (r, body, updatedAt, saveKey) =>
              edit.mutateAsync({ replyId: r.id, body, updatedAt, saveKey })
          : undefined
      }
      send={
        p.canReplyDay
          ? {
              inputId: `dl-day-reply-${p.date}`,
              placeholder: `Write to ${first} about ${fmtDate(p.date)}…`,
              hint: sendHint(first, p.replyGoesToInbox, ', closed when the day is entered'),
              onSend: (body, saveKey) =>
                send.mutateAsync({ userId: p.userId, date: p.date, body, saveKey }),
            }
          : undefined
      }
    />
  );
}
