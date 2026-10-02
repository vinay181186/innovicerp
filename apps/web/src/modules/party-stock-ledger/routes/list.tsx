// Party Stock Ledger (R3, ADR-194) — a read-only register of every movement of
// customer-owned material in the separate, zero-value party store. One row per
// movement (receive / issue / consume / return / reversal, each in or out); no
// value column — party material carries no rupee value on our books.
//
// Styled to the SO Master list conventions: ListHeader (title · count · search)
// over a `.innovic-table`. ADR-201: 25 movements a page with Prev / Next (page
// in the URL); the search box runs on the SERVER over every movement and the
// columns on screen, and a new search goes back to page 1.

import type { PartyStockMovement } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { ListFooter, ListHeader } from '@/ui/layout';
import { usePartyStockLedgerList } from '../api';

const MOVEMENT_LABELS: Record<PartyStockMovement, string> = {
  receive: 'Receive',
  issue: 'Issue',
  consume: 'Consume',
  return: 'Return',
  reversal: 'Reversal',
};

// Human labels for the source document type stored on each ledger row.
const SOURCE_DOC_LABELS: Record<string, string> = {
  party_grn: 'Party GRN',
  party_grn_line: 'Party GRN',
  party_material_issue: 'Customer Material Issue',
  party_material: 'Customer Material',
  job_card: 'Job Card',
  jw_return_challan: 'JW Return',
};

export const partyStockLedgerListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-stock-ledger',
  validateSearch: z.object({ page: pageSearchParam }),
  component: PartyStockLedgerListPage,
});

function PartyStockLedgerListPage(): React.JSX.Element {
  // Same department gate as the other party pages (Store, party_create view).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const { page } = partyStockLedgerListRoute.useSearch();
  const navigate = partyStockLedgerListRoute.useNavigate();
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const next = normalizeSearchTerm(search);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term, gotoPage]);

  const { data, isLoading, isFetching, isError, error } = usePartyStockLedgerList({
    ...(term ? { search: term } : {}),
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  // Hide-page: once access loads, a user whose VIEW was removed sees the panel.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view the Customer Material Stock Ledger. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is the
    // only scrollbox, so the column header cannot ride off the top at the last row.
    <div className="page-fill">
      <ListHeader
        title="Customer Material Stock Ledger"
        icon="📒"
        count={total}
        noun="movement"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search material, movement, source doc, by…"
        updating={isFetching && !isLoading}
      />

      <Panel fill bodyPadding="none">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error
                ? error.message
                : 'Could not load the Customer Material Stock Ledger. Try again.'}
            </div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Movement Date</th>
                  <th>Customer Material</th>
                  <th>Movement</th>
                  <th>In / Out</th>
                  <th className="th-num">Movement Qty</th>
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    Balance
                  </th>
                  <th>Source Doc</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {search.trim() ? 'No movements match.' : 'No party stock movements yet.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtDate(r.createdAt)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {r.partyMaterialCode ?? '—'}
                        </span>
                        {r.partyMaterialName ? (
                          <span
                            className="text3"
                            style={{
                              fontSize: 11,
                              marginLeft: 6,
                            }}
                          >
                            {r.partyMaterialName}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 12 }}>{MOVEMENT_LABELS[r.movement]}</td>
                      <td>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: r.direction === 'in' ? 'var(--green2)' : 'var(--amber2)',
                          }}
                        >
                          {r.direction === 'in' ? 'In' : 'Out'}
                        </span>
                      </td>
                      <td
                        className="mono fw-700 td-num"
                        style={{ color: r.direction === 'in' ? 'var(--green2)' : 'var(--amber2)' }}
                      >
                        {r.direction === 'in' ? '+' : '−'}
                        {r.qty}
                      </td>
                      <td className="mono td-num">{r.balanceAfter}</td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {SOURCE_DOC_LABELS[r.sourceDocType] ?? r.sourceDocType}
                      </td>
                      <td className="text3" style={{ fontSize: 11 }}>
                        {r.createdByName ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ListFooter
        total={total}
        noun="movement"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
