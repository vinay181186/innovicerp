// Issue a tool (ADR-193 phase 4b). Bulk tools go by Issue Qty; a serial tool
// (Track by Instrument Serial No.) goes by ticking the instruments — never a typed qty.
// Instruments past their Calibration Due date, away at calibration or waiting
// for a write-off cannot be picked (the server refuses them too).
import type { CreateToolIssueInput, InstrumentListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate, todayIst } from '@/lib/date';
import { SearchableSelect } from '@/ui/forms';
import { useInstrumentsList } from '../../instruments/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { useItemsList } from '../../items/api';
import { JobCardPicker, OperatorPicker } from '../../store-issues/components/issue-pickers';
import { useCreateToolIssue } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function blockedReason(i: InstrumentListItem, issueDate: string): string | null {
  if (i.writeoffPending) return 'write-off pending';
  if (i.calibrationDueOn && i.calibrationDueOn < issueDate) return 'calibration overdue';
  return null;
}

export function NewToolIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [issueDate, setIssueDate] = useState(todayIst());
  const [expected, setExpected] = useState(todayIst());
  const [itemId, setItemId] = useState<string | null>(null);
  // The picked item is kept here: a new search must not drop it (review 5).
  const [item, setItem] = useState<{ id: string; code: string; trackSerial: boolean } | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [qty, setQty] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [issuedToText, setIssuedToText] = useState('');
  const [jobCardId, setJobCardId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const createMut = useCreateToolIssue();
  // Same "discard unsaved changes?" guard as the other Store pop-ups.
  const dirty = Boolean(
    itemId ||
    qty.trim() ||
    picked.length ||
    issuedToText.trim() ||
    purpose.trim() ||
    remarks.trim(),
  );
  const guard = useDiscardGuard(dirty, onClose);

  const items = useItemsList({
    search: itemSearch.trim() || undefined,
    itemType: 'tool',
    limit: 30,
    offset: 0,
  });
  const serial = item?.trackSerial === true;
  const options = useMemo(
    () => (items.data?.items ?? []).map((i) => ({ id: i.id, code: i.code, name: i.name })),
    [items.data],
  );
  const instruments = useInstrumentsList(
    { itemId: itemId ?? undefined, status: 'in_store', limit: 100, offset: 0 },
    serial,
  );

  const pickItem = (id: string | null): void => {
    setItemId(id);
    const it = items.data?.items.find((x) => x.id === id);
    setItem(it ? { id: it.id, code: it.code, trackSerial: it.trackSerial === true } : null);
    setPicked([]);
    setQty('');
  };
  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = (): void => {
    setErr(null);
    const fail = (m: string): void => setErr(m);
    if (!itemId) return fail('Pick the tool.');
    if (!operatorId && !issuedToText.trim())
      return fail('Pick who received it (Operator) or type a name.');
    if (expected < issueDate) return fail('Expected Return Date cannot be before the Issue Date.');
    if (purpose.trim().length < 3) return fail('Enter the Purpose (at least 3 characters).');
    const input: CreateToolIssueInput = {
      issueDate,
      expectedReturnDate: expected,
      itemId,
      purpose: purpose.trim(),
    };
    if (serial) {
      if (picked.length === 0) return fail('Tick the instrument(s) to issue.');
      input.instrumentIds = picked;
    } else {
      const q = Number(qty);
      if (!qty.trim() || !Number.isFinite(q) || q <= 0) return fail('Enter the Issue Qty.');
      if (r3(q) !== q) return fail('Issue Qty allows at most 3 decimals.');
      input.qty = q;
    }
    if (operatorId) input.operatorId = operatorId;
    else input.issuedToText = issuedToText.trim();
    if (jobCardId) input.jobCardId = jobCardId;
    if (remarks.trim()) input.remarks = remarks.trim();
    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not issue. Try again.'),
    });
  };

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) guard.requestClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 820, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">Issue Tool</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={guard.requestClose}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          {guard.dialog}
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="ti-item">
                Tool / Instrument <span className="req">★</span>
              </label>
              <SearchableSelect
                id="ti-item"
                value={itemId}
                onChange={pickItem}
                options={options}
                valueLabel={item?.code}
                onSearch={setItemSearch}
                loading={items.isFetching}
                placeholder="🔍 Tool item code or name…"
                emptyText="No matching Tool / Instrument item"
              />
            </div>

            <div className="form-grp">
              <label className="form-label">
                Issue Date <span className="req">★</span>
              </label>
              <input
                type="date"
                className="innovic-input"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Expected Return Date <span className="req">★</span>
              </label>
              <input
                type="date"
                className="innovic-input"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>

            {item && !serial ? (
              <div className="form-grp">
                <label className="form-label">
                  Issue Qty <span className="req">★</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="innovic-input mono fw-700"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                />
              </div>
            ) : null}

            <div className="form-grp">
              <label className="form-label" htmlFor="ti-op">
                Issued To <span className="req">★</span>
              </label>
              <OperatorPicker id="ti-op" value={operatorId} onChange={setOperatorId} />
              {!operatorId ? (
                <input
                  type="text"
                  className="innovic-input"
                  style={{ marginTop: 4 }}
                  placeholder="…or type a name if not an operator"
                  value={issuedToText}
                  onChange={(e) => setIssuedToText(e.target.value)}
                />
              ) : null}
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ti-jc">
                Job Card
              </label>
              <JobCardPicker id="ti-jc" value={jobCardId} onChange={setJobCardId} />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Purpose <span className="req">★</span>
              </label>
              <input
                type="text"
                className="innovic-input"
                placeholder="e.g. inspection of IN-JC-26-00021"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input
                type="text"
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {serial ? (
            <div style={{ marginTop: 12 }}>
              <div className="fw-700" style={{ fontSize: 12, marginBottom: 6 }}>
                Instruments in store — tick the ones handed out
              </div>
              {instruments.isLoading ? (
                <div className="text3" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="inline animate-spin" /> Loading…
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="innovic-table tbl-grid">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Instrument Serial No.</th>
                        <th>Calibration Due</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(instruments.data?.items ?? []).map((i) => {
                        const blocked = blockedReason(i, issueDate);
                        return (
                          <tr key={i.id} style={{ opacity: blocked ? 0.55 : 1 }}>
                            <td>
                              <input
                                type="checkbox"
                                disabled={Boolean(blocked)}
                                checked={picked.includes(i.id)}
                                onChange={() => toggle(i.id)}
                                aria-label={`Issue ${i.serialNo}`}
                              />
                            </td>
                            <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                              {i.serialNo}
                            </td>
                            <td style={{ color: blocked ? 'var(--red2)' : undefined }}>
                              {i.calibrationDueOn ? fmtDate(i.calibrationDueOn) : '—'}
                              {blocked ? ` · ${blocked}` : ''}
                            </td>
                            <td className="text3">{i.location || '—'}</td>
                          </tr>
                        );
                      })}
                      {(instruments.data?.items ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={4} className="empty-state">
                            No instrument of this item is in store.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {err ? (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'var(--red3)',
                color: 'var(--red2)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={guard.requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={save}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Issue Tool'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
