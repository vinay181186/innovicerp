// Invoices list — mirror of legacy renderInvoices (L21096). Summary cards +
// invoice table with balance/overdue/status.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { JwInvoiceView } from '@/modules/jw-invoices/components/jw-invoice-view';
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
  const [tab, setTab] = useState<'so' | 'jw'>('so');
  const { data, isLoading, isError, error } = useInvoiceList();

  const tabBar = (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
      {(['so', 'jw'] as const).map((t) => (
        <button key={t} type="button" onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent', color: tab === t ? 'var(--cyan)' : 'var(--text3)', fontSize: 12, fontWeight: 700, padding: '6px 12px', cursor: 'pointer', marginBottom: -1 }}>{t === 'so' ? '🧾 SO Invoices' : '🔧 JW Invoices (Labour)'}</button>
      ))}
    </div>
  );

  if (tab === 'jw') {
    return (
      <div>
        {tabBar}
        <JwInvoiceView />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {tabBar}
        <div className="empty-state" style={{ padding: 40 }}>
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div>
        {tabBar}
        <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      </div>
    );
  }

  const s = data.summary;
  // Money hidden for L1 Viewers: the API nulls the summary + row amounts, so the
  // money tiles and the Amount/Paid/Balance columns are dropped (counts stay).
  const priceHidden = s.totalInvoiced == null;
  // Legacy L21139-21145: money tiles 18px, count tiles 20px, OVERDUE carries an
  // "N inv" sub-line (server-supplied count — never computed here).
  const cards: { label: string; value: string; color: string; size: number; sub?: string }[] = [
    ...(priceHidden
      ? []
      : [
          { label: 'TOTAL INVOICED', value: inr(s.totalInvoiced ?? 0), color: 'var(--green)', size: 18 },
          { label: 'TOTAL RECEIVED', value: inr(s.totalReceived ?? 0), color: 'var(--cyan)', size: 18 },
          { label: 'OUTSTANDING', value: inr(s.outstanding ?? 0), color: 'var(--amber)', size: 18 },
          {
            label: 'OVERDUE',
            value: inr(s.overdueAmount ?? 0),
            color: 'var(--red)',
            size: 18,
            sub: `${s.overdueCount} inv`,
          },
        ]),
    { label: 'UNPAID', value: String(s.unpaidCount), color: 'var(--red)', size: 20 },
    { label: 'PARTIAL', value: String(s.partialCount), color: 'var(--amber)', size: 20 },
    { label: 'PAID', value: String(s.paidCount), color: 'var(--green)', size: 20 },
  ];

  return (
    <div>
      {tabBar}
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
                {priceHidden ? null : (
                  <>
                    <th>Amount</th>
                    <th>Paid</th>
                    <th>Balance</th>
                  </>
                )}
                <th>Status</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 7 : 10} className="empty-state">No invoices yet. Click + New Invoice.</td>
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
                    {priceHidden ? null : (
                      <>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>{inr(inv.grandTotal ?? 0)}</td>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{inr(inv.totalPaid ?? 0)}</td>
                        <td className="td-ctr mono fw-700" style={{ color: (inv.balance ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {inr(inv.balance ?? 0)}
                        </td>
                      </>
                    )}
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
