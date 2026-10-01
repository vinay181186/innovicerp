// New Outward DC modal (split out of routes/list.tsx). Picks a job-work /
// service PO, loads its lines, and sends material out. A `?jw=` deep link from
// a JWSO pre-picks the PO that carries it.

import { type CreateJwDcOutwardInput, type CreateJwDcOutwardLineInput } from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { useJobWorkOrder } from '../../job-work-orders/api';
import { usePurchaseOrdersList } from '../../purchase-orders/api';
import { useCreateJwDcOutward, useJwDcPoLines, useNextOutwardCode } from '../api';
import { ErrorBox, ModalShell } from './modal-shell';
import { OutwardLineTable, type OutwardLineUi } from './outward-line-table';

/** PO statuses material may go out against: approved and still live. */
const SENDABLE_PO_STATUSES: ReadonlySet<string> = new Set(['open', 'partial', 'qc_pending']);

export function NewOutwardModal({
  onClose,
  forJwId,
}: {
  onClose: () => void;
  /** `?jw=` deep link from a JWSO. An outward DC is keyed by the job-work PO,
   *  not the JWSO, so the PO list is asked for the POs whose lines trace to
   *  that JWSO (`jobWorkOrderId`, ADR-190 addendum): exactly one is pre-picked,
   *  several narrow the PO picker to them, none leaves the full picker. */
  forJwId?: string | undefined;
}): React.JSX.Element {
  const { data: forJw } = useJobWorkOrder(forJwId);
  const [date, setDate] = useState(todayLocal());
  const [poId, setPoId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<OutwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Anything the user typed, picked or ticked — arms the exit question.
  const [touched, setTouched] = useState(false);

  const { data: next } = useNextOutwardCode();

  // POs that send material out, for the JWPO dropdown (bug 4.1 — was a free-text
  // picker). Two calls rather than one: the list query's `poType` filter takes a
  // single value, and dropping the filter to sort client-side would risk the
  // 200-row cap hiding job-work POs behind a wall of ordinary buys.
  const { data: poDataJw } = usePurchaseOrdersList({ poType: 'job_work', limit: 200, offset: 0 });
  const { data: poDataSvc } = usePurchaseOrdersList({ poType: 'service', limit: 200, offset: 0 });
  // `?jw=` — the job-work / service POs carrying this JWSO's work.
  const { data: poDataForJw } = usePurchaseOrdersList(
    { jobWorkOrderId: forJwId, limit: 200, offset: 0 },
    { enabled: Boolean(forJwId) },
  );
  const forJwPos = forJwId ? (poDataForJw?.items ?? null) : null;
  // Only an approved, live PO can send material out — the server refuses a
  // Draft, Closed or Cancelled one (same rule as the OSP DC), so they are not
  // offered here either.
  const poData = useMemo(() => {
    const all =
      forJwPos && forJwPos.length > 0
        ? forJwPos
        : [...(poDataJw?.items ?? []), ...(poDataSvc?.items ?? [])];
    return { items: all.filter((p) => SENDABLE_PO_STATUSES.has(p.status)) };
  }, [forJwPos, poDataJw, poDataSvc]);
  // Exactly one PO carries the JWSO → pick it (once; the user may change it).
  const [prePicked, setPrePicked] = useState(false);
  useEffect(() => {
    if (prePicked || !forJwPos) return;
    setPrePicked(true);
    const sendable = forJwPos.filter((p) => SENDABLE_PO_STATUSES.has(p.status));
    if (sendable.length === 1 && sendable[0]) setPoId(sendable[0].id);
  }, [forJwPos, prePicked]);
  const selectedPo = useMemo(() => poData.items.find((p) => p.id === poId) ?? null, [poData, poId]);

  const { data: poLines } = useJwDcPoLines(poId ?? undefined);
  // Sync lines from server response once
  useMemo(() => {
    if (poLines) {
      setLines(
        poLines.lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          itemCode: l.itemCode,
          itemRevision: l.itemRevision,
          clientPoLineNo: l.clientPoLineNo,
          itemName: l.itemName,
          processText: l.processText,
          uom: l.uom,
          poQty: l.poQty,
          alreadySent: l.alreadySent,
          available: l.available,
          sendQty: l.available,
          checked: l.available > 0,
        })),
      );
    } else {
      setLines([]);
    }
  }, [poLines]);

  const createMut = useCreateJwDcOutward();

  const onSave = (): void => {
    setErr(null);
    if (!poId) {
      setErr('PO No. is required.');
      return;
    }
    const valid: CreateJwDcOutwardLineInput[] = lines
      .filter((l) => l.checked && l.sendQty > 0)
      .map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, sentQty: l.sendQty }));
    if (valid.length === 0) {
      setErr('Tick at least one line and enter Send Now.');
      return;
    }
    const input: CreateJwDcOutwardInput = {
      dcDate: date,
      purchaseOrderId: poId,
      lines: valid,
    };
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save JW DC. Check the lines and try again.',
        ),
    });
  };

  const setLine = (i: number, patch: Partial<OutwardLineUi>): void => {
    setTouched(true);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  return (
    <ModalShell
      onClose={onClose}
      title="New Outward DC"
      onSave={onSave}
      saving={createMut.isPending}
      saveLabel="Save Outward DC"
      dirty={touched}
    >
      {forJw ? (
        <div
          className="text2"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'var(--purple3)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          For JWSO <span className="td-code">{forJw.code}</span>
          {forJw.customerName ? <> · {forJw.customerName}</> : null}
        </div>
      ) : null}
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-grp">
          <label className="form-label">Outward DC No.</label>
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label">DC Date</label>
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => {
              setTouched(true);
              setDate(e.target.value);
            }}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">
            PO No.<span className="req">★</span>
          </label>
          <select
            className="innovic-select"
            value={poId ?? ''}
            onChange={(e) => {
              setTouched(true);
              setPoId(e.target.value || null);
            }}
          >
            <option value="">-- Select PO --</option>
            {poData.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.vendorName ?? p.vendorCodeText ?? ''}
              </option>
            ))}
          </select>
        </div>
        {selectedPo ? (
          <div className="form-grp form-full">
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg3)',
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontSize: 12,
              }}
            >
              <b>Vendor:</b> {selectedPo.vendorName ?? selectedPo.vendorCodeText ?? '—'} |{' '}
              <b>PO:</b> {selectedPo.code} | <b>Lines:</b> {lines.length}
            </div>
          </div>
        ) : null}
      </div>

      {lines.length > 0 ? <OutwardLineTable lines={lines} setLine={setLine} /> : null}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <div className="form-grp">
          <label className="form-label">Vehicle No.</label>
          <input
            type="text"
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => {
              setTouched(true);
              setVehicleNo(e.target.value);
            }}
            placeholder="GJ-05-XX-1234"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Remarks</label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => {
              setTouched(true);
              setRemarks(e.target.value);
            }}
          />
        </div>
      </div>

      {err ? <ErrorBox message={err} /> : null}
    </ModalShell>
  );
}
