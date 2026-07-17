// Invoice detail — ports legacy _viewInvoice (L21273, verified) plus the
// _addPayment form (L21243). Legacy renders both as modals off renderInvoices
// (L21096, the router's only `invoices` key L2457); the port is a route with a
// real URL, and add-payment is an inline panel rather than a second modal.
//
// Legacy deltas kept deliberately (do NOT "fix" without reading these):
//  - Legacy's plain lines table (L21303: # / Item / Name / Qty / Rate / Amount)
//    is replaced by the A4 paper preview — the same markup the print emits
//    (user direction 2026-06-06: screen = print; the same direction drives
//    lib/print/letterhead.ts, which names Invoice explicitly). No column is
//    lost: the preview carries Sl/Description/Qty/UOM/Rate/Amount.
//  - Action buttons stay in the page header. Legacy puts them at the end of the
//    modal body (L21306); after a 1123px-tall A4 preview that would bury them.
//  - Status renders as a badge (list mapping L21115) in place of legacy's
//    "(status)" parenthetical in the modal title (L21311).
//
// Money: every figure here is server-owned (subtotal/gstAmount/grandTotal/
// totalPaid/balance from service.ts rowToInvoice). `balance` is NOT re-derived
// in the browser — legacy computes it client-side at L21275, we do not.
//
// Known divergence (reported, not fixed here — needs the one shared IST/date
// helper): dates render as raw ISO. Legacy fmt() (L1484) shows "15 Jul 26" and
// the sibling list.tsx carries its own copy of that helper; adding a second
// copy here would be one more of the ~12 divergent fmt()s. All three date
// columns (invoice_date / due_date / payment_date) are `date`, not timestamptz,
// so no UTC-shift bug exists at these render sites.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useAddPayment, useInvoice } from '../api';
import { invoiceDocHtml, printInvoice } from '../lib/print';

export const invoiceDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/$id',
  component: InvoiceDetailPage,
});

// Legacy renderInvoices L21110 / _viewInvoice L21296 render rupees as
// Math.round + en-IN (whole rupees, no paise) on both list and detail. The
// shared inrFormat() is 2dp and is what the print doc uses — a different
// format for a different surface, matching legacy's own split.
const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;
// BUG (reported): toISOString() is UTC, so before 05:30 IST this defaults the
// payment date to YESTERDAY. Legacy today() (L1486-87) uses local components
// and is correct. Left as-is on purpose — the fix is the one shared IST helper
// (date-fns-tz), not a second local implementation here.
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
  const [payNotes, setPayNotes] = useState('');
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
        notes: payNotes || undefined,
      });
      setPayOpen(false);
      setPayAmt('');
      setPayRef('');
      setPayNotes('');
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : 'Failed to record payment');
    }
  }

  // Legacy _viewInvoice L21296-21300: five separate .panel cards, 16px for
  // SUBTOTAL/GST and 18px for TOTAL/PAID/BALANCE. `balance` is server-owned
  // (service.ts rowToInvoice L64) — never re-derived here.
  const stats: { label: string; value: string; size: number; color?: string }[] = [
    { label: 'SUBTOTAL', value: inr(inv.subtotal), size: 16 },
    { label: `GST ${inv.gstPercent}%`, value: inr(inv.gstAmount), size: 16, color: 'var(--amber)' },
    { label: 'TOTAL', value: inr(inv.grandTotal), size: 18, color: 'var(--green)' },
    { label: 'PAID', value: inr(inv.totalPaid), size: 18, color: 'var(--cyan)' },
    {
      label: 'BALANCE',
      value: inr(inv.balance),
      size: 18,
      color: inv.balance > 0 ? 'var(--red)' : 'var(--green)',
    },
  ];

  return (
    <div>
      <Link to="/invoices" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Invoices
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📄 Invoice — {inv.code}{' '}
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {stats.map((s) => (
          <div key={s.label} className="panel" style={{ padding: 10, minWidth: 100, textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 9 }}>{s.label}</div>
            <div className="mono fw-700" style={{ fontSize: s.size, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
        SO: <b>{inv.soCode ?? ''}</b> | Client: <b>{inv.clientName ?? ''}</b> | Due: <b>{inv.dueDate ?? '—'}</b>
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
                  min="0"
                  step="0.01"
                  value={payAmt}
                  placeholder={String(Math.round(inv.balance))}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">Payment Mode</label>
                <select className="innovic-input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  {['NEFT', 'RTGS', 'Cheque', 'Cash', 'UPI', 'Other'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-grp">
                <label className="form-label">Reference No.</label>
                <input
                  className="innovic-input"
                  placeholder="UTR / Cheque No."
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                />
              </div>
              <div className="form-grp form-full">
                <label className="form-label">Notes</label>
                <input
                  className="innovic-input"
                  placeholder="Payment remarks..."
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                />
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
            <span className="panel-title">💳 PAYMENTS ({inv.payments.length})</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Ref No.</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 11 }}>{p.paymentDate}</td>
                    <td className="mono fw-700" style={{ color: 'var(--green)' }}>{inr(p.amount)}</td>
                    <td style={{ fontSize: 11 }}>{p.mode}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{p.refNo ?? ''}</td>
                    <td style={{ fontSize: 11 }} className="text3">{p.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <RelatedDocsPanel module="invoices" id={inv.id} />
    </div>
  );
}
