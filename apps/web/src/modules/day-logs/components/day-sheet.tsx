// My Day Log's ONE sheet (owner final 2026-10-27): the day's saved rows on
// top (read view, ✎ → edit for approval), then — only while the server lets
// the owner add rows to this day — a "New rows — not saved yet" separator,
// the draft rows, "+ Add row", Cancel and ONE Save that sends every filled
// draft in one batch (all or nothing, POST /day-logs/entries/batch). The
// shared rules are checked first; the server answers "Row N: …" for the row
// it refused: the message shows under that row and every draft is kept. On
// success ONLY the rows that batch carried leave the drafts (rows typed while
// it ran stay; none left = one empty row). One Idempotency-Key per save
// (useSaveKey): a double click or a resend after a timeout saves once.
// While a save runs only the rows it carries are locked.

import type { DayLogDetail, UpdateDayLogEntryInput } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useAddDayLogEntries, useUpdateDayLogEntry, type DayQuery } from '../api';
import { errText, fmtDmy } from '../lib/format';
import { blankDraft, checkDrafts, isFilled, rowError, toSheetRow, type Draft } from '../lib/sheet';
import { SHEET_COLS, SheetHead, sortEntries } from './entries-table';
import { SheetDraftRow, startInputId } from './sheet-draft-row';
import { SheetSavedRow } from './sheet-saved-row';

const COLS = SHEET_COLS;
const SEP: React.CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

export function DaySheet({
  day,
  q,
  nowMin,
  canWrite,
  canAdd,
  editingId,
  onEditingId,
  onDirty,
}: {
  day: DayLogDetail;
  q: DayQuery;
  nowMin: number | null;
  /** The server lets the owner write this day, and it is not still loading. */
  canWrite: boolean;
  /** New rows may be added (canWrite and the day is not blocked). */
  canAdd: boolean;
  editingId: string | null;
  onEditingId: (id: string | null) => void;
  /** Some draft has something typed in it. */
  onDirty: (dirty: boolean) => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const addRows = useAddDayLogEntries(q, saveKey);
  const update = useUpdateDayLogEntry(q);
  const [drafts, setDrafts] = useState<Draft[]>(() => [blankDraft()]);
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // Draft keys the in-flight batch carries, and the saved-entry id whose edit
  // is in flight — only those rows are locked.
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<number>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const saving = addRows.isPending || savingKeys.size > 0;
  const filled = drafts.filter(isFilled);
  const dirty = canAdd && filled.length > 0;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(startInputId(focusKey))?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const entries = sortEntries(day.entries);

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
    setDrafts((ds) => {
      const keep = ds.filter((d) => savingKeys.has(d.key));
      return keep.length ? keep : [blankDraft()];
    });
  };

  async function sendEdit(id: string, body: UpdateDayLogEntryInput): Promise<void> {
    setBusyId(id);
    try {
      await update.mutateAsync({ id, ...body });
      onEditingId(null);
      setMsg({
        ok: true,
        text: 'Edit sent for approval — the row keeps its old values until it is approved.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function save(): Promise<void> {
    if (saving || !filled.length) return;
    setMsg(null);
    setRowErrs({});
    const bad = checkDrafts(day.date, filled);
    const badRow = bad ? filled[bad.index] : undefined;
    if (bad && badRow) {
      setRowErrs({ [badRow.key]: bad.text });
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

  const msgLine = msg ? (
    <span
      role={msg.ok ? 'status' : 'alert'}
      style={{ fontSize: 13, color: msg.ok ? 'var(--green2)' : 'var(--red2)' }}
    >
      {msg.text}
    </span>
  ) : null;

  return (
    <>
      <div className="panel" style={{ padding: 0, marginBottom: 8 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <SheetHead actions required />
            <tbody>
              {entries.length === 0 && !canAdd ? (
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
                  nowMin={nowMin}
                  canEdit={canWrite}
                  editing={editingId === e.id}
                  busy={busyId === e.id}
                  onEdit={() => {
                    setMsg(null);
                    onEditingId(e.id);
                  }}
                  onCancelEdit={() => onEditingId(null)}
                  onUpdate={(body) => sendEdit(e.id, body)}
                />
              ))}
              {canAdd && drafts.length > 0 ? (
                <tr style={{ background: 'var(--bg3)' }}>
                  <td colSpan={COLS} className="td-left text3" style={SEP}>
                    New rows — not saved yet
                  </td>
                </tr>
              ) : null}
              {canAdd
                ? drafts.map((d, j) => (
                    <SheetDraftRow
                      key={d.key}
                      d={d}
                      n={entries.length + j + 1}
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
      {canAdd ? (
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
          {msgLine}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={cancelRows}>
            Cancel
          </button>
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
      ) : msgLine ? (
        <div style={{ marginBottom: 10 }}>{msgLine}</div>
      ) : null}
    </>
  );
}
