// "Edit Design" modal — edit a Design Tracker row. Split out of routes/list.tsx
// (ADR-199 table standard). Behaviour unchanged.

import { type DesignTrackerListItem } from '@innovic/shared';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useUpdateDesignTracker } from '../api';
import { Actions, ErrorBox, Field, ModalShell } from './design-tracker-modal-shell';

export function EditDesignModal({
  row,
  onClose,
}: {
  row: DesignTrackerListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [designer, setDesigner] = useState(row.designer);
  const [status, setStatus] = useState(row.status);
  const [estHours, setEstHours] = useState(String(row.estimatedHours));
  const [targetDate, setTargetDate] = useState(row.targetDate);
  const [remarks, setRemarks] = useState(row.remarks ?? '');
  const [err, setErr] = useState<string | null>(null);
  const mut = useUpdateDesignTracker();

  const onSave = (): void => {
    setErr(null);
    mut.mutate(
      {
        id: row.id,
        input: {
          designer: designer.trim() || undefined,
          status,
          estimatedHours: estHours.trim() ? Number(estHours) : undefined,
          targetDate,
          remarks,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not save Design. Try again.'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`Edit Design — ${row.code}`}>
      <div className="form-grid">
        <Field label="SO No.">
          <input
            type="text"
            className="innovic-input"
            value={row.soCodeText ?? ''}
            readOnly
            style={{ color: 'var(--cyan)', fontWeight: 700 }}
          />
        </Field>
        {/* POL — read-only here; it is typed only on the Sales Order. */}
        <Field label="POL">
          <input
            type="text"
            className="innovic-input"
            value={row.clientPoLineNo ?? '—'}
            readOnly
            style={{ color: 'var(--purple)', fontWeight: 700 }}
          />
        </Field>
        <Field label="Item Code">
          <input
            type="text"
            className="innovic-input"
            value={itemCodeWithRev(row.itemCodeText, row.itemRevision, '')}
            readOnly
            style={{ color: 'var(--purple)' }}
          />
        </Field>
        <Field label="Design Engineer">
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
          />
        </Field>
        <Field label="Design Status">
          <select
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as DesignTrackerListItem['status'])}
          >
            <option>Pending</option>
            <option>In Progress</option>
            <option>Review</option>
            <option>Approved</option>
            {/* Revision is set only by the Revise action; listed here only so a
                design already in Revision keeps its value. */}
            {row.status === 'Revision' ? <option>Revision</option> : null}
          </select>
        </Field>
        <Field label="Estimated Hours">
          <input
            type="number"
            min={0}
            className="innovic-input"
            value={estHours}
            onChange={(e) => setEstHours(e.target.value)}
          />
        </Field>
        <Field label="Due Date">
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <Field label="Remarks" full>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
      </div>
      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save Changes" />
    </ModalShell>
  );
}
