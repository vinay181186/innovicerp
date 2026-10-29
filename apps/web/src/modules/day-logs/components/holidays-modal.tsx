// Company holidays (a holiday is not a working day — nothing is required).
// Shown only to whoever GET /day-logs/access says may manage them.

import type { Holiday } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { DataTable } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Modal } from '@/ui/feedback';
import { useAddHoliday, useHolidays, useRemoveHoliday } from '../api';
import { errText } from '../lib/format';

/** The FIT table (ADR-199) with the ADR-200 Sort & Filter ▾ in the browser
 *  (every holiday is loaded); the row's ⋯ holds Remove. */
const COLUMNS: DataTableColumn<Holiday>[] = [
  {
    id: 'date',
    header: 'Holiday Date',
    kind: 'date',
    className: 'mono',
    filterValue: (h) => h.date,
    render: (h) => fmtDate(h.date),
  },
  {
    id: 'name',
    header: 'Holiday',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (h) => h.name,
    filterValue: (h) => h.name,
    render: (h) => h.name,
  },
];

export function HolidaysModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const q = useHolidays();
  const add = useAddHoliday();
  const remove = useRemoveHoliday();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const busy = add.isPending || remove.isPending;

  async function run(p: Promise<unknown>): Promise<boolean> {
    setErr(null);
    try {
      await p;
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  }

  return (
    <Modal
      title="Holidays"
      size="md"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <DataTable<Holiday>
        tableKey={TABLE_KEYS.dayLogHolidays}
        columns={COLUMNS}
        rows={q.data?.holidays ?? []}
        rowKey={(h) => h.id}
        loading={q.isLoading}
        maxHeight={320}
        empty={q.isError ? errText(q.error, 'Could not load the holidays.') : 'No holidays set.'}
        rowMenuLabel={(h) => `Actions for ${h.name}`}
        rowMenu={(h) => [
          {
            key: 'remove',
            label: 'Remove',
            icon: 'trash-2',
            group: 'danger',
            disabledReason: busy ? 'Working…' : undefined,
            onSelect: () => run(remove.mutateAsync(h.id)).then(() => undefined),
          },
        ]}
      />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 10,
          marginTop: 10,
        }}
      >
        <div>
          <label className="form-label" htmlFor="hol-date">
            Holiday Date <span className="req">*</span>
          </label>
          <input
            id="hol-date"
            type="date"
            className="innovic-input mono"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '16ch', minWidth: 140 }}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label className="form-label" htmlFor="hol-name">
            Holiday <span className="req">*</span>
          </label>
          <input
            id="hol-name"
            className="innovic-input"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !date || name.trim() === ''}
          onClick={() => {
            void run(add.mutateAsync({ date, name: name.trim() })).then((ok) => {
              if (ok) {
                setDate('');
                setName('');
              }
            });
          }}
        >
          {add.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '8px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
    </Modal>
  );
}
