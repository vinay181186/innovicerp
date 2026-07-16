// Production JW List — mirrors legacy renderProdJWList (HTML L22995).

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useProdJwList } from '../api';

export const prodJwListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'prod-jw-list',
  component: ProdJwListPage,
});

function ProdJwListPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useProdJwList({
    search: search.trim() || undefined,
    limit: 200,
    offset: 0,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📦 JWSO List (Production View)</div>
        <input
          type="text"
          className="innovic-input"
          placeholder="🔍 Search JWSO, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
      </div>
      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JWSO No</th>
                  <th>Customer</th>
                  <th className="td-ctr">Lines</th>
                  <th className="td-ctr">Total Qty</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Done
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>
                    Balance
                  </th>
                  <th>Progress</th>
                  <th>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No JWSO orders found
                    </td>
                  </tr>
                ) : null}
                {data.items.map((r) => (
                  <tr key={r.jwId}>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.jwCode}
                    </td>
                    <td>{r.customerName}</td>
                    <td className="td-ctr">{r.linesCount}</td>
                    <td className="td-ctr mono fw-700">{r.totalQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {r.doneQty}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ color: r.balanceQty > 0 ? 'var(--red)' : 'var(--green)' }}
                    >
                      {r.balanceQty}
                    </td>
                    <td>
                      <div
                        style={{
                          width: 80,
                          height: 6,
                          background: 'var(--bg5)',
                          borderRadius: 3,
                          display: 'inline-block',
                          verticalAlign: 'middle',
                        }}
                      >
                        <div
                          style={{
                            width: `${r.progressPct}%`,
                            height: '100%',
                            background: r.progressPct >= 100 ? 'var(--green)' : 'var(--cyan)',
                            borderRadius: 3,
                          }}
                        />
                      </div>{' '}
                      <span className="mono" style={{ fontSize: 10 }}>
                        {r.progressPct}%
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>{r.dueDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
