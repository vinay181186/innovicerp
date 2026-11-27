// Personal Leave (owner 2026-11-27): the signed-in person marks their OWN
// working days as Personal Leave — one date (just pick From Date) or a
// From–To range, past or future — with a reason, and removes them again.
// A leave day is never pending (red banner) and takes no entries. The server
// skips Sundays / holidays / days already on leave and refuses a date that
// already has entries; its words are shown as they are. Shown only when
// GET /day-logs/access says canSetLeave. Modelled on holidays-modal.tsx.

import type { DayLogLeaveDay, DayLogLeaveSetResult } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { DataTable } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog, Modal, useToast } from '@/ui/feedback';
import { useMyLeave, useRemoveLeave, useSetLeave } from '../api';
import { errText } from '../lib/format';

const REASON_MAX = 200;

const COLUMNS: DataTableColumn<DayLogLeaveDay>[] = [
  {
    id: 'date',
    header: 'Leave Date',
    kind: 'date',
    className: 'mono',
    filterValue: (d) => d.date,
    render: (d) => fmtDate(d.date),
  },
  {
    id: 'reason',
    header: 'Reason',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (d) => d.reason,
    filterValue: (d) => d.reason,
    render: (d) => d.reason,
  },
];

/** "Personal Leave set: 05-12-2026" / "… set: 3 days", plus the skipped dates. */
function savedText(r: DayLogLeaveSetResult): string {
  const set =
    r.set.length === 0
      ? 'No Personal Leave set'
      : r.set.length === 1
        ? `Personal Leave set: ${fmtDate(r.set[0])}`
        : `Personal Leave set: ${r.set.length} days`;
  if (r.skipped.length === 0) return set;
  return `${set} (skipped: Sunday / holiday / already on leave: ${r.skipped.map((d) => fmtDate(d)).join(', ')})`;
}

export function PersonalLeaveModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const q = useMyLeave();
  const setLeave = useSetLeave();
  const remove = useRemoveLeave();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DayLogLeaveDay | null>(null);

  const limits = q.data;
  const min = limits?.earliest;
  const max = limits?.latest;
  const inRange = (d: string): boolean => (!min || d >= min) && (!max || d <= max);
  const why = !from
    ? 'Enter the From Date'
    : !inRange(from)
      ? `From Date must be between ${fmtDate(min)} and ${fmtDate(max)}`
      : !to
        ? 'Enter the To Date'
        : to < from
          ? 'To Date must be on or after From Date'
          : !inRange(to)
            ? `To Date must be between ${fmtDate(min)} and ${fmtDate(max)}`
            : reason.trim() === ''
              ? 'Enter the Reason'
              : null;
  const saving = setLeave.isPending;

  /** To Date follows From Date while it is empty, earlier than From, or still
   *  the old From (one date = just pick From). From cleared = To cleared. */
  const changeFrom = (next: string): void => {
    setFrom(next);
    if (!next) {
      setTo('');
      return;
    }
    if (!to || to < next || to === from) setTo(next);
  };

  async function save(): Promise<void> {
    if (saving || why) return;
    setErr(null);
    try {
      const r = await setLeave.mutateAsync({ from, to, reason: reason.trim() });
      if (r.set.length > 0) toast.ok(savedText(r));
      else toast.info(savedText(r));
      setFrom('');
      setTo('');
      setReason('');
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <Modal
      title="Personal Leave"
      size="md"
      onClose={onClose}
      // Only a half-typed leave can be lost; Remove saves at once.
      confirmExit={from !== '' || reason.trim() !== ''}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || why !== null}
            title={!saving && why ? why : undefined}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--sp-2)' }}
      >
        <div>
          <label className="form-label" htmlFor="pl-from">
            From Date<span className="req">★</span>
          </label>
          <input
            id="pl-from"
            type="date"
            className="innovic-input mono"
            min={min}
            max={max}
            value={from}
            onChange={(e) => changeFrom(e.target.value)}
            style={{ width: '16ch', minWidth: 140 }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="pl-to">
            To Date
          </label>
          <input
            id="pl-to"
            type="date"
            className="innovic-input mono"
            min={from || min}
            max={max}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: '16ch', minWidth: 140 }}
          />
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label className="form-label" htmlFor="pl-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="pl-reason"
            className="innovic-input"
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </div>
      </div>
      <p className="text3" style={{ margin: 'var(--sp-1) 0 0', fontSize: 'var(--fs-sm)' }}>
        One date: pick From Date only. Sundays and holidays in a range are skipped.
      </p>
      {err ? (
        <p
          role="alert"
          style={{ color: 'var(--red2)', margin: 'var(--sp-2) 0 0', fontSize: 'var(--fs-sm)' }}
        >
          {err}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <DataTable<DayLogLeaveDay>
          tableKey={TABLE_KEYS.dayLogLeave}
          columns={COLUMNS}
          rows={q.data?.days ?? []}
          rowKey={(d) => d.date}
          loading={q.isLoading}
          maxHeight={300}
          empty={
            q.isError
              ? errText(q.error, 'Could not load your leave days.')
              : 'No Personal Leave yet.'
          }
          rowMenuLabel={(d) => `Actions for ${fmtDate(d.date)}`}
          rowMenu={(d) => [
            {
              key: 'remove',
              label: 'Remove',
              icon: 'trash-2',
              group: 'danger',
              disabledReason: remove.isPending ? 'Working…' : undefined,
              onSelect: () => setRemoving(d),
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={removing !== null}
        title={
          removing
            ? `Remove Personal Leave on ${fmtDate(removing.date)}?`
            : 'Remove Personal Leave?'
        }
        message="That day goes back to a normal working day — enter its Day Log."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.date);
          toast.ok(`Personal Leave removed: ${fmtDate(removing.date)}`);
          setRemoving(null);
        }}
      />
    </Modal>
  );
}
