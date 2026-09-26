// Party Material GRN (Store slice 2) — client-supplied raw material received
// against a JW order. Multi-line per receipt.
// Mirrors legacy renderPartyGRN (HTML L24251) + addPartyGRN (L24298).
//
// Styled to SO Master (sales-orders/routes/list.tsx) 2026-08-13:
//  - The three `.stat-card` boxes are one `<StatStrip>` row (styling skill
//    Rule 3, ADR-120). Read-only totals, so no onClick — the strip renders them
//    as plain cells rather than buttons that do nothing.
//  - Title + count + search + New Party GRN + the strip sit in the frozen
//    header band; previously the banner, title, search and tiles all scrolled
//    away, leaving no way to search without scrolling back up.
//  - The 11-column table is one `.panel` card per GRN. Four of its columns
//    (Client, Received By, Client PO, DC No.) were unbounded server text under
//    `.innovic-table td`'s `white-space: nowrap` with no max-width — only
//    Remarks was defended — so a long client name scrolled the page sideways
//    and took the GRN No. with it (no `tbl-frozen`). `.tbl-wrap` also nested a
//    second vertical scrollbar inside `#content`'s own.
//  - Modals and the line editor moved to components/ so every file clears the
//    400-line rule; this one was 969 lines.
//
// Nothing about the data, the queries, the validation or the mutations changed.

import type { PartyGrnListItem } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePartyGrnList } from '../api';
import { CancelPartyGrnModal } from '../components/cancel-party-grn-modal';
import { NewPartyGrnModal } from '../components/new-party-grn-modal';
import { PartyGrnCard } from '../components/party-grn-card';
import { PartyMaterialIssueView } from '@/modules/party-material-issues/components/party-material-issue-view';

const PAGE_SIZE = 50;

// Deep-link seed for Global Search (no detail page here): `?tab=issue&search=
// IN-PMI-26-0001` opens the Issue tab with its box pre-filled. Read ONCE into
// the local state below — tab clicks and typing stay local, never navigate.
const searchSchema = z.object({
  tab: z.enum(['receive', 'issue']).optional(),
  search: z.string().optional(),
});

export const partyGrnListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn',
  validateSearch: (search) => searchSchema.parse(search),
  component: PartyGrnListPage,
});

function PartyGrnListPage(): React.JSX.Element {
  // Tier-driven, per department (party_create sits in Store). Replaces the old
  // admin/manager flag, which collapsed all seven tiers into two.
  //   New Party GRN -> entry (L2 Data Entry and up)
  //   Cancel        -> edit AND approve. Cancel is not one of the four tier
  //     actions, and it reverses a received quantity off party stock, so it is
  //     expressed as the pair only L5 Department Admin and above hold: L3 has
  //     edit without approve, L4 has approve without edit.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canCreate = perms.entry;
  const canCancel = perms.edit && perms.approve;
  const routeSearch = partyGrnListRoute.useSearch();
  // Seed this tab's box only when the landing targets it; a `?tab=issue`
  // landing must not pre-fill the Receive box with an issue code.
  const [search, setSearch] = useState(() =>
    (routeSearch.tab ?? 'receive') === 'receive' ? (routeSearch.search ?? '') : '',
  );
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<PartyGrnListItem | null>(null);
  // Receive | Issue tabs — Issue is the former standalone Party Material Issue screen.
  const [tab, setTab] = useState<'receive' | 'issue'>(() => routeSearch.tab ?? 'receive');

  const { data, isLoading, isError, error } = usePartyGrnList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const summary = data?.summary ?? { totalGrns: 0, totalReceived: 0, today: 0 };
  const rows = data?.items ?? [];

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Receive (GRN) | Issue tabs (Issue is the former standalone Party Material
          Issue screen). */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        {(['receive', 'issue'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'receive' ? '📥 Receive (Party GRN)' : '📤 Issue'}
          </button>
        ))}
      </div>

      {tab === 'issue' ? (
        // key: a new ?search landing while already on this page remounts the
        // view so it re-seeds; nothing else changes the key.
        <PartyMaterialIssueView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
      ) : (
        <>
          {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          `#content` is the scroll container, so top:0 pins this to its padding
          box; the background must be opaque var(--bg) or cards show through as
          they pass under. Not bled to the edges — that would give the app a
          horizontal scrollbar. */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              background: 'var(--bg)',
              paddingBottom: 8,
              marginBottom: 10,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 10,
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="section-hdr" style={{ marginBottom: 0 }}>
                  📥 Party GRN
                </div>
                <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
                  {data?.total ?? 0} GRN{(data?.total ?? 0) === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="innovic-input"
                  placeholder="🔍 Search JWSO, customer, material…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  style={{ width: 260, fontSize: 12 }}
                />
                {canCreate ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowModal(true)}
                  >
                    <Plus size={14} /> New Party GRN
                  </button>
                ) : null}
              </div>
            </div>

            {/* Read-only totals across the whole company, not filters — no onClick,
            so each cell renders as a <div> instead of a button that does
            nothing. They do NOT follow the search box. */}
            <StatStrip
              items={[
                {
                  key: 'grns',
                  label: 'Total GRNs',
                  count: summary.totalGrns,
                  color: 'var(--cyan)',
                  title: 'Every party GRN on record',
                },
                {
                  key: 'today',
                  label: 'Today',
                  count: summary.today,
                  color: 'var(--amber)',
                  title: 'GRNs recorded today',
                },
              ]}
            />
          </div>

          {isLoading ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : isError ? (
            <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Could not load party GRNs. Try again.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              No party material GRNs — click + New Party GRN
            </div>
          ) : (
            rows.map((g) => (
              // The card's `canWrite` prop gates its Cancel button and nothing else.
              <PartyGrnCard
                key={g.id}
                g={g}
                canWrite={canCancel}
                onCancel={() => setCancelRow(g)}
              />
            ))
          )}

          {data ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                fontSize: 12,
                color: 'var(--text3)',
              }}
            >
              <span>
                {data.total === 0
                  ? 'No GRNs'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} of ${data.total}`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : null}

          {showModal ? <NewPartyGrnModal onClose={() => setShowModal(false)} /> : null}
          {cancelRow ? (
            <CancelPartyGrnModal row={cancelRow} onClose={() => setCancelRow(null)} />
          ) : null}
        </>
      )}
    </div>
  );
}
