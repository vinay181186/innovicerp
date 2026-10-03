// New Customer Material Return (ADR-203, owner decision D3) — sends the
// customer's own raw material back against one JWSO.
//
// Steps: pick the JWSO (open OR closed — material is often returned after the
// order closes) → the server lists what can still go back
// (GET /customer-material-returns/returnable): spare GOOD material per JWSO
// line, and REJECTED pieces per Party GRN line → type a Return Qty on the rows
// going back (blank = not this time) → Return Date, Vehicle No., Remarks →
// Save. The caps shown are the server's; it re-checks them under lock and its
// message is shown inline. After Save the modal offers the print.
//
// Picking a different JWSO clears every typed qty (they belonged to the old
// JWSO's rows).

import type {
  CreateCustomerMaterialReturnInput,
  CustomerMaterialReturn,
  CustomerMaterialReturnableRow,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { useCreateCustomerMaterialReturn, useCustomerMaterialReturnable } from '../api';
import { CMR_KIND_LABEL } from './cmr-columns';

/** One returnable row's identity: kind + JWSO line (+ Party GRN line). */
function rowKey(r: CustomerMaterialReturnableRow): string {
  return `${r.kind}:${r.jwLineId}:${r.partyGrnLineId ?? ''}`;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 20,
  maxHeight: '90vh',
  overflowY: 'auto',
};

export function NewCmrModal({
  onClose,
  onPrint,
}: {
  onClose: () => void;
  /** Print the saved return (the list's ⋯ Print logic). */
  onPrint: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [returnDate, setReturnDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  /** Typed Return Qty per returnable row (rowKey → text). */
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<CustomerMaterialReturn | null>(null);
  const [printing, setPrinting] = useState(false);

  // No status filter: a JWSO that has closed still has the customer's spare
  // or rejected material sitting in the store.
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwDetail = jwDetailQ.data && jwDetailQ.data.id === jwId ? jwDetailQ.data : null;
  const picked = jwHeaders.find((j) => j.jwId === jwId) ?? null;
  const customerName = picked?.customerName ?? jwDetail?.customerName ?? '';

  const returnableQ = useCustomerMaterialReturnable(jwId ?? undefined);
  const rows = useMemo(
    () => (returnableQ.data ?? []).filter((r) => r.returnableQty > 0),
    [returnableQ.data],
  );

  const saveKey = useSaveKey();
  const createMut = useCreateCustomerMaterialReturn(saveKey);

  const dirty =
    jwId !== null ||
    Boolean(vehicleNo.trim() || remarks.trim()) ||
    Object.values(qtys).some((v) => v.trim() !== '');
  const guard = useDiscardGuard(dirty && !saved, onClose);

  const onPickJw = (id: string | null): void => {
    setJwId(id);
    setQtys({});
    setErr(null);
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('JWSO No. is required.');
      return;
    }
    const lines: CreateCustomerMaterialReturnInput['lines'] = [];
    for (const r of rows) {
      const raw = (qtys[rowKey(r)] ?? '').trim();
      if (!raw) continue;
      const q = Number(raw);
      const label = `JWSO L${r.jwLineNo} (${CMR_KIND_LABEL[r.kind]})`;
      if (!Number.isInteger(q) || q <= 0) {
        setErr(`${label}: Return Qty must be a whole number, 1 or more.`);
        return;
      }
      if (q > r.returnableQty) {
        setErr(`${label}: Return Qty (${q}) cannot be more than Returnable (${r.returnableQty}).`);
        return;
      }
      lines.push({
        kind: r.kind,
        jwLineId: r.jwLineId,
        ...(r.kind === 'rejected' && r.partyGrnLineId ? { partyGrnLineId: r.partyGrnLineId } : {}),
        qty: q,
      });
    }
    if (lines.length === 0) {
      setErr('Type a Return Qty on at least one row.');
      return;
    }
    const input: CreateCustomerMaterialReturnInput = { returnDate, jobWorkOrderId: jwId, lines };
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: (row) => setSaved(row),
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not save the return. Try again.'),
    });
  };

  // After Save: say so and offer the paper that goes with the material.
  if (saved) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div
          style={{ ...cardStyle, width: 'min(480px, 96vw)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="section-hdr" style={{ marginBottom: 10 }}>
            Customer Material Return saved
          </div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            <span className="mono fw-700">{saved.code}</span> — {saved.totalQty} pcs back to the
            customer on {saved.jwCode ?? 'the JWSO'}. Print the return to send with the material.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={printing}
              onClick={() => {
                setPrinting(true);
                void onPrint(saved.id).finally(() => setPrinting(false));
              }}
            >
              {printing ? <Loader2 size={14} className="inline animate-spin" /> : null} Print
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) guard.requestClose();
      }}
    >
      {guard.dialog}
      <div
        style={{ ...cardStyle, width: 'min(1000px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          New Customer Material Return
        </div>

        <div className="form-grid">
          <div className="form-grp">
            <label className="form-label" htmlFor="cmr-date">
              Return Date<span className="req">★</span>
            </label>
            <input
              id="cmr-date"
              type="date"
              className="innovic-input"
              style={{ maxWidth: '18ch' }}
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="cmr-customer">
              Customer
            </label>
            <input
              id="cmr-customer"
              type="text"
              className="innovic-input"
              readOnly
              value={customerName}
            />
          </div>
          <div className="form-grp form-full">
            <label className="form-label" htmlFor="cmr-jwso">
              JWSO No.<span className="req">★</span>
            </label>
            <SearchableSelect
              id="cmr-jwso"
              value={jwId}
              onChange={onPickJw}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              placeholder="🔍 Select JWSO — type number or customer…"
              options={jwHeaders.map((j) => ({
                id: j.jwId,
                code: j.code,
                name: j.customerName ?? '',
              }))}
              valueLabel={
                jwDetail ? `${jwDetail.code} — ${jwDetail.customerName ?? ''}` : undefined
              }
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="cmr-vehicle">
              Vehicle No.
            </label>
            <input
              id="cmr-vehicle"
              type="text"
              className="innovic-input"
              style={{ maxWidth: '16ch' }}
              autoComplete="off"
              maxLength={32}
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
            />
          </div>
          <div className="form-grp form-full">
            <label className="form-label" htmlFor="cmr-remarks">
              Remarks
            </label>
            <input
              id="cmr-remarks"
              type="text"
              className="innovic-input"
              autoComplete="off"
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            margin: '14px 0 8px',
            fontSize: 11,
            color: 'var(--cyan)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
          }}
        >
          Material that can go back
        </div>

        {!jwId ? (
          <div className="empty-state" style={{ padding: 14 }}>
            Pick a JWSO first.
          </div>
        ) : returnableQ.isLoading ? (
          <div className="text3" style={{ fontSize: 12, padding: 8 }}>
            <Loader2 size={13} className="inline animate-spin" /> Loading…
          </div>
        ) : returnableQ.isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)', padding: 14 }}>
            {returnableQ.error instanceof Error
              ? returnableQ.error.message
              : 'Could not load what can be returned. Try again.'}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            Nothing of this customer&apos;s material is left to return on this JWSO.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Return Kind</th>
                  <th>JWSO Line</th>
                  <th>Item Code</th>
                  <th>Customer RM</th>
                  <th>Party GRN No.</th>
                  <th className="th-num">Returnable Qty</th>
                  <th className="th-num">Return Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = rowKey(r);
                  return (
                    <tr key={k}>
                      <td>
                        <span className={`badge ${r.kind === 'rejected' ? 'b-red' : 'b-green'}`}>
                          {CMR_KIND_LABEL[r.kind]}
                        </span>
                      </td>
                      <td className="mono" style={{ color: 'var(--purple)' }}>
                        L{r.jwLineNo}
                      </td>
                      <td className="td-code">{r.partCode ?? '—'}</td>
                      <td className="td-code" style={{ color: 'var(--text)' }}>
                        {r.rmItemCode ?? r.partyMaterialCode}
                      </td>
                      <td className="mono text2">{r.partyGrnCode ?? '—'}</td>
                      <td className="td-num mono fw-700">{r.returnableQty}</td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={1}
                          max={r.returnableQty}
                          step={1}
                          className="innovic-input"
                          aria-label={`Return Qty for JWSO L${r.jwLineNo} ${CMR_KIND_LABEL[r.kind]}`}
                          placeholder="—"
                          value={qtys[k] ?? ''}
                          onChange={(e) => setQtys((prev) => ({ ...prev, [k]: e.target.value }))}
                          style={{ width: '10ch', fontWeight: 700 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {err ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--red2)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={guard.requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending || !jwId || rows.length === 0}
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
