// Party Stock Ledger (R3, ADR-194) — a read-only register of every movement of
// customer-owned material in the separate, zero-value party store. One row per
// movement (receive / issue / consume / return / reversal, each in or out); no
// value column — party material carries no rupee value on our books.
//
// The list standard: ListHeader (title · count · search) over Panel + DataTable
// over ListFooter. ADR-201: 25 movements a page with Prev / Next (page
// in the URL); the search box runs on the SERVER over every movement and the
// columns on screen, and a new search goes back to page 1.

import type { PartyStockLedgerListItem, PartyStockMovement } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
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
  // ADR-203: unused material put back from a Job Card into the register.
  party_material_issue_return: 'Returned to Store',
  // ADR-203: the new Customer Material Return document (good + rejected).
  customer_material_return: 'Customer Material Return',
  // The old per-material "Return" action (removed by ADR-203) — kept so its
  // historical rows still read sensibly.
  party_material_return: 'Returned to Customer (old)',
};

/** In = green, Out = orange, on the In / Out and Movement Qty columns. */
function directionColor(r: PartyStockLedgerListItem): string {
  return r.direction === 'in' ? 'var(--green2)' : 'var(--amber2)';
}

const COLUMNS: DataTableColumn<PartyStockLedgerListItem>[] = [
  {
    id: 'movement_date',
    header: 'Movement Date',
    kind: 'date',
    className: 'text2',
    nowrap: true,
    render: (r) => <span style={{ fontSize: 11 }}>{fmtDate(r.createdAt)}</span>,
  },
  {
    id: 'customer_material',
    header: 'Customer Material',
    kind: 'text',
    title: (r) => r.partyMaterialName ?? r.partyMaterialCode ?? '',
    render: (r) => (
      <>
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {r.partyMaterialCode ?? '—'}
        </span>
        {r.partyMaterialName ? (
          <span className="text3" style={{ fontSize: 11, marginLeft: 6 }}>
            {r.partyMaterialName}
          </span>
        ) : null}
      </>
    ),
  },
  {
    id: 'movement',
    header: 'Movement',
    kind: 'badge',
    nowrap: true,
    render: (r) => <span style={{ fontSize: 12 }}>{MOVEMENT_LABELS[r.movement]}</span>,
  },
  {
    id: 'direction',
    header: 'In / Out',
    kind: 'badge',
    nowrap: true,
    render: (r) => (
      <span style={{ fontSize: 11, fontWeight: 700, color: directionColor(r) }}>
        {r.direction === 'in' ? 'In' : 'Out'}
      </span>
    ),
  },
  {
    id: 'movement_qty',
    header: 'Movement Qty',
    kind: 'num',
    align: 'right',
    className: 'mono fw-700',
    render: (r) => (
      <span style={{ color: directionColor(r) }}>
        {r.direction === 'in' ? '+' : '−'}
        {r.qty}
      </span>
    ),
  },
  {
    id: 'balance',
    header: 'Balance',
    headColor: 'var(--green2)',
    kind: 'num',
    align: 'right',
    className: 'mono',
    render: (r) => r.balanceAfter,
  },
  {
    id: 'source_doc',
    header: 'Source Doc',
    kind: 'code',
    className: 'text2',
    nowrap: true,
    render: (r) => (
      <span style={{ fontSize: 11 }}>{SOURCE_DOC_LABELS[r.sourceDocType] ?? r.sourceDocType}</span>
    ),
  },
  {
    id: 'recorded_by',
    header: 'Recorded By',
    kind: 'text',
    className: 'text3',
    ellipsis: true,
    title: (r) => r.createdByName ?? '',
    render: (r) => <span style={{ fontSize: 11 }}>{r.createdByName ?? '—'}</span>,
  },
];

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
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is the
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

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error
              ? error.message
              : 'Could not load the Customer Material Stock Ledger. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          {/* The API pages and searches but has no column Sort & Filter, and a
              browser-side ▾ over one page of 25 would hide rows, so it stays off. */}
          <DataTable
            tableKey={TABLE_KEYS.partyStockLedger}
            columns={COLUMNS}
            rows={rows}
            loading={isLoading}
            rowKey={(r) => r.id}
            sortFilter={false}
            emptyText={term ? 'No movements match.' : 'No movements yet.'}
          />
        </Panel>
      )}

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
