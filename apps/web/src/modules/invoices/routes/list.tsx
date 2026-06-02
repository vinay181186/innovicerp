// Invoices list — mirror of legacy renderInvoices (L21096). Summary cards +
// invoice table with balance/overdue/status.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useInvoiceList } from '../api';

export const invoiceListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices',
  component: InvoiceListPage,
});

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

function InvoiceListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useInvoiceList();

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  const s = data.summary;
  const cards: { label: string; value: string; color: string }[] = [
    { label: 'TOTAL INVOICED', value: inr(s.totalInvoiced), color: 'var(--green)' },
    { label: 'TOTAL RECEIVED', value: inr(s.totalReceived), color: 'var(--cyan)' },
    { label: 'OUTSTANDING', value: inr(s.outstanding), color: 'var(--amber)' },
    { label: 'OVERDUE', value: inr(s.overdueAmount), color: 'var(--red)' },
    { label: 'UNPAID', value: String(s.unpaidCount), color: 'var(--red)' },
    { label: 'PARTIAL', value: String(s.partialCount), color: 'var(--amber)' },
    { label: 'PAID', value: String(s.paidCount), color: 'var(--green)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📄 Invoices
        </div>
        <Link to="/invoices/new" className="btn btn-primary">
          + New Invoice
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {cards.map((c) => (
          <div key={c.label} className="panel" style={{ padding: 10, textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 9 }}>{c.label}</div>
            <div className="mono fw-700" style={{ fontSize: 18, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Date</th>
                <th>SO</th>
                <th>Client</th>
                <th className="td-ctr">Amount</th>
                <th className="td-ctr">Paid</th>
                <th className="td-ctr">Balance</th>
                <th>Status</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">No invoices yet. Click + New Invoice.</td>
                </tr>
              ) : (
                data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="td-code"
                        style={{ color: 'var(--cyan)', fontWeight: 800, textDecoration: 'none' }}
                      >
                        {inv.code}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11 }}>{inv.invoiceDate}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{inv.soCode ?? '—'}</td>
                    <td className="fw-700">{inv.clientName ?? '—'}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>{inr(inv.grandTotal)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{inr(inv.totalPaid)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: inv.balance > 0 ? 'var(--red)' : 'var(--green)' }}>
                      {inr(inv.balance)}
                    </td>
                    <td>
                      <span className={`badge ${inv.status === 'paid' ? 'b-green' : inv.status === 'partial' ? 'b-amber' : 'b-red'}`}>
                        {inv.status}
                      </span>
                      {inv.overdue ? (
                        <span style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, marginLeft: 4 }}>⚠ OVERDUE</span>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 11, color: inv.overdue ? 'var(--red)' : 'var(--text3)' }}>{inv.dueDate ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
