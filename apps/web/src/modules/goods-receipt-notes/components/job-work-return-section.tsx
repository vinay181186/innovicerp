// Job Work Return inward section — routes to the EXISTING POST /jw-dc/inward
// (createJwDcInwardInputSchema → jw_dc_inward). Pick an OSP/JW outward DC, then
// reconcile each outward line into received / OK / rejected qty. No backend
// change; payload is exactly the existing contract.

import type { CreateJwDcInwardInput, ListJwDcOutwardQuery } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCreateJwDcInward, useJwDcOutwardDetail, useJwDcOutwardList } from '@/modules/jw-dc/api';

// ISSUE-065 mech.1 (named helper, NOT fixed here — reported): UTC-derived, so
// before 05:30 IST this yields YESTERDAY. Legacy today() L1485-87 is correct —
// it reads LOCAL getFullYear/getMonth/getDate. Reuse this helper, do not add a
// second copy; fix all copies together.
const today = (): string => new Date().toISOString().slice(0, 10);

interface LineDraft {
  outwardLineId: string;
  label: string;
  sentQty: number;
  pending: number;
  receivedQty: string;
  okQty: string;
  rejectedQty: string;
}

export function JobWorkReturnSection(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateJwDcInward();

  const [outwardId, setOutwardId] = useState('');
  const [inwardDate, setInwardDate] = useState(today());
  const [vendorChallanNo, setVendorChallanNo] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const listQuery: ListJwDcOutwardQuery = { limit: 200, offset: 0 };
  const { data: outwardList } = useJwDcOutwardList(listQuery);
  const { data: detail } = useJwDcOutwardDetail(outwardId || undefined);

  // When an outward DC is picked, seed the lines from its still-pending qty.
  useEffect(() => {
    if (!detail) {
      setLines([]);
      return;
    }
    setLines(
      detail.lines
        .filter((l) => l.pending > 0)
        .map((l) => ({
          outwardLineId: l.id,
          label: `${l.itemCodeText}${l.itemNameText ? ` — ${l.itemNameText}` : ''}`,
          sentQty: l.sentQty,
          pending: l.pending,
          receivedQty: String(l.pending),
          okQty: String(l.pending),
          rejectedQty: '0',
        })),
    );
  }, [detail]);

  const setLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onSave = async (): Promise<void> => {
    setErr(null);
    if (!outwardId) {
      setErr('Select an OSP / JW outward DC first.');
      return;
    }
    const payloadLines = lines
      .map((l) => ({
        jwDcOutwardLineId: l.outwardLineId,
        receivedQty: Number(l.receivedQty),
        okQty: Number(l.okQty),
        rejectedQty: Number(l.rejectedQty),
      }))
      .filter((l) => l.receivedQty > 0);
    if (payloadLines.length === 0) {
      setErr('Enter a received quantity on at least one line.');
      return;
    }
    const bad = payloadLines.find((l) => l.okQty + l.rejectedQty !== l.receivedQty);
    if (bad) {
      setErr('On every line, OK qty + Rejected qty must equal Received qty.');
      return;
    }
    const input: CreateJwDcInwardInput = {
      inwardDate,
      jwDcOutwardId: outwardId,
      ...(vendorChallanNo.trim() ? { vendorChallanNo: vendorChallanNo.trim() } : {}),
      ...(vehicleNo.trim() ? { vehicleNo: vehicleNo.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      lines: payloadLines,
    };
    try {
      await create.mutateAsync(input);
      await navigate({ to: '/jw-dc' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record job-work return.');
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--amber)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        ▸ JOB WORK RETURN (PROCESSED MATERIAL BACK FROM OSP/JW VENDOR)
      </div>

      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">
            OSP / JW Outward DC <span className="req">★</span>
          </label>
          <select
            className="innovic-select"
            value={outwardId}
            onChange={(e) => setOutwardId(e.target.value)}
          >
            <option value="">Select outward DC…</option>
            {outwardList?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.vendorNameText ?? o.vendorCodeText ?? '—'} ({o.pendingQty} pending)
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Inward Date</label>
          <input
            type="date"
            className="innovic-input"
            value={inwardDate}
            onChange={(e) => setInwardDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Vehicle No.</label>
          <input
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Vendor Challan No.</label>
          <input
            className="innovic-input"
            value={vendorChallanNo}
            onChange={(e) => setVendorChallanNo(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Remarks</label>
          <input
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="tbl-wrap" style={{ marginTop: 10 }}>
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="td-ctr">Sent</th>
              <th className="td-ctr">Pending</th>
              <th className="td-ctr">Received</th>
              <th className="td-ctr">OK</th>
              <th className="td-ctr">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  {outwardId ? 'No pending lines on this DC.' : 'Pick an outward DC to load its lines.'}
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={l.outwardLineId}>
                  <td>{idx + 1}</td>
                  <td>{l.label}</td>
                  <td className="td-ctr mono">{l.sentQty}</td>
                  <td className="td-ctr mono">{l.pending}</td>
                  <td className="td-ctr">
                    <input
                      className="innovic-input"
                      style={{ width: 70, textAlign: 'right' }}
                      type="number"
                      min={0}
                      value={l.receivedQty}
                      onChange={(e) => setLine(idx, { receivedQty: e.target.value })}
                    />
                  </td>
                  <td className="td-ctr">
                    <input
                      className="innovic-input"
                      style={{ width: 70, textAlign: 'right' }}
                      type="number"
                      min={0}
                      value={l.okQty}
                      onChange={(e) => setLine(idx, { okQty: e.target.value })}
                    />
                  </td>
                  <td className="td-ctr">
                    <input
                      className="innovic-input"
                      style={{ width: 70, textAlign: 'right' }}
                      type="number"
                      min={0}
                      value={l.rejectedQty}
                      onChange={(e) => setLine(idx, { rejectedQty: e.target.value })}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {err ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={create.isPending}
          onClick={() => void onSave()}
        >
          {create.isPending ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} Save Job Work Return
        </button>
      </div>
    </div>
  );
}
