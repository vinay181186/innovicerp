// New Invoice — pick an SO, invoice up to the available (dispatched − invoiced)
// qty per line. Mirror of legacy _createInvoice (L21152).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateInvoice, useFinanceSoOptions, useInvoiceableSo } from '../api';

export const invoiceNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/new',
  component: InvoiceNewPage,
});

const todayStr = (): string => new Date().toISOString().slice(0, 10);

function InvoiceNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: soOpts } = useFinanceSoOptions();
  const create = useCreateInvoice();

  const [soId, setSoId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [termsDays, setTermsDays] = useState('45');
  const [gstPercent, setGstPercent] = useState('18');
  const [remarks, setRemarks] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  const { data: inv } = useInvoiceableSo(soId || undefined);

  useEffect(() => {
    if (!inv) return;
    const q: Record<string, number> = {};
    const r: Record<string, number> = {};
    for (const l of inv.lines) {
      q[l.salesOrderLineId] = l.availableQty;
      r[l.salesOrderLineId] = l.rate;
    }
    setQtys(q);
    setRates(r);
  }, [inv]);

  const lines = (inv?.lines ?? []).map((l) => ({
    ...l,
    qty: qtys[l.salesOrderLineId] ?? 0,
    useRate: rates[l.salesOrderLineId] ?? l.rate,
  }));
  const subtotal = lines.reduce((s, l) => s + l.qty * l.useRate, 0);
  const gstAmt = Math.round((subtotal * Number(gstPercent || 0)) / 100 * 100) / 100;
  const grand = subtotal + gstAmt;

  async function submit(): Promise<void> {
    setErr(null);
    const payloadLines = lines
      .filter((l) => l.qty > 0)
      .map((l) => ({ salesOrderLineId: l.salesOrderLineId, qty: l.qty, rate: l.useRate }));
    if (!soId) return setErr('Select an SO');
    if (payloadLines.length === 0) return setErr('Enter an invoice qty on at least one line');
    try {
      const created = await create.mutateAsync({
        salesOrderId: soId,
        invoiceDate,
        paymentTermsDays: Number(termsDays) || 0,
        gstPercent: Number(gstPercent) || 0,
        remarks: remarks || undefined,
        lines: payloadLines,
      });
      void navigate({ to: '/invoices/$id', params: { id: created.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create invoice');
    }
  }

  return (
    <div>
      <Link to="/invoices" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Invoices
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">📄 Create Invoice</span>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Sales Order ★</label>
              <select className="innovic-input" value={soId} onChange={(e) => setSoId(e.target.value)}>
                <option value="">-- Select SO --</option>
                {(soOpts?.options ?? []).map((o) => (
                  <option key={o.salesOrderId} value={o.salesOrderId}>
                    {o.soCode} — {o.customer ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Invoice Date</label>
              <input type="date" className="innovic-input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Payment Terms (days)</label>
              <input type="number" className="innovic-input" value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">GST %</label>
              <select className="innovic-input" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)}>
                {['0', '5', '12', '18', '28'].map((g) => (
                  <option key={g} value={g}>{g}%</option>
                ))}
              </select>
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input className="innovic-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          {inv ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', marginBottom: 6 }}>
                ▸ ITEMS AVAILABLE TO INVOICE (dispatched − already invoiced)
              </div>
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Name</th>
                    <th className="td-ctr">Order</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>Dispatched</th>
                    <th className="td-ctr">Invoiced</th>
                    <th className="td-ctr" style={{ color: 'var(--amber)' }}>Available</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>Invoice Qty</th>
                    <th className="td-ctr">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.length === 0 ? (
                    <tr><td colSpan={8} className="empty-state">No lines</td></tr>
                  ) : (
                    inv.lines.map((l) => (
                      <tr key={l.salesOrderLineId}>
                        <td className="td-code" style={{ color: 'var(--purple)' }}>{l.itemCode ?? '—'}</td>
                        <td style={{ fontSize: 11 }}>{l.itemName}</td>
                        <td className="td-ctr mono">{l.orderQty}</td>
                        <td className="td-ctr mono" style={{ color: 'var(--green)' }}>{l.dispatchedQty}</td>
                        <td className="td-ctr mono text3">{l.invoicedQty}</td>
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
                                [l.salesOrderLineId]: Math.max(0, Math.min(l.availableQty, Number(e.target.value) || 0)),
                              }))
                            }
                            style={{ width: 80, textAlign: 'center' }}
                          />
                        </td>
                        <td className="td-ctr">
                          <input
                            type="number"
                            className="innovic-input"
                            min={0}
                            step="0.01"
                            value={rates[l.salesOrderLineId] ?? 0}
                            onChange={(e) =>
                              setRates((r) => ({ ...r, [l.salesOrderLineId]: Number(e.target.value) || 0 }))
                            }
                            style={{ width: 90, textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'flex-end', marginTop: 10, fontSize: 13 }}>
                <span>Subtotal: <b>₹{subtotal.toFixed(2)}</b></span>
                <span style={{ color: 'var(--amber)' }}>GST: <b>₹{gstAmt.toFixed(2)}</b></span>
                <span style={{ color: 'var(--green)' }}>Total: <b>₹{grand.toFixed(2)}</b></span>
              </div>
            </div>
          ) : null}

          {err ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => void navigate({ to: '/invoices' })}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Saving…' : 'Create Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
