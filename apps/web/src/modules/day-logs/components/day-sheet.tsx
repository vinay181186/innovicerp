// My Day Log's ONE sheet (owner-approved mockup 2026-10-27): the day's saved
// rows on top (read view, ✎ / ■ Stop / 🗑), then — only while the server
// lets the owner write this day — a "New rows — not saved yet" separator,
// the draft rows, "+ Add row" and ONE Save that sends every filled draft in
// one batch (all or nothing). The server answers "Row N: …" for the row it
// refused: the message shows under that row and every draft is kept. On
// success the drafts go back to one empty row. One Idempotency-Key per save
// (useSaveKey): a double click or a resend after a timeout saves once.

import type { DayLogDetail, UpdateDayLogEntryInput } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import {
  useAddDayLogEntries,
  useRemoveDayLogEntry,
  useStopDayLogEntry,
  useUpdateDayLogEntry,
  type DayQuery,
} from '../api';
import { errText, fmtDmy } from '../lib/format';
import { blankDraft, draftStarts, isFilled, rowError, toSheetRow, type Draft } from '../lib/sheet';
import { SHEET_HEADS, SheetHead, sortEntries } from './entries-table';
import { SheetDraftRow, stopInputId } from './sheet-draft-row';
import { SheetSavedRow } from './sheet-saved-row';

const COLS = SHEET_HEADS.length + 1;

export function DaySheet({
  day,
  q,
  nowMin,
  canWrite,
  editingId,
  onEditingId,
  onDirty,
}: {
  day: DayLogDetail;
  q: DayQuery;
  nowMin: number | null;
  /** The server lets the owner write this day, and it is not still loading. */
  canWrite: boolean;
  editingId: string | null;
  onEditingId: (id: string | null) => void;
  /** Some draft has something typed in it (Submit Day waits for it). */
  onDirty: (dirty: boolean) => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const addRows = useAddDayLogEntries(q, saveKey);
  const update = useUpdateDayLogEntry(q);
  const stop = useStopDayLogEntry(q);
  const remove = useRemoveDayLogEntry(q);
  const [drafts, setDrafts] = useState<Draft[]>(() => [blankDraft()]);
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const busy = addRows.isPending || update.isPending || stop.isPending || remove.isPending;
  const isToday = day.date === day.today;
  const filled = drafts.filter(isFilled);
  const dirty = filled.length > 0;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(stopInputId(focusKey))?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const entries = sortEntries(day.entries);
  const starts = draftStarts(day.summary.nextStart, drafts);

  const patch = (key: number, p: Partial<Draft>): void =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const addRow = (): void => {
    const d = blankDraft();
    setDrafts((ds) => [...ds, d]);
    setFocusKey(d.key);
  };
  const dropRow = (key: number): void => {
    setRowErrs({});
    setDrafts((ds) => {
      const rest = ds.filter((d) => d.key !== key);
      return rest.length ? rest : [blankDraft()];
    });
  };
  const run = (p: Promise<unknown>, ok: string): Promise<unknown> =>
    p.then(() => {
      setMsg({ ok: true, text: ok });
    });

  async function save(): Promise<void> {
    if (busy || !filled.length) return;
    setMsg(null);
    setRowErrs({});
    const bad = filled.find((d) => d.stop.trim() && toSheetRow(d).stopTime === null);
    if (bad) {
      setRowErrs({ [bad.key]: 'Stop time: type it as 1030, 3pm or 03:15 PM.' });
      setMsg({ ok: false, text: 'Nothing saved — fix the red row.' });
      return;
    }
    try {
      await addRows.mutateAsync({ date: day.date, rows: filled.map(toSheetRow) });
      setDrafts([blankDraft()]);
      setMsg({ ok: true, text: `Saved ${filled.length} row${filled.length > 1 ? 's' : ''}.` });
    } catch (e) {
      const text = errText(e);
      const r = rowError(text);
      const target = r ? filled[r.row - 1] : undefined;
      if (r && target) {
        setRowErrs({ [target.key]: r.text });
        setMsg({ ok: false, text: 'Nothing saved — fix the red row.' });
      } else {
        setMsg({ ok: false, text });
      }
    }
  }

  return (
    <>
      <div className="panel" style={{ padding: 0, marginBottom: 8 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <SheetHead actions />
            <tbody>
              {entries.length === 0 && !canWrite ? (
                <tr>
                  <td colSpan={COLS} className="empty-state">
                    Nothing logged on {fmtDmy(day.date)}.
                  </td>
                </tr>
              ) : null}
              {entries.map((e, i) => (
                <SheetSavedRow
                  key={e.id}
                  e={e}
                  n={i + 1}
                  isLast={e.id === day.lastEntryId}
                  isToday={isToday}
                  nowMin={nowMin}
                  canWrite={canWrite}
                  editing={editingId === e.id}
                  busy={busy}
                  onEdit={() => {
                    setMsg(null);
                    onEditingId(e.id);
                  }}
                  onCancelEdit={() => onEditingId(null)}
                  onUpdate={(body: UpdateDayLogEntryInput) =>
                    run(update.mutateAsync({ id: e.id, ...body }), 'Row updated.').then(() =>
                      onEditingId(null),
                    )
                  }
                  onStop={(remarks) =>
                    run(
                      stop.mutateAsync(remarks ? { id: e.id, remarks } : { id: e.id }),
                      'Stopped.',
                    )
                  }
                  onRemove={() => {
                    setMsg(null);
                    if (editingId === e.id) onEditingId(null);
                    remove
                      .mutateAsync(e.id)
                      .catch((x: unknown) => setMsg({ ok: false, text: errText(x) }));
                  }}
                />
              ))}
              {canWrite ? (
                <tr style={{ background: 'var(--bg3)' }}>
                  <td
                    colSpan={COLS}
                    className="td-left text3"
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '.05em',
                    }}
                  >
                    New rows — not saved yet
                  </td>
                </tr>
              ) : null}
              {canWrite
                ? drafts.map((d, j) => (
                    <SheetDraftRow
                      key={d.key}
                      d={d}
                      n={entries.length + j + 1}
                      start={starts[j] ?? null}
                      isLast={j === drafts.length - 1}
                      nowMin={nowMin}
                      error={rowErrs[d.key] ?? null}
                      busy={busy}
                      onChange={(p) => patch(d.key, p)}
                      onDrop={() => dropRow(d.key)}
                      onEnter={() => {
                        if (j === drafts.length - 1) addRow();
                      }}
                    />
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </div>
      {canWrite ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={addRow}>
            + Add row
          </button>
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            Enter in the last row = new row
          </span>
          {msg ? (
            <span
              role={msg.ok ? 'status' : 'alert'}
              style={{ fontSize: 13, color: msg.ok ? 'var(--green2)' : 'var(--red2)' }}
            >
              {msg.text}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
            style={{ minWidth: 120 }}
          >
            {addRows.isPending
              ? 'Saving…'
              : filled.length > 1
                ? `Save (${filled.length} rows)`
                : 'Save'}
          </button>
        </div>
      ) : msg ? (
        <div role="alert" style={{ fontSize: 13, color: 'var(--red2)', marginBottom: 10 }}>
          {msg.text}
        </div>
      ) : null}
    </>
  );
}
