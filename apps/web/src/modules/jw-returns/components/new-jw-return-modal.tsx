// New JW Return modal — returns machined goods to the customer against a Job
// Work Order line (ADR-079). Split out of jw-dispatch-view.tsx (ADR-199, table
// standard). Behaviour, hooks, the qty guards and the post-save Print prompt are
// identical to the original.

import { type CreateJwReturnChallanInput, type JwReturnChallan } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreateJwReturnChallan, useJwReturnable } from '../api';
import { PrintJwReturnButton } from './print-jw-return-button';

export function NewJwReturnModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [returnDate, setReturnDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [jobWorkOrderLineId, setJobWorkOrderLineId] = useState('');
  const [qty, setQty] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Set once Save succeeds — the popup then offers Print challan.
  const [saved, setSaved] = useState<JwReturnChallan | null>(null);

  // ADR-104: NO status filter. A JWSO closes automatically the moment its Job
  // Card's final QC passes (ADR-099) — which is exactly when the goods are
  // ready to go back. Filtering to `open` made the finished order vanish from
  // this screen, so it could never be returned. The server never checked JWSO
  // status here; the qty guards (produced − already returned, and the ordered
  // qty ceiling) are what actually bound a return.
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];

  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwLines = jwDetailQ.data?.lines ?? [];

  // Returnable per line — the SAME limit the server enforces on Save.
  const returnableQ = useJwReturnable(jwId ?? undefined);
  const returnableById = useMemo(
    () => new Map((returnableQ.data?.lines ?? []).map((l) => [l.jobWorkOrderLineId, l])),
    [returnableQ.data],
  );
  const pickedReturnable = jobWorkOrderLineId ? returnableById.get(jobWorkOrderLineId) : undefined;

  const saveKey = useSaveKey();
  const createMut = useCreateJwReturnChallan(saveKey);

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('Select a JWSO');
      return;
    }
    if (!jobWorkOrderLineId) {
      setErr('Select a JW line');
      return;
    }
    const q = Number(qty);
    if (!qty.trim() || !Number.isInteger(q) || q <= 0) {
      setErr('Return Qty: whole numbers only, 1 or more.');
      return;
    }
    if (pickedReturnable && q > pickedReturnable.returnableQty) {
      setErr(
        `Return Qty (${q}) cannot be more than Returnable (${pickedReturnable.returnableQty}).`,
      );
      return;
    }
    const input: CreateJwReturnChallanInput = {
      returnDate,
      jobWorkOrderLineId,
      qty: q,
    };
    if (transport.trim()) input.transport = transport.trim();
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: (row) => setSaved(row),
      onError: (e) =>
        setErr(
          e instanceof Error
            ? e.message
            : 'Could not save JW Return. Check the lines and try again.',
        ),
    });
  };

  // After Save: say so and offer the challan for the goods going out.
  if (saved) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 20,
            width: 'min(480px, 96vw)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="section-hdr" style={{ marginBottom: 10 }}>
            📦 JW Return saved
          </div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            <span className="mono fw-700">{saved.code}</span> — {saved.qty} pcs back to the customer
            on {saved.jwCodeText ?? 'the JWSO'}. Print the challan to send with the goods.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <PrintJwReturnButton returnId={saved.id} primary />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(680px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          📦 New JW Return
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Return Date">
            <input
              type="date"
              className="innovic-input"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </Field>
          <div />

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No. ★">
              <SearchableSelect
                id="jwret-jwso"
                value={jwId}
                onChange={(id) => {
                  setJwId(id);
                  setJobWorkOrderLineId('');
                }}
                onSearch={setJwSearch}
                loading={jwQuery.isFetching}
                placeholder="🔍 Select JWSO — type number or customer…"
                options={jwHeaders.map((j) => ({
                  id: j.jwId,
                  code: j.code,
                  name: j.customerName ?? '',
                }))}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Ln ★">
              <select
                className="innovic-input"
                value={jobWorkOrderLineId}
                onChange={(e) => {
                  const lineId = e.target.value;
                  setJobWorkOrderLineId(lineId);
                  // Prefill with what can go back now; blank when nothing can.
                  const rq = returnableById.get(lineId)?.returnableQty ?? 0;
                  setQty(rq > 0 ? String(rq) : '');
                }}
                disabled={!jwId || jwDetailQ.isFetching}
                style={{ width: '100%' }}
              >
                <option value="">
                  {!jwId
                    ? 'Select a JWSO first'
                    : jwDetailQ.isFetching
                      ? 'Loading lines…'
                      : jwLines.length === 0
                        ? 'No lines'
                        : 'Select a line…'}
                </option>
                {jwLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    L{l.lineNo} · {l.partName} · Order Qty {l.orderQty}
                    {returnableById.has(l.id)
                      ? ` · Returnable ${returnableById.get(l.id)?.returnableQty ?? 0}`
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Return Qty ★">
            <input
              type="number"
              min={1}
              step={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{
                fontWeight: 700,
                border: '2px solid var(--green)',
                borderRadius: 4,
              }}
            />
            {pickedReturnable ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                Returnable <b className="mono">{pickedReturnable.returnableQty}</b> · Ready{' '}
                {pickedReturnable.readyQty} · Returned {pickedReturnable.returnedQty} · Pending{' '}
                {pickedReturnable.pendingQty}
                {pickedReturnable.returnableQty === 0 ? ' — complete final QC first' : ''}
              </div>
            ) : null}
          </Field>
          <Field label="Transporter">
            <input
              type="text"
              className="innovic-input"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Transporter name"
            />
          </Field>

          <Field label="Vehicle No.">
            <input
              type="text"
              className="innovic-input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="Vehicle number"
            />
          </Field>
          <Field label="Remarks">
            <input
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes"
            />
          </Field>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--red2)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Return'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
