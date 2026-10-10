// Customer Dispatch Register — mirror of legacy `renderDispatchRegister`
// (L10711): item-wise summary panel + dispatch log + search + Print. Per user
// direction 2026-06-06 the log is ONE ROW PER DISPATCH, click to expand its
// item lines; SO filter + Export Excel (all dispatches flattened to line rows).
//
// 2026-10-01 (ADR-199): the per-dispatch cards are replaced by the ONE shared
// FIT table (<DataTable tableKey=…>). One line per dispatch, the fit engine
// sizing columns to the screen and dropping the rightmost unpinned ones into a
// ▸ detail row (the item lines + Remarks). The item-wise summary strip and the
// StatStrip counts stay.
//
// 2026-10-02 (ADR-201): 25 DISPATCHES a page, loaded from the server. Search,
// the SO filter and Sort & Filter run there over every row; the KPI strip, the
// item-wise summary and the SO options come from the server too. Lines are
// still grouped by dispatch here, inside the page. Excel + Print fetch every
// filtered row (fetchAllPages).

import type { CustomerDispatchRegisterQuery, CustomerDispatchRegisterRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import {
  LIST_PAGE_SIZE,
  fetchAllPages,
  pageOffset,
  pageSearchParam,
  useClampPage,
} from '@/lib/list-paging';
import { usePendingEditIds } from '@/modules/document-edits/api';
import { JwDispatchView } from '@/modules/jw-returns/components/jw-dispatch-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ActionMenu, ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useMyCompany } from '@/modules/settings/api';
import { fetchDispatchRegister, useDispatchRegister } from '../api';
import { CancelDispatchModal } from '../components/cancel-dispatch-modal';
import { type DispatchGroup, groupByDispatch } from '../components/dispatch-group';
import { DispatchExpanded } from '../components/dispatch-expanded';
import { DispatchItemSummary } from '../components/dispatch-item-summary';
import { dispatchListColumns } from '../components/dispatch-list-columns';
import { DispatchRowActions } from '../components/dispatch-row-actions';
import { exportDispatchRegister } from '../lib/export-excel';
import { printCustomerDispatchRegister } from '../lib/print-register';

// Deep-link seed for Global Search (this register has no detail page):
// `?tab=so&search=DSP-0004` opens the right tab with the box pre-filled. The
// params are read ONCE into the local state below — typing and tab clicks stay
// local and never navigate. `page` is the Dispatch Log page (ADR-201).
const searchSchema = z.object({
  tab: z.enum(['so', 'jw']).optional(),
  search: z.string().optional(),
  page: pageSearchParam,
});

export const customerDispatchListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches',
  validateSearch: searchSchema,
  component: CustomerDispatchListPage,
});

/** Every register line matching the filters — Excel / Print (ADR-201). */
async function fetchAllRegisterRows(
  q: Omit<CustomerDispatchRegisterQuery, 'limit' | 'offset'>,
): Promise<CustomerDispatchRegisterRow[]> {
  const groups = await fetchAllPages(async (limit, offset) => {
    const res = await fetchDispatchRegister({ ...q, limit, offset });
    return { items: groupByDispatch(res.rows), total: res.total };
  });
  return groups.flatMap((g) => g.lines);
}

