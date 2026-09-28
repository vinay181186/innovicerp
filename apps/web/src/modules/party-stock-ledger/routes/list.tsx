// Party Stock Ledger (R3, ADR-194) — a read-only register of every movement of
// customer-owned material in the separate, zero-value party store. One row per
// movement (receive / issue / consume / return / reversal, each in or out); no
// value column — party material carries no rupee value on our books.
//
// Styled to the SO Master list conventions: ListHeader (title · count · search)
// over a `.innovic-table`. The ledger loads whole (it scrolls, it does not
// paginate — the endpoint caps at 500), so the universal search runs client-side
// across the visible columns via the shared search-match helper.

import type { PartyStockMovement } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { usePartyStockLedgerList } from '../api';

// The register scrolls; no Prev/Next. 500 is the endpoint's ceiling.
const LIST_LIMIT = 500;

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
  party_material_issue: 'Material Issue',
  party_material: 'Party Material',
  job_card: 'Job Card',
  jw_return_challan: 'JW Return',
};

export const partyStockLedgerListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-stock-ledger',
  component: PartyStockLedgerListPage,
});

function PartyStockLedgerListPage(): React.JSX.Element {
  // Same department gate as the other party pages (Store, party_create view).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = usePartyStockLedgerList({
    limit: LIST_LIMIT,
    offset: 0,
  });

  const rows = useMemo(() => {
    const all = data?.items ?? [];
    if (!search.trim()) return all;
    return all.filter((r) =>
      matchesSearchTerm(
        [
          r.partyMaterialCode,
          r.partyMaterialName,
          MOVEMENT_LABELS[r.movement],
          r.direction === 'in' ? 'in' : 'out',
          r.qty,
          r.balanceAfter,
          SOURCE_DOC_LABELS[r.sourceDocType] ?? r.sourceDocType,
          r.createdByName,
          fmtDate(r.createdAt),
        ],
        search,
      ),
    );
  }, [data?.items, search]);

  // Hide-page: once access loads, a user whose VIEW was removed sees the panel.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view the Party Stock Ledger. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="Party Stock Ledger"
        icon="📒"
        count={data?.total ?? rows.length}
        noun="movement"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search material, movement, source doc, by…"
      />

      <div className="panel">
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
                : 'Could not load the party stock ledger. Try again.'}
            </div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Movement</th>
                  <th>In / Out</th>
                  <th className="th-num">Qty</th>
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    Balance
                  </th>
                  <th>Source Doc</th>
                  <th>By</th>
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
      </div>

      <ListFooter total={data?.total ?? rows.length} noun="movement" limit={LIST_LIMIT} />
    </div>
  );
}
