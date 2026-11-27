// Personal Leave (owner 2026-11-27): the signed-in person marks their OWN
// working days as Personal Leave — one date (just pick From Date) or a
// From–To range, past or future — with a reason, and removes them again.
// A leave day is never pending (red banner) and takes no entries. The server
// skips Sundays / holidays / days already on leave and refuses a date that
// already has entries; its words are shown as they are. Shown only when
// GET /day-logs/access says canSetLeave. Modelled on holidays-modal.tsx.
// Part 2 (0268): Leave Type Full Day / Half Day. A Half Day is one date with
// its From Time–To Time; entries stay allowed outside that time.

import {
  DAY_LOG_LEAVE_KINDS,
  DAY_LOG_LEAVE_KIND_LABELS,
  HALF_DAY_WHOLE_DAY_MSG,
  fmt12,
  halfCoversWholeDay,
  hhmmToMin,
  parseTime,
} from '@innovic/shared';
import type { DayLogLeaveDay, DayLogLeaveKind, DayLogLeaveSetResult } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { DataTable } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog, Modal, useToast } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { useMyLeave, useRemoveLeave, useSetLeave } from '../api';
import { errText } from '../lib/format';
import { TimeField } from './time-field';

const REASON_MAX = 200;

const KIND_OPTIONS = DAY_LOG_LEAVE_KINDS.map((k) => ({
  value: k,
  label: DAY_LOG_LEAVE_KIND_LABELS[k],
}));

/** "Half Day Leave" / "Personal Leave" — the leave's name in a toast or title. */
const leaveName = (kind: DayLogLeaveKind): string =>
  kind === 'half' ? 'Half Day Leave' : 'Personal Leave';

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
    id: 'kind',
    header: 'Leave Type',
    kind: 'badge',
    filterValue: (d) => DAY_LOG_LEAVE_KIND_LABELS[d.kind],
    render: (d) => DAY_LOG_LEAVE_KIND_LABELS[d.kind],
  },
  {
    id: 'time',
    header: 'Time',
    kind: 'date',
    className: 'mono',
    filterValue: (d) => d.fromTime ?? '',
    render: (d) =>
      d.kind === 'half' && d.fromTime && d.toTime
        ? `${fmt12(d.fromTime)} – ${fmt12(d.toTime)}`
        : '—',
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

/** "Personal Leave set: 05-12-2026" / "… set: 3 days" / "Half Day Leave set:
 *  05-12-2026", plus the skipped dates. */
function savedText(r: DayLogLeaveSetResult, kind: DayLogLeaveKind): string {
  const name = leaveName(kind);
  const set =
    r.set.length === 0
      ? `No ${name} set`
      : r.set.length === 1
        ? `${name} set: ${fmtDate(r.set[0])}`
        : `${name} set: ${r.set.length} days`;
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
  const [kind, setKind] = useState<DayLogLeaveKind>('full');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DayLogLeaveDay | null>(null);

  const limits = q.data;
  const min = limits?.earliest;
  const max = limits?.latest;
  const inRange = (d: string): boolean => (!min || d >= min) && (!max || d <= max);
  const half = kind === 'half';
  const fromHhmm = parseTime(fromTime);
  const toHhmm = parseTime(toTime);
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
            : half && !fromHhmm
              ? 'Enter the From Time'
              : half && !toHhmm
                ? 'Enter the To Time'
                : half && fromHhmm && toHhmm && hhmmToMin(toHhmm) <= hhmmToMin(fromHhmm)
                  ? 'To Time must be after From Time'
                  : half && halfCoversWholeDay({ fromTime: fromHhmm, toTime: toHhmm })
                    ? HALF_DAY_WHOLE_DAY_MSG
                    : reason.trim() === ''
                      ? 'Enter the Reason'
                      : null;
  const saving = setLeave.isPending;

  /** To Date follows From Date while it is empty, earlier than From, or still
   *  the old From (one date = just pick From). From cleared = To cleared.
   *  A Half Day: To Date is always From Date. */
  const changeFrom = (next: string): void => {
    setFrom(next);
    if (!next) {
      setTo('');
      return;
    }
    if (half || !to || to < next || to === from) setTo(next);
  };

  /** Half Day locks To Date to From Date; back to Full Day drops the times. */
  const changeKind = (next: DayLogLeaveKind): void => {
    setKind(next);
    if (next === 'half') {
      setTo(from);
    } else {
      setFromTime('');
      setToTime('');
    }
  };

  async function save(): Promise<void> {
    if (saving || why) return;
    setErr(null);
    try {
      const r = await setLeave.mutateAsync({
        from,
        to: half ? from : to,
        kind,
        fromTime: half ? fromHhmm : null,
        toTime: half ? toHhmm : null,
        reason: reason.trim(),
      });
      if (r.set.length > 0) toast.ok(savedText(r, kind));
      else toast.info(savedText(r, kind));
      setFrom('');
      setTo('');
      setKind('full');
      setFromTime('');
      setToTime('');
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
      confirmExit={from !== '' || reason.trim() !== '' || fromTime !== '' || toTime !== ''}
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
            disabled={half}
            title={half ? 'Half Day is for one date — To Date follows From Date' : undefined}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: '16ch', minWidth: 140 }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="pl-kind">
            Leave Type<span className="req">★</span>
          </label>
          <Select
            id="pl-kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(e) => changeKind(e.target.value as DayLogLeaveKind)}
            style={{ width: '14ch', minWidth: 120 }}
          />
        </div>
        {half ? (
          <>
            <div>
              <label className="form-label" htmlFor="pl-from-time">
                From Time<span className="req">★</span>
              </label>
              <TimeField
                id="pl-from-time"
                ariaLabel="From Time"
                value={fromTime}
                onChange={setFromTime}
                placeholder="01:00 PM"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="pl-to-time">
                To Time<span className="req">★</span>
              </label>
              <TimeField
                id="pl-to-time"
                ariaLabel="To Time"
                value={toTime}
                onChange={setToTime}
                placeholder="06:00 PM"
              />
            </div>
          </>
        ) : null}
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
        One date: pick From Date only. Sundays and holidays in a range are skipped. Half Day: one
        date, with its leave time.
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
            ? `Remove ${leaveName(removing.kind)} on ${fmtDate(removing.date)}?`
            : 'Remove Personal Leave?'
        }
        message="That day goes back to a normal working day — enter its Day Log."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.date);
          toast.ok(`${leaveName(removing.kind)} removed: ${fmtDate(removing.date)}`);
          setRemoving(null);
        }}
      />
    </Modal>
  );
}
