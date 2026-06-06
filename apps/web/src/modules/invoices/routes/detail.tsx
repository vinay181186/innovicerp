// Invoice detail — mirror of legacy _viewInvoice (L21273) + _addPayment.
// Shows the invoice as an A4-portrait paper preview (the EXACT markup the
// print produces — user direction 2026-06-06: screen = print), plus header
// stats, inline add-payment and the payments panel.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useAddPayment, useInvoice } from '../api';
import { invoiceDocHtml, printInvoice } from '../lib/print';

export const invoiceDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/$id',
  component: InvoiceDetailPage,
});

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;
const todayStr = (): string => new Date().toISOString().slice(0, 10);

function InvoiceDetailPage(): React.JSX.Element {
  const { id } = invoiceDetailRoute.useParams();
  const { data: inv, isLoading, isError, error } = useInvoice(id);
  const { data: company } = useMyCompany();
  const addPayment = useAddPayment(id);
  const docHtml = useMemo(
    () => (inv ? invoiceDocHtml(inv, company) : ''),
    [inv, company],
  );

  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayStr());
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('NEFT');
  const [payRef, setPayRef] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !inv) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  async function submitPayment(): Promise<void> {
    setPayErr(null);
    const amount = Number(payAmt);
    if (!amount || amount <= 0) return setPayErr('Enter a payment amount');
    try {
      await addPayment.mutateAsync({
        paymentDate: payDate,
        amount,
        mode: payMode,
        refNo: payRef || undefined,
      });
      setPayOpen(false);
      setPayAmt('');
      setPayRef('');
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : 'Failed to record payment');
    }
  }

  const stats: { label: string; value: string; color?: string }[] = [
    { label: 'SUBTOTAL', value: inr(inv.subtotal) },
    { label: `GST ${inv.gstPercent}%`, value: inr(inv.gstAmount), color: 'var(--amber)' },
    { label: 'TOTAL', value: inr(inv.grandTotal), color: 'var(--green)' },
    { label: 'PAID', value: inr(inv.totalPaid), color: 'var(--cyan)' },
    { label: 'BALANCE', value: inr(inv.balance), color: inv.balance > 0 ? 'var(--red)' : 'var(--green)' },
  ];

  return (
    <div>
      <Link to="/invoices" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Invoices
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📄 Invoice {inv.code}{' '}
          <span className={`badge ${inv.status === 'paid' ? 'b-green' : inv.status === 'partial' ? 'b-amber' : 'b-red'}`}>
            {inv.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {inv.status !== 'paid' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPayOpen((v) => !v)}>
              💳 Add Payment
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => printInvoice(inv, company)}>
            🖨 Print
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text3" style={{ fontSize: 9 }}>{s.label}</div>
            <div className="mono fw-700" style={{ fontSize: 16, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
        SO: <b>{inv.soCode ?? '—'}</b> · Client: <b>{inv.clientName ?? '—'}</b> · Due: <b>{inv.dueDate ?? '—'}</b>
      </div>

      {payOpen ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">💳 Record Payment</span>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label">Payment Date</label>
                <input type="date" className="innovic-input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="form-grp">
                <label className="form-label">Amount ★</label>
                <input
                  type="number"
                  className="innovic-input"
                  value={payAmt}
                  placeholder={String(Math.round(inv.balance))}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">Mode</label>
                <select className="innovic-input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  {['NEFT', 'RTGS', 'Cheque', 'Cash', 'UPI', 'Other'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-grp">
                <label className="form-label">Reference No.</label>
                <input className="innovic-input" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              </div>
            </div>
            {payErr ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{payErr}</div> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPayOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={addPayment.isPending} onClick={() => void submitPayment()}>
                {addPayment.isPending ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* A4-portrait paper preview — identical markup to the print output. */}
      <div
        style={{
          maxWidth: 794, // A4 @96dpi: 794 × 1123
          minHeight: 1123,
          margin: '0 auto 14px',
          background: '#fff',
          boxShadow: '0 2px 14px rgba(0,0,0,.25)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
        // Self-built, esc()'d document HTML shared with the print window.
        dangerouslySetInnerHTML={{ __html: docHtml }}
      />

      {inv.payments.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">💳 Payments ({inv.payments.length})</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="td-ctr">Amount</th>
                  <th>Mode</th>
                  <th>Ref No.</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 11 }}>{p.paymentDate}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>{inr(p.amount)}</td>
                    <td style={{ fontSize: 11 }}>{p.mode}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{p.refNo ?? '—'}</td>
                    <td style={{ fontSize: 11 }} className="text3">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
