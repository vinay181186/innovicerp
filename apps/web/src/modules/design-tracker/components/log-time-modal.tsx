// "Log Time" modal — book hours against a Design Tracker row, with the row's
// previous entries below. Split out of routes/list.tsx (ADR-199 table standard).
// The previous-entries list is a nested compact DataTable so it follows the
// alignment standard (centred text, right-aligned Hours) without a saved layout.

import {
  DESIGN_DAY_HOURS_WARN,
  DESIGN_HOURS_MAX_PER_ENTRY,
  type DesignTimeLogEntry,
  type DesignTrackerListItem,
  type LogDesignTimeInput,
} from '@innovic/shared';
import { useState } from 'react';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useDesignTrackerDetail, useLogDesignTime } from '../api';
import { Actions, ErrorBox, Field, ModalShell } from './design-tracker-modal-shell';

export function LogTimeModal({
  row,
  onClose,
}: {
  row: DesignTrackerListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [logDate, setLogDate] = useState(todayIst());
  const [hours, setHours] = useState('');
  const [worker, setWorker] = useState(row.designer);
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Set after a save that took the person's day above the warning line.
  const [dayWarn, setDayWarn] = useState<string | null>(null);
  const mut = useLogDesignTime();

  const { data: detail } = useDesignTrackerDetail(row.id);
  const previous = detail?.timeLog ?? [];

  const onSave = (): void => {
    setErr(null);
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setErr('Hours Worked is required.');
      return;
    }
    if (h > DESIGN_HOURS_MAX_PER_ENTRY) {
      setErr(`Hours Worked cannot be more than ${DESIGN_HOURS_MAX_PER_ENTRY} in one entry.`);
      return;
    }
    if (!worker.trim()) {
      setErr('Design Engineer is required.');
      return;
    }
    const input: LogDesignTimeInput = {
      logDate,
      hours: h,
      workerText: worker.trim(),
    };
    if (description.trim()) input.description = description.trim();
    mut.mutate(
      { id: row.id, input },
      {
        onSuccess: (saved) => {
          const day = saved.dayTotalHours ?? 0;
          if (day > DESIGN_DAY_HOURS_WARN) {
            // Saved, but flag it: keep the box open so the warning is seen.
            setHours('');
            setDescription('');
            setDayWarn(
              `Saved. ${saved.workerText} now has ${day}h booked on ${fmtDate(saved.logDate)} — more than ${DESIGN_DAY_HOURS_WARN}h in one day. Check the hours are right.`,
            );
            return;
          }
          onClose();
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not log time. Try again.'),
      },
    );
  };

  const prevColumns: DataTableColumn<DesignTimeLogEntry>[] = [
    {
      id: 'log_date',
      header: 'Log Date',
      kind: 'date',
      nowrap: true,
      render: (t) => fmtDate(t.logDate),
    },
    {
      id: 'hours',
      header: 'Hours Worked',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      filterValue: (t) => t.hours,
      render: (t) => <span style={{ color: 'var(--green2)' }}>{t.hours}h</span>,
    },
    {
      id: 'engineer',
      header: 'Design Engineer',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (t) => t.workerText,
      title: (t) => t.workerText,
    },
    {
      id: 'description',
      header: 'Description',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (t) => <span style={{ color: 'var(--text3)' }}>{t.description ?? ''}</span>,
      title: (t) => t.description ?? '',
    },
  ];

  return (
    <ModalShell
      onClose={onClose}
      title={`Time Log — ${row.code} (${row.totalHours}h / ${row.estimatedHours}h)`}
    >
      <div
        style={{
          marginBottom: 14,
          padding: 10,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: 12,
        }}
      >
        <b style={{ color: 'var(--cyan)' }}>{row.soCodeText ?? '—'}</b> | POL{' '}
        <b className="mono" style={{ color: 'var(--purple)' }}>
          {row.clientPoLineNo ?? '—'}
        </b>{' '}
        | {itemCodeWithRev(row.itemCodeText, row.itemRevision, '')} | Design Engineer:{' '}
        <b>{row.designer}</b>
      </div>
      <div className="form-grid">
        <Field label="Log Date">
          <input
            type="date"
            className="innovic-input"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
          />
        </Field>
        <Field label="Hours Worked">
          <input
            type="number"
            min={0.5}
            step={0.5}
            max={DESIGN_HOURS_MAX_PER_ENTRY}
            className="innovic-input"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 4"
          />
        </Field>
        <Field label="Design Engineer">
          <input
            type="text"
            className="innovic-input"
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <input
            type="text"
            className="innovic-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was done..."
          />
        </Field>
      </div>

      {previous.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
            Previous Entries
          </div>
          <DataTable<DesignTimeLogEntry>
            columns={prevColumns}
            rows={previous}
            density="compact"
            sortFilter={false}
            maxHeight={200}
          />
        </>
      ) : null}

      {dayWarn ? (
        <div style={{ marginTop: 12 }}>
          <Banner tone="warn" flush>
            {dayWarn}
          </Banner>
        </div>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Log Time" />
    </ModalShell>
  );
}
