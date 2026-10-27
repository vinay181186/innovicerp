// My Day Log's ONE sheet (owner-approved mockup 2026-10-27): the day's saved
// rows on top (read view, ✎ / ■ Stop / 🗑), then — only while the server
// lets the owner write this day — a "New rows — not saved yet" separator,
// the draft rows, "+ Add row" and ONE Save that sends every filled draft in
// one batch (all or nothing). The server answers "Row N: …" for the row it
// refused: the message shows under that row and every draft is kept. On
// success ONLY the rows that batch carried leave the drafts (rows typed while
// it ran stay; none left = one empty row). One Idempotency-Key per save
// (useSaveKey): a double click or a resend after a timeout saves once.
// While a save runs only the rows it carries are locked — every other draft
// row, and every saved row whose own update / remove is not in flight, stays
// usable (a background refetch never locks anything).

import type { DayLogDetail, UpdateDayLogEntryInput } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import {
  useAddDayLogEntries,
  useRemoveDayLogEntry,
  useUpdateDayLogEntry,
  type DayQuery,
} from '../api';
import { errText, fmtDmy } from '../lib/format';
import { blankDraft, draftStarts, isFilled, rowError, toSheetRow, type Draft } from '../lib/sheet';
import { SHEET_COLS, SheetHead, sortEntries } from './entries-table';
import { SheetDraftRow, stopInputId } from './sheet-draft-row';
import { SheetSavedRow } from './sheet-saved-row';

const COLS = SHEET_COLS;

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
  const remove = useRemoveDayLogEntry(q);
  const [drafts, setDrafts] = useState<Draft[]>(() => [blankDraft()]);
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // Draft keys the in-flight batch carries, and saved-entry ids whose own
  // update / stop / remove is in flight — only those rows are locked.
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<number>>(() => new Set());
  const [rowBusy, setRowBusy] = useState<ReadonlySet<string>>(() => new Set());
  const saving = addRows.isPending || savingKeys.size > 0;
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
    setDrafts((ds) => ds.filter((d) => d.key !== key));
  };
  /** Cancel: drop every unsaved row (not the ones a running save carries). */
  const cancelRows = (): void => {
    setRowErrs({});
    setMsg(null);
    setDrafts((ds) => ds.filter((d) => savingKeys.has(d.key)));
  };
  /** Lock one saved row while its own write runs. */
  const track = <T,>(id: string, p: Promise<T>): Promise<T> => {
    setRowBusy((s) => new Set(s).add(id));
    return p.finally(() =>
      setRowBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      }),
    );
  };
  const run = (id: string, p: Promise<unknown>, ok: string): Promise<unknown> =>
    track(id, p).then(() => {
      setMsg({ ok: true, text: ok });
    });

  async function save(): Promise<void> {
    if (saving || !filled.length) return;
    setMsg(null);
    setRowErrs({});
    const bad = filled.find((d) => d.stop.trim() && toSheetRow(d).stopTime === null);
    if (bad) {
      setRowErrs({ [bad.key]: 'Stop time: type it as 1030, 3pm or 03:15 PM.' });
      setMsg({ ok: false, text: 'Nothing saved — fix the red row.' });
      return;
    }
    const sent = new Set(filled.map((d) => d.key));
    setSavingKeys(sent);
    try {
      await addRows.mutateAsync({ date: day.date, rows: filled.map(toSheetRow) });
      // Only the rows this batch carried are saved — keep anything typed meanwhile.
      setDrafts((ds) => {
        const rest = ds.filter((d) => !sent.has(d.key));
        return rest.length ? rest : [blankDraft()];
      });
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
    } finally {
      setSavingKeys(new Set());
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
                  busy={rowBusy.has(e.id)}
                  onEdit={() => {
                    setMsg(null);
                    onEditingId(e.id);
                  }}
                  onCancelEdit={() => onEditingId(null)}
                  onUpdate={(body: UpdateDayLogEntryInput) =>
                    run(e.id, update.mutateAsync({ id: e.id, ...body }), 'Row updated.').then(() =>
                      onEditingId(null),
                    )
                  }
                  onRemove={() => {
                    setMsg(null);
                    if (editingId === e.id) onEditingId(null);
                    track(e.id, remove.mutateAsync(e.id)).catch((x: unknown) =>
                      setMsg({ ok: false, text: errText(x) }),
                    );
                  }}
                />
              ))}
              {canWrite && drafts.length > 0 ? (
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
                      saving={savingKeys.has(d.key)}
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
          <button type="button" className="btn btn-ghost" onClick={addRow}>
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
          {drafts.length > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={cancelRows}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !dirty}
            onClick={() => void save()}
            style={{ minWidth: 120 }}
          >
            {saving ? 'Saving…' : filled.length > 1 ? `Save (${filled.length} rows)` : 'Save'}
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
