// My Day Log's sheet (ADR-255): the day's saved entries on the FIT table
// (my-day-table.tsx), then — only while the server lets the owner add rows to
// this day — "+ Add entry" BELOW the table, which opens the new-rows form
// right under it: the draft rows (the first Start filled from the last Stop,
// each further row's Start from the row above), "+ Add row", Cancel and ONE
// Save that sends every filled draft in one batch (all or nothing, POST
// /day-logs/entries/batch). The shared rules are checked first; the server
// answers "Row N: ..." for the row it refused: the message shows under that row
// and every draft is kept. On success ONLY the rows that batch carried leave
// the drafts (none left = the form closes). One Idempotency-Key per save
// (useSaveKey): a double click or a resend after a timeout saves once.
// While a save runs only the rows it carries are locked.

import type { DayLogDetail } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useAddDayLogEntries, type DayQuery } from '../api';
import { errText } from '../lib/format';
import {
  blankDraft,
  checkDrafts,
  isFilled,
  rowError,
  sortEntries,
  startFrom,
  toSheetRow,
  type Draft,
} from '../lib/sheet';
import { MyDayTable } from './my-day-table';
import { SheetDraftRow, startInputId } from './sheet-draft-row';
import '../day-log-sheet.css';

/** The sheet's header row — the same grid as every entry row. */
function SheetGridHead(): React.JSX.Element {
  return (
    <div className="dl-cols dl-head" aria-hidden>
      <span className="dl-c">Sr No</span>
      <span className="dl-c">Start Time *</span>
      <span className="dl-c">Stop Time *</span>
      <span className="dl-c dl-dur">Working Hours</span>
      <span className="dl-c">SO / JWSO</span>
      <span className="dl-c">Working On *</span>
      <span className="dl-c" />
    </div>
  );
}

export function DaySheet({
  day,
  q,
  nowMin,
  canWrite,
  canAdd,
  line,
  onDirty,
}: {
  day: DayLogDetail;
  q: DayQuery;
  nowMin: number | null;
  /** The server lets the owner write this day, and it is not still loading. */
  canWrite: boolean;
  /** New rows may be added (canWrite and the day is not blocked). */
  canAdd: boolean;
  /** ?line= — the entry to open and scroll to. */
  line: string | undefined;
  /** Some draft has something typed in it. */
  onDirty: (dirty: boolean) => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const addRows = useAddDayLogEntries(q, saveKey);
  const entries = sortEntries(day.entries);
  /** Where a new entry starts: the last saved Stop. */
  const lastStop = startFrom(day.summary.nextStart ?? entries[entries.length - 1]?.toTime);
  const [adding, setAdding] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // Draft keys the in-flight batch carries — only those rows are locked.
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<number>>(() => new Set());
  const saving = addRows.isPending || savingKeys.size > 0;
  const filled = drafts.filter(isFilled);
  const dirty = canAdd && filled.length > 0;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(startInputId(focusKey))?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const patch = (key: number, p: Partial<Draft>): void =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const openAdd = (): void => {
    setMsg(null);
    setRowErrs({});
    const d = blankDraft(lastStop);
    setDrafts([d]);
    setAdding(true);
    setFocusKey(d.key);
  };
  const addRow = (): void => {
    const d = blankDraft(startFrom(drafts[drafts.length - 1]?.stop) || lastStop);
    setDrafts((ds) => [...ds, d]);
    setFocusKey(d.key);
  };
  const dropRow = (key: number): void => {
    setRowErrs({});
    const rest = drafts.filter((d) => d.key !== key);
    setDrafts(rest);
    if (!rest.length) setAdding(false);
  };
  /** Cancel: drop every unsaved row (not the ones a running save carries). */
  const cancelRows = (): void => {
    setRowErrs({});
    setMsg(null);
    const keep = drafts.filter((d) => savingKeys.has(d.key));
    setDrafts(keep);
    if (!keep.length) setAdding(false);
  };

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
        if (!rest.length) setAdding(false);
        return rest;
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

  const showForm = canAdd && adding;
  return (
    <>
      <MyDayTable
        day={day}
        q={q}
        nowMin={nowMin}
        canWrite={canWrite}
        line={line}
        onMessage={(text) => setMsg({ ok: true, text })}
      />
      {canAdd && !showForm ? (
        <div className="dl-addbar">
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add entry
          </button>
          {msgLine}
        </div>
      ) : null}
      {showForm ? (
        <div className="dl-sheet">
          <div className="dl-bar">New entries — not saved yet</div>
          <SheetGridHead />
          {drafts.map((d, j) => (
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
          ))}
          <div className="dl-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
              + Add row
            </button>
            <span className="dl-note">Enter in Stop Time = new row</span>
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
        </div>
      ) : null}
      {!canAdd && msgLine ? <div className="dl-addbar">{msgLine}</div> : null}
    </>
  );
}
