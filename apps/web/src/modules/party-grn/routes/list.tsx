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
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePartyGrnList } from '../api';
import { CancelPartyGrnModal } from '../components/cancel-party-grn-modal';
import { NewPartyGrnModal } from '../components/new-party-grn-modal';
import { PARTY_GRN_HIDDEN_COLUMNS, partyGrnColumns } from '../components/party-grn-columns';
import { PartyGrnExpand } from '../components/party-grn-expand';
import { PartyGrnQcModal } from '../components/party-grn-qc-modal';
import { PartyMaterialIssueView } from '@/modules/party-material-issues/components/party-material-issue-view';

// Deep-link seed for Global Search (no detail page here): `?tab=issue&search=
// IN-PMI-26-0001` opens the Issue tab with its box pre-filled. Read ONCE into
// the local state below — tab clicks and typing stay local, never navigate.
// `?jw=<jwsoId>` (from the JWSO screens): opens the Receive tab's New Party
// GRN modal with that JWSO already picked. A malformed id is ignored.
// `?page=` is the Receive register's page (ADR-201: 25 rows a page, in the URL).
const searchSchema = z.object({
  tab: z.enum(['receive', 'issue']).optional(),
  search: z.string().optional(),
  jw: z.string().uuid().optional().catch(undefined),
  page: pageSearchParam,
});

export const partyGrnListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn',
  validateSearch: searchSchema,
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
  // ADR-203 (owner D4): Incoming QC on a party GRN is the Incoming QC
  // permission (qc_incoming · entry), the same gate the Incoming QC screens use.
  const canQc = effectiveFormPerms(eff, 'qc_incoming').entry;
  const routeSearch = partyGrnListRoute.useSearch();
  const navigate = partyGrnListRoute.useNavigate();
  // Seed this tab's box only when the landing targets it; a `?tab=issue`
  // landing must not pre-fill the Receive box with an issue code.
  const [search, setSearch] = useState(() =>
    (routeSearch.tab ?? 'receive') === 'receive' ? (routeSearch.search ?? '') : '',
  );
  const page = routeSearch.page;
  const setPage = useCallback(
    (p: number) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  // The box is debounced into the server search; a new term goes to page 1.
  const [term, setTerm] = useState(() => search.trim());
  useEffect(() => {
    const next = search.trim();
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term, setPage]);
  // A `?jw=` landing opens the New Party GRN modal straight away (Receive tab).
  const [showModal, setShowModal] = useState(
    () => Boolean(routeSearch.jw) && (routeSearch.tab ?? 'receive') === 'receive',
  );
  const [cancelRow, setCancelRow] = useState<PartyGrnListItem | null>(null);
  const [qcRow, setQcRow] = useState<PartyGrnListItem | null>(null);
  // Receive | Issue tabs — Issue is the former standalone Party Material Issue screen.
  const [tab, setTab] = useState<'receive' | 'issue'>(() => routeSearch.tab ?? 'receive');

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss GRNs. Every change goes back to
  // page 1.
  const sf = useServerSortFilter(TABLE_KEYS.partyGrn, () => setPage(1));

  const { data, isLoading, isError, error } = usePartyGrnList({
    search: term || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));
  const summary = data?.summary ?? { totalGrns: 0, totalReceived: 0, today: 0 };
  const rows = data?.items ?? [];
  const columns = useMemo(() => partyGrnColumns(), []);

  // ▸ expand — the per-line QC split loads lazily inside PartyGrnExpand.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Party GRNs. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202): on the list tab the page fills the content area and the
    // TABLE is the only scrollbox, so the column header cannot ride off the top at the
    // last row. The Issue tab is its own screen and keeps today's page scroll.
    <div className={tab === 'issue' ? undefined : 'page-fill'}>
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
            {t === 'receive' ? 'Receive (Party GRN)' : 'Issue'}
          </button>
        ))}
      </div>

      {tab === 'issue' ? (
        // key: a new ?search landing while already on this page remounts the
        // view so it re-seeds; nothing else changes the key.
        <PartyMaterialIssueView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · search ·
              + New Party GRN, with the read-only totals pinned inside the
              same band. */}
          <ListHeader
            title="Party GRN"
            icon="📥"
            count={data?.total}
            noun="GRN"
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search JWSO, customer, material…"
            primary={
              canCreate ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowModal(true)}
                >
                  <Plus size={14} /> New Party GRN
                </button>
              ) : null
            }
          >
            {/* Read-only count, not a filter — no onClick, so the cell renders
                as a <div>. The GRN count sits beside the title, so a separate
                "Total GRNs" tile is not repeated. */}
            <StatStrip
              items={[
                {
                  key: 'today',
                  label: 'Today',
                  count: summary.today,
                  color: 'var(--amber2)',
                  title: 'Party GRNs dated today',
                },
              ]}
            />
          </ListHeader>

          {isError ? (
            <PageState
              state="error"
              message={
                error instanceof Error ? error.message : 'Could not load party GRNs. Try again.'
              }
            />
          ) : (
            // THE shared FIT table (ADR-199). First column (GRN No.) is pinned.
            // There is no detail page for a party GRN, so a row is not clickable;
            // the ▸ reveals the per-line QC split, Received By / Remarks and the
            // receipt's History. Every row here is a live receipt (a cancelled
            // GRN is soft-deleted and filtered out by the API), so the only tint
            // is the defensive cancelled wash. Row ⋯: Incoming QC (ADR-203,
            // qc_incoming entry, only while a line waits) and Cancel (canCancel).
            <Panel fill bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.partyGrn}
                sortFilterServer={sf}
                defaultHidden={[...PARTY_GRN_HIDDEN_COLUMNS]}
                columns={columns}
                rows={rows}
                rowKey={(g) => g.id}
                loading={isLoading}
                emptyText={term || sf.filtering ? 'No Party GRNs match.' : 'No Party GRNs yet.'}
                rowClassName={(g) => (g.deletedAt ? ROW_TINT.cancelled : undefined)}
                renderExpanded={(g) => (expanded.has(g.id) ? <PartyGrnExpand g={g} /> : null)}
                onToggleExpanded={(g) => toggleExpand(g.id)}
                rowMenu={(g) => [
                  {
                    key: 'incoming-qc',
                    label: 'Incoming QC',
                    icon: 'check',
                    group: 'workflow',
                    hidden: !canQc || g.qcPendingLines <= 0,
                    onSelect: () => setQcRow(g),
                  },
                  {
                    key: 'cancel',
                    label: 'Cancel GRN',
                    icon: 'x',
                    group: 'danger',
                    hidden: !canCancel,
                    onSelect: () => setCancelRow(g),
                  },
                ]}
              />
            </Panel>
          )}

          {data ? (
            <ListFooter
              total={data.total}
              noun="GRN"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
            />
          ) : null}

          {showModal && canCreate ? (
            <NewPartyGrnModal initialJwId={routeSearch.jw} onClose={() => setShowModal(false)} />
          ) : null}
          {cancelRow ? (
            <CancelPartyGrnModal row={cancelRow} onClose={() => setCancelRow(null)} />
          ) : null}
          {qcRow && canQc ? <PartyGrnQcModal row={qcRow} onClose={() => setQcRow(null)} /> : null}
        </>
      )}
    </div>
  );
}
