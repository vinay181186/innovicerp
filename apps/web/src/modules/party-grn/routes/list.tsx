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
import { StatStrip } from '@/components/shared/stat-strip';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePartyGrnList } from '../api';
import { CancelPartyGrnModal } from '../components/cancel-party-grn-modal';
import { NewPartyGrnModal } from '../components/new-party-grn-modal';
import { PartyGrnCard } from '../components/party-grn-card';

const PAGE_SIZE = 50;

export const partyGrnListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn',
  component: PartyGrnListPage,
});

function PartyGrnListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<PartyGrnListItem | null>(null);

  const { data, isLoading, isError, error } = usePartyGrnList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const summary = data?.summary ?? { totalGrns: 0, totalReceived: 0, today: 0 };
  const rows = data?.items ?? [];

  return (
    <div>
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
              📥 Party Material GRN
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {data?.total ?? 0} GRN{(data?.total ?? 0) === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="innovic-input"
              placeholder="🔍 Search JWSO, client, material…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              style={{ width: 260, fontSize: 12 }}
            />
            {canWrite ? (
              <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
                <Plus size={14} /> New Party GRN
              </button>
            ) : null}
          </div>
        </div>

        {/* Read-only totals across the whole company, not filters — no onClick,
            so each cell renders as a <div> instead of a button that does
            nothing. They do NOT follow the search box; see the note below. */}
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
              key: 'received',
              label: 'Total Received',
              count: summary.totalReceived,
              color: 'var(--green)',
              title: 'Total quantity of client material received',
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

      {/* One-time explainer — deliberately OUTSIDE the band so it scrolls away
          instead of eating pinned height. Amber wash from the token rgba
          the old version hard-coded four raw light-mode amber hexes, which
          ignored the theme entirely). */}
      <div
        style={{
          background: 'rgba(245,158,11,0.10)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 22 }}>📥</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: 13, marginBottom: 2 }}>
            Record Party Material GRNs here
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            This is the home for client-supplied (party) material. When a client sends raw material
            against a Job Work order, record its receipt right here — just click{' '}
            <b>+ New Party GRN</b>. Every party-material receipt is entered and tracked on this
            screen.
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load party GRNs'}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          No party material GRNs — click + New Party GRN
        </div>
      ) : (
        rows.map((g) => (
          <PartyGrnCard
            key={g.id}
            g={g}
            canWrite={canWrite}
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

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 The three counts above cover <b>every</b> GRN in the company — they do not follow the
        search box, which filters only the cards below.
      </div>

      {showModal ? <NewPartyGrnModal onClose={() => setShowModal(false)} /> : null}
      {cancelRow ? (
        <CancelPartyGrnModal row={cancelRow} onClose={() => setCancelRow(null)} />
      ) : null}
    </div>
  );
}
