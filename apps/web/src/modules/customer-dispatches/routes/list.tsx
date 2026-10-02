// Customer Dispatch Register — mirror of legacy `renderDispatchRegister`
// (L10711): item-wise summary panel + dispatch log + search + Print. Per user
// direction 2026-06-06 the log is ONE ROW PER DISPATCH, click to expand its
// item lines; SO filter + Export Excel (all dispatches flattened to line rows).
//
// 2026-10-01 (ADR-199): the per-dispatch cards are replaced by the ONE shared
// FIT table (<DataTable tableKey=…>). One line per dispatch, the fit engine
// sizing columns to the screen and dropping the rightmost unpinned ones into a
// ▸ detail row (the item lines + Remarks). Nothing about the data, the filters,
// the search coverage or the mutations changed. The item-wise summary strip and
// the StatStrip counts stay.

import { Link, createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { JwDispatchView } from '@/modules/jw-returns/components/jw-dispatch-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ActionMenu, ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useMyCompany } from '@/modules/settings/api';
import { useDispatchList, useDispatchRegister } from '../api';
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
// local and never navigate.
const searchSchema = z.object({
  tab: z.enum(['so', 'jw']).optional(),
  search: z.string().optional(),
});

export const customerDispatchListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches',
  validateSearch: (search) => searchSchema.parse(search),
  component: CustomerDispatchListPage,
});

function CustomerDispatchListPage(): React.JSX.Element {
  // JW Dispatch (jw-returns) folded in here as a tab — same job, two document
  // families: this one ships finished goods against an SO, that one returns
  // machined goods against a JWSO line. Its own hooks/mutations are unchanged.
  const routeSearch = customerDispatchListRoute.useSearch();
  const navigate = customerDispatchListRoute.useNavigate();
  const [tab, setTab] = useState<'so' | 'jw'>(() => routeSearch.tab ?? 'so');
  const { data, isLoading, isFetching, isError, error } = useDispatchRegister();
  const { data: company } = useMyCompany();
  // ADR-190 — how far each dispatch is invoiced lives on the dispatch-grain
  // list, not the line-grain register this page is built from.
  const { data: dispatchList } = useDispatchList();
  const billedById = useMemo(
    () => new Map((dispatchList?.dispatches ?? []).map((d) => [d.id, d.billedStatus])),
    [dispatchList],
  );
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
  const [soFilter, setSoFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<DispatchGroup | null>(null);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const soOptions = useMemo(
    () => [...new Set(allRows.map((r) => r.soNo).filter((s): s is string => Boolean(s)))],
    [allRows],
  );

  // SO filter applies to screen AND export; text search is screen-only.
  const soRows = useMemo(
    () => (soFilter ? allRows.filter((r) => r.soNo === soFilter) : allRows),
    [allRows, soFilter],
  );
  // Search covers every column the register puts on screen — the table row
  // (dispatch no, date, SO, customer, dispatched by) AND the ▸ expanded line
  // columns (JC no, POL, item code, item name, UOM) plus Remarks. Not the
  // qty / stock numbers: a bare "5" would match nearly every row.
  const rows = useMemo(() => {
    const q = normalizeSearchTerm(search);
    if (!q) return soRows;
    return soRows.filter((r) =>
      matchesSearchTerm(
        [
          r.dispatchCode,
          r.status,
          r.date,
          r.jcNo,
          r.soNo,
          r.clientPoLineNo,
          r.itemCode,
          r.itemCodeText,
          // The line shows "IN-IT-0007/B", so pasting that back into the search
          // box has to find it. The bare code stays searchable above.
          itemCodeWithRev(r.itemCode ?? r.itemCodeText, r.itemRevision, ''),
          r.itemName,
          r.uom,
          r.customer,
          r.dispatchedBy,
          r.remarks,
        ],
        q,
      ),
    );
  }, [soRows, search]);

  const groups = useMemo(() => groupByDispatch(rows), [rows]);
  const columns = useMemo(() => dispatchListColumns((id) => billedById.get(id)), [billedById]);

  // KPIs + item-wise summary over ACTIVE rows only (cancelled were reversed).
  const active = useMemo(() => rows.filter((r) => r.status !== 'cancelled'), [rows]);
  const totalPcs = active.reduce((s, r) => s + r.qty, 0);

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
    // `page-fill` (ADR-201): the page fills the content area and the Dispatch
    // Log table is the only thing that scrolls, so its column header stays on
    // screen down to the last row.
    <div className="page-fill">
      {tabBar}
      {/* The ONE list header (ui/layout ListHeader). Same filters, same
          client-side search, same Export / Print as before. */}
      <ListHeader
        title="Customer Dispatch"
        icon="🚚"
        count={groups.length}
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
            onChange={(e) => setSoFilter(e.target.value)}
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
          setSearch('');
          setSoFilter('');
        }}
        filtersActive={search !== '' || soFilter !== ''}
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
                  onClick: () => exportDispatchRegister(soRows, soFilter || undefined),
                },
                {
                  label: '🖨 Print',
                  title: 'Print the dispatch register',
                  disabled: isLoading,
                  onClick: () => {
                    if (!printCustomerDispatchRegister({ rows: active, company })) {
                      window.alert('Allow popups to print.');
                    }
                  },
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
            (cancelled dispatches were reversed) and follow the SO filter +
            search, exactly as before. */}
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
              count: groups.filter((g) => g.status !== 'cancelled').length,
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
          <DispatchItemSummary active={active} />

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
              emptyText={search || soFilter ? 'No Dispatches match.' : 'No Dispatches yet.'}
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
          <ListFooter total={groups.length} noun="dispatch" nounPlural="dispatches" />
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
