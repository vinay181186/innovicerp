// "Assign Design" modal — create a Design Tracker row against one SO line.
// Split out of routes/list.tsx (ADR-199 table standard). Behaviour unchanged.

import { type CreateDesignTrackerInput } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSalesOrder, useSalesOrdersList } from '../../sales-orders/api';
import { soTypeLabel } from '../../sales-orders/lib/so-status-label';
import { useCreateDesignTracker, useNextDesignTrackerCode } from '../api';
import { Actions, ErrorBox, Field, ModalShell } from './design-tracker-modal-shell';

export function AddDesignModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date] = useState(todayIst());
  const [soSearch, setSoSearch] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [soLineId, setSoLineId] = useState('');
  const [designer, setDesigner] = useState('');
  const [estHours, setEstHours] = useState('');
  const [startDate, setStartDate] = useState(date);
  const [targetDate, setTargetDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data: soData } = useSalesOrdersList({
    search: soSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const selectedSo = useMemo(
    () => soData?.items.find((s) => s.id === soId) ?? null,
    [soData, soId],
  );

  const mut = useCreateDesignTracker();
  const { data: next } = useNextDesignTrackerCode();

  // The SO's lines — the design is for ONE line (POL + CODE/REV), and that
  // line's item is what the design shows.
  const { data: soDetail } = useSalesOrder(soId ?? undefined);
  const soLines = soId && soDetail?.id === soId ? soDetail.lines : [];
  const lineLabel = (l: (typeof soLines)[number]): string =>
    [
      `POL ${l.clientPoLineNo ?? '—'}`,
      itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.revision),
      l.partName,
    ]
      .filter(Boolean)
      .join(' · ');
  // A one-line SO needs no choice.
  const pickedLineId = soLineId || (soLines.length === 1 ? (soLines[0]?.id ?? '') : '');

  const onSave = (): void => {
    setErr(null);
    if (!soId) {
      setErr('SO No. is required.');
      return;
    }
    if (!pickedLineId) {
      setErr('SO Line is required — pick the line (POL + CODE/REV) this design is for.');
      return;
    }
    if (!designer.trim()) {
      setErr('Design Engineer is required.');
      return;
    }
    if (!targetDate) {
      setErr('Due Date is required.');
      return;
    }
    const input: CreateDesignTrackerInput = {
      salesOrderId: soId,
      salesOrderLineId: pickedLineId,
      designer: designer.trim(),
      startDate,
      targetDate,
    };
    if (estHours.trim()) input.estimatedHours = Number(estHours);
    if (remarks.trim()) input.remarks = remarks.trim();
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save Design. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="Assign Design">
      <div className="form-grid">
        <Field label="Design No.">
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
            style={{ color: 'var(--purple)', fontWeight: 700 }}
          />
        </Field>
        <Field label="SO No." req full>
          <SearchableSelect
            value={soId}
            valueLabel={
              selectedSo ? `${selectedSo.code} — ${selectedSo.customerName ?? ''}` : undefined
            }
            // SO type beside the customer (e.g. "· Equipment") — design work
            // is mostly on Equipment SOs, so the type tells them apart.
            options={(soData?.items ?? []).map((so) => ({
              id: so.id,
              code: so.code,
              name: [so.customerName, so.type ? soTypeLabel(so.type) : null]
                .filter(Boolean)
                .join(' · '),
            }))}
            onSearch={setSoSearch}
            placeholder="Type SO No. or customer…"
            onChange={(id) => {
              setSoId(id);
              setSoLineId('');
            }}
          />
        </Field>
        <Field label="SO Line (POL · CODE/REV)" req full>
          <select
            className="innovic-select"
            value={pickedLineId}
            disabled={!soId}
            onChange={(e) => setSoLineId(e.target.value)}
          >
            <option value="">{soId ? '— Select line —' : 'Pick the SO first'}</option>
            {soLines.map((l) => (
              <option key={l.id} value={l.id}>
                {lineLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Design Engineer" req>
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
            placeholder="Design engineer name"
          />
        </Field>
        <Field label="Estimated Hours">
          <input
            type="number"
            min={0}
            className="innovic-input"
            value={estHours}
            onChange={(e) => setEstHours(e.target.value)}
            placeholder="e.g. 40"
          />
        </Field>
        <Field label="Start Date">
          <input
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Due Date" req>
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
            placeholder="What needs to be designed..."
          />
        </Field>
      </div>
      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save Design" />
    </ModalShell>
  );
}