function CustomerDispatchListPage(): React.JSX.Element {
  // JW Dispatch (jw-returns) folded in here as a tab — same job, two document
  // families: this one ships finished goods against an SO, that one returns
  // machined goods against a JWSO line. Its own hooks/mutations are unchanged.
  const routeSearch = customerDispatchListRoute.useSearch();
  const navigate = customerDispatchListRoute.useNavigate();
  const [tab, setTab] = useState<'so' | 'jw'>(() => routeSearch.tab ?? 'so');
  const { data: company } = useMyCompany();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  const canAdd = perms.entry;
  const canCancel = perms.edit && perms.approve;
  // Lazy initial: the URL seeds the box once; keystrokes stay local after that.
  // Only when the landing targets THIS tab — a `?tab=jw` landing must not
  // pre-fill the Customer Dispatch box with a JW code.
  const [search, setSearch] = useState(() =>
    (routeSearch.tab ?? 'so') === 'so' ? (routeSearch.search ?? '') : '',
  );
  const [term, setTerm] = useState(() => normalizeSearchTerm(search));
  const [soFilter, setSoFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<DispatchGroup | null>(null);
  const [exporting, setExporting] = useState(false);

  // Page in the URL; every search / SO / ▾ change goes back to page 1.
  const page = routeSearch.page;
  const gotoPage = useCallback(
    (p: number) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  useEffect(() => {
    const next = normalizeSearchTerm(search);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.customerDispatches, () => gotoPage(1));

  // Search covers every column the register puts on screen — the table row
  // (dispatch no, date, SO, customer, dispatched by) AND the ▸ expanded line
  // columns (JC no, POL, item code, item name, UOM) plus Remarks — matched on
  // the server (register.ts). Not the qty / stock numbers.
  const filters = useMemo(
    () => ({ search: term || undefined, soNo: soFilter || undefined, sf: sf.param }),
    [term, soFilter, sf.param],
  );
  const { data, isLoading, isFetching, isError, error } = useDispatchRegister({
    ...filters,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);
  const total = data?.total ?? 0;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const soOptions = data?.soOptions ?? [];
  // ADR-190 — how far each dispatch is invoiced, sent on its register rows.
  const billedById = useMemo(
    () => new Map(rows.map((r) => [r.dispatchId, r.billedStatus])),
    [rows],
  );

  const groups = useMemo(() => groupByDispatch(rows), [rows]);
  // ADR-202 — dispatch ids with a pending edit; their status cell reads "Draft".
  const draftIds = usePendingEditIds('Dispatch');
  const columns = useMemo(
    () => dispatchListColumns((id) => billedById.get(id), draftIds),
    [billedById, draftIds],
  );

  // KPIs over ACTIVE rows only (cancelled were reversed) — from the server,
  // over every matching row, never just this page.
  const totalPcs = data?.summary.totalQty ?? 0;

  // Excel: the SO filter + ▾ filters (text search stays screen-only, as
  // before). Print: every filter on screen, active rows only. Both fetch
  // EVERY matching row, not just this page.
  async function runExport(kind: 'excel' | 'print'): Promise<void> {
    setExporting(true);
    try {
      if (kind === 'excel') {
        const all = await fetchAllRegisterRows({ ...filters, search: undefined });
        exportDispatchRegister(all, soFilter || undefined);
      } else {
        const all = await fetchAllRegisterRows(filters);
        const active = all.filter((r) => r.status !== 'cancelled');
        if (!printCustomerDispatchRegister({ rows: active, company })) {
          window.alert('Allow popups to print.');
        }
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not load the register. Try again.');
    } finally {
      setExporting(false);
    }
  }

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.dispatchId));

  const tabBar = (
    <div
      style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}
    >
      {(['so', 'jw'] as const).map((t) => (
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
          {t === 'so' ? 'Customer Dispatch' : 'JW Return'}
        </button>
      ))}
    </div>
  );

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  if (tab === 'jw') {
    return (
      <div>
        {tabBar}
        {/* key: a new ?search landing while already on this page remounts the
            view so it re-seeds; nothing else changes the key. */}
        <JwDispatchView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the Dispatch
    // Log table is the only thing that scrolls, so its column header stays on
    // screen down to the last row.
    <div className="page-fill">
      {tabBar}
      {/* The ONE list header (ui/layout ListHeader). Search / SO / ▾ run on
          the server; Export / Print fetch every filtered row. */}
      <ListHeader
        title="Customer Dispatch"
        icon="🚚"
        count={total}
        noun="dispatch"
        nounPlural="dispatches"
        filterNote={soFilter || undefined}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search dispatch no., SO, JC, POL, item, customer, date…"
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="SO No."
            title="SO No."
            value={soFilter}
            onChange={(e) => {
              setSoFilter(e.target.value);
              gotoPage(1);
            }}
          >
            <option value="">All SOs</option>
            {soOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearch('');
          setSoFilter('');
          gotoPage(1);
        }}
        filtersActive={sf.filtering || search !== '' || soFilter !== ''}
        tools={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={groups.length === 0}
              title={allExpanded ? 'Hide every row’s items' : 'Show every row’s items'}
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(groups.map((g) => g.dispatchId)))
              }
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            <ActionMenu
              label="Export"
              items={[
                {
                  label: '📊 Export Excel',
                  title: 'Export the current (SO-filtered) register to Excel',
                  disabled: exporting,
                  onClick: () => void runExport('excel'),
                },
                {
                  label: '🖨 Print',
                  title: 'Print the dispatch register',
                  disabled: isLoading || exporting,
                  onClick: () => void runExport('print'),
                },
              ]}
            />
          </>
        }
        primary={
          canAdd ? (
            <Link to="/customer-dispatches/new" className="btn btn-primary">
              + New Dispatch
            </Link>
          ) : null
        }
      >
        {/* Read-only metrics, not filters. Counts are over ACTIVE rows
            (cancelled dispatches were reversed) and follow the SO filter,
            search and ▾ filters — worked out on the server over every page. */}
        <StatStrip
          items={[
            {
              key: 'pcs',
              label: 'Total Dispatched',
              count: totalPcs,
              color: 'var(--green2)',
              sub: 'pieces',
            },
            {
              key: 'entries',
              label: 'Dispatch Entries',
              count: data?.summary.dispatchCount ?? 0,
            },
          ]}
        />
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load dispatches. Try again.'}
        />
      ) : (
        <>
          <DispatchItemSummary items={data?.itemSummary ?? []} />

          <div
            style={{
              fontSize: 11,
              color: 'var(--cyan)',
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              margin: '4px 0 8px',
            }}
          >
            Dispatch Log
          </div>

          {/* THE shared FIT table (ADR-199). First column (Dispatch No.) is
              pinned; the row click opens the dispatch; the ▸ opens the item
              lines + Remarks; rows tint by status (cancelled → grey). */}
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.customerDispatches}
              columns={columns}
              rows={groups}
              rowKey={(g) => g.dispatchId}
              loading={isLoading}
              sortFilterServer={sf}
              emptyText={
                term || soFilter || sf.filtering ? 'No Dispatches match.' : 'No Dispatches yet.'
              }
              onRowClick={(g) =>
                void navigate({ to: '/customer-dispatches/$id', params: { id: g.dispatchId } })
              }
              rowClassName={(g) => (g.status === 'cancelled' ? ROW_TINT.cancelled : ROW_TINT.done)}
              renderExpanded={(g) =>
                expanded.has(g.dispatchId) ? <DispatchExpanded g={g} /> : null
              }
              onToggleExpanded={(g) => toggle(g.dispatchId)}
              rowActions={(g) => (
                <DispatchRowActions
                  g={g}
                  billedStatus={billedById.get(g.dispatchId)}
                  canCancel={canCancel}
                  cancelPending={cancelling !== null}
                  onInvoice={() =>
                    void navigate({ to: '/invoices/new', search: { dispatchId: g.dispatchId } })
                  }
                  onCancel={() => setCancelling(g)}
                />
              )}
            />
          </Panel>
          <ListFooter
            total={total}
            noun="dispatch"
            nounPlural="dispatches"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
        </>
      )}
      {cancelling ? (
        <CancelDispatchModal
          id={cancelling.dispatchId}
          code={cancelling.code}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </div>
  );
}
