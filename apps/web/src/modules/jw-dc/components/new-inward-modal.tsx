// New Inward Entry modal (split out of routes/list.tsx). Receives processed
// material back against an outward DC that still has a pending return. The store
// records only how much came back; accept / reject happens at Incoming QC.

import { type CreateJwDcInwardInput, type CreateJwDcInwardLineInput } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { Banner } from '@/ui/feedback';
import {
  useCreateJwDcInward,
  useJwDcOutwardDetail,
  useJwDcOutwardList,
  useNextInwardCode,
} from '../api';
import { ErrorBox, ModalShell } from './modal-shell';

interface InwardLineUi {
  outwardLineId: string;
  itemCode: string;
  /** Customer's drawing revision off the order line behind this DC line. */
  itemRevision: string | null;
  /** The CUSTOMER's own purchase-order line number (POL), read-only. */
  clientPoLineNo: string | null;
  itemName: string;
  processText: string | null;
  sentQty: number;
  alreadyReturned: number;
  pending: number;
  receivedQty: number;
}

export function NewInwardModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [dcId, setDcId] = useState<string | null>(null);
  const [vendorChallan, setVendorChallan] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<InwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Anything the user typed or picked — arms the exit question.
  const [touched, setTouched] = useState(false);

  const { data: next } = useNextInwardCode();

  // Outward DCs with pending returns (filter client-side)
  const { data: outData } = useJwDcOutwardList({ limit: 200, offset: 0 });
  const pendingDcs = useMemo(
    () => (outData?.items ?? []).filter((d) => d.pendingQty > 0),
    [outData],
  );

  const { data: detail } = useJwDcOutwardDetail(dcId ?? undefined);
  useMemo(() => {
    if (detail) {
      setLines(
        detail.lines.map((l) => ({
          outwardLineId: l.id,
          itemCode: l.itemCode ?? l.itemCodeText,
          itemRevision: l.itemRevision,
          clientPoLineNo: l.clientPoLineNo,
          itemName: l.itemName ?? l.itemNameText ?? '',
          processText: l.processText,
          sentQty: l.sentQty,
          alreadyReturned: l.alreadyReturned,
          pending: l.pending,
          receivedQty: l.pending,
        })),
      );
    } else {
      setLines([]);
    }
  }, [detail]);

  const createMut = useCreateJwDcInward();

  const onSave = (): void => {
    setErr(null);
    if (!dcId) {
      setErr('JW DC is required.');
      return;
    }
    const valid: CreateJwDcInwardLineInput[] = [];
    for (const l of lines) {
      if (l.receivedQty <= 0) continue;
      valid.push({ jwDcOutwardLineId: l.outwardLineId, receivedQty: l.receivedQty });
    }
    if (valid.length === 0) {
      setErr('Enter Receive Now for at least one line.');
      return;
    }
    const input: CreateJwDcInwardInput = {
      inwardDate: date,
      jwDcOutwardId: dcId,
      lines: valid,
    };
    if (vendorChallan.trim()) input.vendorChallanNo = vendorChallan.trim();
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save Inward. Check the lines and try again.',
        ),
    });
  };

  const setLine = (i: number, patch: Partial<InwardLineUi>): void => {
    setTouched(true);
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const nextLine = { ...l, ...patch };
        // Re-clamp to pending bound
        nextLine.receivedQty = Math.min(Math.max(0, nextLine.receivedQty), l.pending);
        return nextLine;
      }),
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      title="New Inward Entry"
      onSave={onSave}
      saving={createMut.isPending}
      saveLabel="Save Inward"
      dirty={touched}
    >
      {/* ADR-189 — Incoming QC is the only inspector. The store records what
          came back; accept / reject happens at Incoming QC, as for DC Receive. */}
      <Banner tone="info">Received qty goes to Incoming QC — no accept/reject here.</Banner>
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-grp">
          <label className="form-label">Inward No.</label>
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Inward Date</label>
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
            JW DC<span className="req">★</span>
          </label>
          <select
            className="innovic-select"
            value={dcId ?? ''}
            onChange={(e) => {
              setTouched(true);
              setDcId(e.target.value || null);
            }}
          >
            <option value="">-- Select DC --</option>
            {pendingDcs.map((dc) => (
              <option key={dc.id} value={dc.id}>
                {dc.code} — {dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? ''} (
                {dc.jwpoCodeText})
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Vendor Challan No.</label>
          <input
            type="text"
            className="innovic-input"
            value={vendorChallan}
            onChange={(e) => {
              setTouched(true);
              setVendorChallan(e.target.value);
            }}
            placeholder="Vendor reference"
          />
        </div>
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
            placeholder="GJ-05-XX-5678"
          />
        </div>
      </div>

      {lines.length > 0 ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div
            style={{ padding: '8px 12px', background: 'var(--bg4)', fontWeight: 700, fontSize: 12 }}
          >
            DC Lines
          </div>
          <table style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ padding: 6, color: 'var(--purple)' }}>POL</th>
                <th style={{ padding: 6 }}>Item Code · Name</th>
                <th style={{ padding: 6, color: 'var(--purple)' }}>Process</th>
                <th className="th-num" style={{ padding: 6 }}>
                  Sent
                </th>
                <th className="th-num" style={{ padding: 6, color: 'var(--green2)' }}>
                  Received
                </th>
                <th className="th-num" style={{ padding: 6, color: 'var(--amber2)' }}>
                  Pending
                </th>
                <th className="th-num" style={{ padding: 6 }}>
                  Receive Now
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const hasPending = l.pending > 0;
                return (
                  <tr
                    key={l.outwardLineId}
                    style={{
                      background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
                      opacity: hasPending ? 1 : 0.4,
                    }}
                  >
                    <td
                      className="td-ctr mono fw-700"
                      style={{ padding: 6, color: 'var(--purple)' }}
                    >
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td style={{ padding: 6, fontSize: 12 }}>
                      <b>{itemCodeWithRev(l.itemCode, l.itemRevision)}</b>{' '}
                      <span style={{ color: 'var(--text3)' }}>{l.itemName}</span>
                    </td>
                    <td style={{ padding: 6, fontSize: 11, color: 'var(--purple)' }}>
                      {l.processText ?? '—'}
                    </td>
                    <td className="mono td-num" style={{ padding: 6 }}>
                      {l.sentQty}
                    </td>
                    <td className="mono td-num" style={{ padding: 6, color: 'var(--green2)' }}>
                      {l.alreadyReturned > 0 ? l.alreadyReturned : '0'}
                    </td>
                    <td
                      className="mono fw-700 td-num"
                      style={{ padding: 6, color: l.pending > 0 ? 'var(--amber)' : 'var(--green)' }}
                    >
                      {l.pending}
                    </td>
                    <td className="td-num" style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        max={l.pending}
                        value={l.receivedQty}
                        disabled={!hasPending}
                        onChange={(e) => {
                          const r = Math.min(Number(e.target.value) || 0, l.pending);
                          setLine(i, { receivedQty: r });
                        }}
                        style={{ width: 65, fontSize: 13, fontWeight: 700, textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="form-grp" style={{ marginTop: 14 }}>
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

      {err ? <ErrorBox message={err} /> : null}
    </ModalShell>
  );
}
