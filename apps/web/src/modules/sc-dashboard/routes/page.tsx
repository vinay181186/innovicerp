// Supply Chain Dashboard — mirror of legacy renderSCDashboard L16790.
//
// Cards (PO counts + value totals + GRN today/total) + vendor summary +
// SO summary + complete PO summary (tax-included) + recent GRN + pending
// PO lines. Read-only.

import type { ScDashboardResponse } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';

export const scDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sc-dashboard',
  component: ScDashboardPage,
});

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function statusBadge(s: string): { cls: string; label: string } {
  if (s === 'closed') return { cls: 'b-green', label: 'closed' };
  if (s === 'partial') return { cls: 'b-amber', label: 'partial' };
  if (s === 'qc_pending') return { cls: 'b-amber', label: 'qc pending' };
  if (s === 'cancelled') return { cls: 'b-grey', label: 'cancelled' };
  return { cls: 'b-blue', label: 'open' };
}

function ScDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<ScDashboardResponse>({
    queryKey: ['sc-dashboard'],
    queryFn: () => apiFetch<ScDashboardResponse>('/sc-dashboard'),
    staleTime: 30_000,
  });

  // Pending PO Tracker filters (legacy renderSCDashboard L17030 — Vendor /
  // Item / SO-JW). Client-side over the already-fetched pendingLines. Hooks
  // run before the early returns; default to [] while data is loading.
  const [fltVendor, setFltVendor] = useState('');
  const [fltItem, setFltItem] = useState('');
  const [fltSo, setFltSo] = useState('');

  const pendingLines = data?.pendingLines ?? [];
  const isFiltered = Boolean(fltVendor || fltItem || fltSo);

  const filterOpts = useMemo(() => {
    const vendors = new Set<string>();
    const items = new Set<string>();
    const sos = new Set<string>();
    for (const p of pendingLines) {
      const v = p.vendorName ?? p.vendorCode;
      if (v) vendors.add(v);
      if (p.itemCode) items.add(p.itemCode);
      if (p.soCode) sos.add(p.soCode);
    }
    return {
      vendors: [...vendors].sort(),
      items: [...items].sort(),
      sos: [...sos].sort(),
    };
  }, [pendingLines]);

  const filteredPending = useMemo(() => {
    const has = (hay: string | null | undefined, needle: string): boolean =>
      needle.trim() === '' ? true : (hay ?? '').toLowerCase().includes(needle.trim().toLowerCase());
    return pendingLines.filter(
      (p) =>
        has(p.vendorName ?? p.vendorCode, fltVendor) &&
        has(p.itemCode, fltItem) &&
        has(p.soCode, fltSo),
    );
  }, [pendingLines, fltVendor, fltItem, fltSo]);

  const fltPendQty = filteredPending.reduce((s, p) => s + p.pendingQty, 0);
  const fltPendVal = filteredPending.reduce((s, p) => s + p.pendingVal, 0);

  function clearFilters(): void {
    setFltVendor('');
    setFltItem('');
    setFltSo('');
  }

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

  const grandOrderTotal = data.poSummary.reduce((s, g) => s + g.grandTotal, 0);

  return (
    <div>
      <div className="section-hdr">🔗 Supply Chain Dashboard</div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <Card label="OPEN POs" value={data.summary.openPos} color="var(--blue)" />
        <Card label="PARTIAL POs" value={data.summary.partialPos} color="var(--amber)" />
        <Card label="CLOSED POs" value={data.summary.closedPos} color="var(--green)" />
        <Card label="CANCELLED" value={data.summary.cancelledPos} color="var(--red)" />
        <Card
          label="ORDER VAL"
          value={`₹${inr(data.summary.totalOrderVal)}`}
          color="var(--cyan)"
        />
        <Card
          label="RECEIVED VAL"
          value={`₹${inr(data.summary.totalRecvVal)}`}
          color="var(--green)"
        />
        <Card
          label="PENDING VAL"
          value={`₹${inr(data.summary.pendingVal)}`}
          color="var(--amber)"
        />
        <Card label="GRN TOTAL" value={data.summary.grnCount} color="var(--cyan)" />
        <Card label="GRN TODAY" value={data.summary.todayGrn} color="var(--green)" />
      </div>

      {/* Vendor-wise summary */}
      <Section title="🏢 By Vendor (Open + Partial + QC-Pending)">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Code</th>
              <th className="td-ctr">Lines</th>
              <th className="td-ctr">Items</th>
              <th className="td-ctr">Total Qty</th>
              <th className="td-ctr" style={{ color: 'var(--green)' }}>Received</th>
              <th className="td-ctr" style={{ color: 'var(--red)' }}>Pending</th>
              <th className="td-ctr">Total ₹</th>
              <th className="td-ctr" style={{ color: 'var(--amber)' }}>Pending ₹</th>
            </tr>
          </thead>
          <tbody>
            {data.byVendor.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">No open POs</td>
              </tr>
            ) : (
              data.byVendor.map((v) => {
                const pendQty = v.totalQty - v.receivedQty;
                return (
                  <tr key={(v.vendorId ?? v.vendorCode ?? 'unknown')}>
                    <td className="fw-700">{v.vendorName ?? v.vendorCode ?? '—'}</td>
                    <td style={{ fontSize: 11 }}>{v.vendorCode ?? '—'}</td>
                    <td className="td-ctr mono">{v.lines}</td>
                    <td className="td-ctr" style={{ fontSize: 11 }}>{v.uniqueItems}</td>
                    <td className="td-ctr mono fw-700">{v.totalQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)', fontWeight: 700 }}>
                      {v.receivedQty}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                      {pendQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 11 }}>₹{inr(v.totalVal)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      ₹{inr(v.pendingVal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* SO-wise summary */}
      <Section title="📋 By Sales Order">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>SO</th>
              <th className="td-ctr">Lines</th>
              <th className="td-ctr">Vendors</th>
              <th className="td-ctr">Total Qty</th>
              <th className="td-ctr" style={{ color: 'var(--green)' }}>Received</th>
              <th className="td-ctr" style={{ color: 'var(--red)' }}>Pending</th>
              <th className="td-ctr">Total ₹</th>
              <th className="td-ctr" style={{ color: 'var(--amber)' }}>Pending ₹</th>
            </tr>
          </thead>
          <tbody>
            {data.bySo.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-state">No SO-linked POs</td>
              </tr>
            ) : (
              data.bySo.map((s) => {
                const pendQty = s.totalQty - s.receivedQty;
                return (
                  <tr key={s.soRefId ?? '_unlinked_'}>
                    <td>{s.soCode ?? <span className="text3">No SO linked</span>}</td>
                    <td className="td-ctr mono">{s.lines}</td>
                    <td className="td-ctr" style={{ fontSize: 11 }}>{s.uniqueVendors}</td>
                    <td className="td-ctr mono fw-700">{s.totalQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)', fontWeight: 700 }}>
                      {s.receivedQty}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                      {pendQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 11 }}>₹{inr(s.totalVal)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      ₹{inr(s.pendingVal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* Complete PO summary */}
      <Section title={`🛒 Complete Purchase Summary (${data.poSummary.length}) — Grand total ₹${inr(grandOrderTotal)}`}>
        <table className="innovic-table">
          <thead>
            <tr>
              <th>PO No.</th>
              <th>Date</th>
              <th>Vendor</th>
              <th>SO</th>
              <th className="td-ctr">Lines</th>
              <th className="td-ctr">Total Qty</th>
              <th className="td-ctr" style={{ color: 'var(--green)' }}>Received</th>
              <th className="td-ctr" style={{ color: 'var(--red)' }}>Pending</th>
              <th className="td-ctr">Value ₹</th>
              <th className="td-ctr" style={{ color: 'var(--amber)' }}>Tax ₹</th>
              <th className="td-ctr" style={{ color: 'var(--green)' }}>Grand ₹</th>
              <th className="td-ctr">GRN</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.poSummary.length === 0 ? (
              <tr>
                <td colSpan={13} className="empty-state">No active POs</td>
              </tr>
            ) : (
              data.poSummary.map((g) => {
                const pendQty = g.totalQty - g.receivedQty;
                const sb = statusBadge(g.status);
                return (
                  <tr key={g.poId}>
                    <td>
                      <Link
                        to="/purchase-orders/$id"
                        params={{ id: g.poId }}
                        className="td-code"
                        style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                      >
                        {g.poNo}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11 }}>{g.poDate}</td>
                    <td className="fw-700">{g.vendorName ?? g.vendorCode ?? '—'}</td>
                    <td className="text2" style={{ fontSize: 11 }}>{g.soCode ?? '—'}</td>
                    <td className="td-ctr mono">{g.lines}</td>
                    <td className="td-ctr mono fw-700">{g.totalQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)', fontWeight: 700 }}>
                      {g.receivedQty}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{ color: pendQty > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}
                    >
                      {pendQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 11 }}>₹{inr(g.totalVal)}</td>
                    <td className="td-ctr mono" style={{ fontSize: 11, color: 'var(--amber)' }}>
                      ₹{inr(g.taxAmount)}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                      ₹{inr(g.grandTotal)}
                    </td>
                    <td className="td-ctr">{g.grnCount}</td>
                    <td>
                      <span className={`badge ${sb.cls}`}>{sb.label}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* Pending PO Tracker (with Vendor / Item / SO filters) */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">🔍 Pending PO Tracker</span>
          {isFiltered ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--red)', fontSize: 11 }}
              onClick={clearFilters}
            >
              <X size={12} /> Clear filters
            </button>
          ) : null}
        </div>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <FilterInput
            label="Vendor"
            listId="dlScVnd"
            value={fltVendor}
            onChange={setFltVendor}
            options={filterOpts.vendors}
            width={150}
          />
          <FilterInput
            label="Item"
            listId="dlScItm"
            value={fltItem}
            onChange={setFltItem}
            options={filterOpts.items}
            width={160}
          />
          <FilterInput
            label="SO/JW"
            listId="dlScSO"
            value={fltSo}
            onChange={setFltSo}
            options={filterOpts.sos}
            width={120}
          />
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
            {isFiltered ? <span style={{ color: 'var(--amber)' }}>Filtered: </span> : null}
            {filteredPending.length} line{filteredPending.length !== 1 ? 's' : ''} · Pend Qty:{' '}
            <span style={{ color: 'var(--red)' }}>{fltPendQty}</span> · Pend Value:{' '}
            <span style={{ color: 'var(--amber)' }}>₹{inr(fltPendVal)}</span>
          </div>
        </div>
        <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>PO No.</th>
              <th className="td-ctr">Line</th>
              <th>Date</th>
              <th>Vendor</th>
              <th>SO</th>
              <th>Item</th>
              <th>Item Name</th>
              <th className="td-ctr">Qty</th>
              <th className="td-ctr" style={{ color: 'var(--green)' }}>Received</th>
              <th className="td-ctr" style={{ color: 'var(--red)' }}>Pending</th>
              <th className="td-ctr">Rate</th>
              <th className="td-ctr" style={{ color: 'var(--amber)' }}>Pending ₹</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredPending.length === 0 ? (
              <tr>
                <td colSpan={13} className="empty-state">
                  {isFiltered ? 'No pending lines match the filters' : 'No pending lines'}
                </td>
              </tr>
            ) : (
              filteredPending.map((p) => {
                const sb = statusBadge(p.status);
                return (
                  <tr key={`${p.poId}:${p.lineNo}`}>
                    <td>
                      <Link
                        to="/purchase-orders/$id"
                        params={{ id: p.poId }}
                        className="td-code"
                        style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                      >
                        {p.poNo}
                      </Link>
                    </td>
                    <td className="td-ctr mono">{p.lineNo}</td>
                    <td style={{ fontSize: 11 }}>{p.poDate}</td>
                    <td className="fw-700" style={{ fontSize: 12 }}>
                      {p.vendorName ?? p.vendorCode ?? '—'}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>{p.soCode ?? '—'}</td>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>{p.itemCode ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.itemName ?? '—'}</td>
                    <td className="td-ctr mono fw-700">{p.qty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)', fontWeight: 700 }}>
                      {p.receivedQty}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                      {p.pendingQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 11 }}>₹{p.rate.toFixed(2)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      ₹{inr(p.pendingVal)}
                    </td>
                    <td>
                      <span className={`badge ${sb.cls}`}>{sb.label}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Recent GRN */}
      <Section title="📦 Recent GRN (last 8)">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>GRN No.</th>
              <th>Date</th>
              <th>PO</th>
              <th>Vendor</th>
            </tr>
          </thead>
          <tbody>
            {data.recentGrn.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">No recent GRN</td>
              </tr>
            ) : (
              data.recentGrn.map((g) => (
                <tr key={g.grnNo}>
                  <td className="td-code" style={{ color: 'var(--cyan)' }}>{g.grnNo}</td>
                  <td style={{ fontSize: 11 }}>{g.grnDate}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>
                    {g.poNo ?? 'Manual'}
                  </td>
                  <td style={{ fontSize: 11 }}>{g.vendorName ?? g.vendorCode ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string | number; color: string }): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 9 }}>{label}</div>
      <div className="mono fw-700" style={{ fontSize: 20, color }}>
        {value}
      </div>
    </div>
  );
}

function FilterInput({
  label,
  listId,
  value,
  onChange,
  options,
  width,
}: {
  label: string;
  listId: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  width: number;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <label
        style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {label}:
      </label>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <input
        list={listId}
        className="innovic-input"
        value={value}
        placeholder="🔍 All"
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 12, padding: '4px 8px', width }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">{title}</span>
      </div>
      <div className="tbl-wrap">{children}</div>
    </div>
  );
}
