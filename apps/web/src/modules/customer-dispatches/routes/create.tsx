// New Customer Dispatch — pick an SO, then dispatch up to the ready (produced +
// QC-accepted − already dispatched) qty per line. Mirror of legacy dispatch flow.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateDispatch, useDispatchableSo, useFinanceSoOptions } from '../api';

export const customerDispatchNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/new',
  component: CustomerDispatchNewPage,
});

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function CustomerDispatchNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: soOpts } = useFinanceSoOptions();
  const create = useCreateDispatch();

  const [soId, setSoId] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayStr());
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  const { data: dispatchable } = useDispatchableSo(soId || undefined);

  // Default each line's qty to its full available qty when an SO loads.
  useEffect(() => {
    if (!dispatchable) return;
    const next: Record<string, number> = {};
    for (const l of dispatchable.lines) next[l.salesOrderLineId] = l.availableQty;
    setQtys(next);
  }, [dispatchable]);

  async function submit(): Promise<void> {
    setErr(null);
    const lines = (dispatchable?.lines ?? [])
      .map((l) => ({ salesOrderLineId: l.salesOrderLineId, qty: qtys[l.salesOrderLineId] ?? 0 }))
      .filter((l) => l.qty > 0);
    if (!soId) return setErr('Select an SO');
    if (lines.length === 0) return setErr('Enter a dispatch qty on at least one line');
    try {
      await create.mutateAsync({
        salesOrderId: soId,
        dispatchDate,
        transport: transport || undefined,
        vehicleNo: vehicleNo || undefined,
        remarks: remarks || undefined,
        lines,
      });
      void navigate({ to: '/customer-dispatches' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create dispatch');
    }
  }

  return (
    <div>
      <Link to="/customer-dispatches" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Dispatch Register
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">🚚 New Customer Dispatch</span>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Sales Order ★</label>
              <select
                className="innovic-input"
                value={soId}
                onChange={(e) => setSoId(e.target.value)}
              >
                <option value="">-- Select SO --</option>
                {(soOpts?.options ?? []).map((o) => (
                  <option key={o.salesOrderId} value={o.salesOrderId}>
                    {o.soCode} — {o.customer ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Dispatch Date</label>
              <input
                type="date"
                className="innovic-input"
                value={dispatchDate}
                onChange={(e) => setDispatchDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Transport</label>
              <input className="innovic-input" value={transport} onChange={(e) => setTransport(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Vehicle No.</label>
              <input className="innovic-input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input className="innovic-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          {dispatchable ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', marginBottom: 6 }}>
                ▸ READY TO DISPATCH (produced + QC-accepted)
              </div>
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Name</th>
                    <th className="td-ctr">Order</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>Ready</th>
                    <th className="td-ctr">Dispatched</th>
                    <th className="td-ctr" style={{ color: 'var(--amber)' }}>Available</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>Dispatch Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchable.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-state">No lines</td>
                    </tr>
                  ) : (
                    dispatchable.lines.map((l) => (
                      <tr key={l.salesOrderLineId}>
                        <td className="td-code" style={{ color: 'var(--purple)' }}>{l.itemCode ?? '—'}</td>
                        <td style={{ fontSize: 11 }}>{l.itemName}</td>
                        <td className="td-ctr mono">{l.orderQty}</td>
                        <td className="td-ctr mono" style={{ color: 'var(--green)' }}>{l.readyQty}</td>
                        <td className="td-ctr mono text3">{l.dispatchedQty}</td>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>{l.availableQty}</td>
                        <td className="td-ctr">
                          <input
                            type="number"
                            className="innovic-input"
                            min={0}
                            max={l.availableQty}
                            value={qtys[l.salesOrderLineId] ?? 0}
                            disabled={l.availableQty <= 0}
                            onChange={(e) =>
                              setQtys((q) => ({
                                ...q,
                                [l.salesOrderLineId]: Math.max(
                                  0,
                                  Math.min(l.availableQty, Number(e.target.value) || 0),
                                ),
                              }))
                            }
                            style={{ width: 80, textAlign: 'center' }}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {err ? (
            <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{err}</div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => void navigate({ to: '/customer-dispatches' })}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Saving…' : 'Create Dispatch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
