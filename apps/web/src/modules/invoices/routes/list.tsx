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

// Mirror of legacy fmt() (L1484): '' → '—', else dd Mon yy (en-IN).
const fmt = (d: string | null | undefined): string => {
  if (!d) return '—';
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return d;
  }
};

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
  // Legacy L21139-21145: money tiles 18px, count tiles 20px, OVERDUE carries an
  // "N inv" sub-line (server-supplied count — never computed here).
  const cards: { label: string; value: string; color: string; size: number; sub?: string }[] = [
    { label: 'TOTAL INVOICED', value: inr(s.totalInvoiced), color: 'var(--green)', size: 18 },
    { label: 'TOTAL RECEIVED', value: inr(s.totalReceived), color: 'var(--cyan)', size: 18 },
    { label: 'OUTSTANDING', value: inr(s.outstanding), color: 'var(--amber)', size: 18 },
    {
      label: 'OVERDUE',
      value: inr(s.overdueAmount),
      color: 'var(--red)',
      size: 18,
      sub: `${s.overdueCount} inv`,
    },
    { label: 'UNPAID', value: String(s.unpaidCount), color: 'var(--red)', size: 20 },
    { label: 'PARTIAL', value: String(s.partialCount), color: 'var(--amber)', size: 20 },
    { label: 'PAID', value: String(s.paidCount), color: 'var(--green)', size: 20 },
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
            <div className="mono fw-700" style={{ fontSize: c.size, color: c.color }}>{c.value}</div>
            {c.sub ? <div style={{ fontSize: 9, color: 'var(--red)' }}>{c.sub}</div> : null}
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
                <th>Amount</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">No invoices yet. Click + New Invoice.</td>
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
                    <td style={{ fontSize: 11 }}>{fmt(inv.invoiceDate)}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{inv.soCode ?? ''}</td>
                    <td className="fw-700">{inv.clientName ?? ''}</td>
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
                    <td style={{ fontSize: 11, color: inv.overdue ? 'var(--red)' : 'var(--text3)' }}>{fmt(inv.dueDate)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <Link
                          to="/invoices/$id"
                          params={{ id: inv.id }}
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10 }}
                        >
                          👁
                        </Link>
                        {inv.status !== 'paid' ? (
                          <Link
                            to="/invoices/$id"
                            params={{ id: inv.id }}
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10, color: 'var(--green)' }}
                          >
                            💳 Pay
                          </Link>
                        ) : null}
                      </div>
                    </td>
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
