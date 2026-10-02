// Reorder List (ADR-193 phase 5, owner decision Q5): every item Below Reorder
// (Available + On PO under its Reorder Level) with the suggested PR qty and the
// vendor of its last PO. Tick rows, adjust qty / vendor, Raise PRs — one Open PR
// per item, approved as usual. An item that already has an open PR shows it and
// cannot be ticked. Nothing is raised automatically.
//
// ADR-199 conversion (2026-10-01): now the shared fit table (<DataTable
// tableKey={reorderList}>). The tick-boxes + select-all + bulk "Raise PRs" ride
// the engine's selection props; "PR Qty" and "Vendor" are `control` columns
// (sibling file reorder-list-columns.tsx). Data, mutations and the raise-PR flow
// are unchanged.
//
// ADR-201 (2026-10-02): 25-row server pages with Prev / Next (page in the URL);
// Sort & Filter (▾) runs on the server; the header count is the server total.
// Ticks are kept by item id ACROSS pages together with the ticked row itself
// (its suggested qty / vendor / code), so "Raise PRs (n)" raises every ticked
// item, not just the ones on screen. Select-all = this page.
import type { ReorderListRow, ReorderPrResult } from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useRaiseReorderPrs, useReorderList } from '../api';
import { reorderListColumns, type Draft } from '../components/reorder-list-columns';

export const reorderListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reorder-list',
  validateSearch: z.object({ page: pageSearchParam }),
  component: ReorderListPage,
});

function ReorderListPage(): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const canRaise = effectiveFormPerms(eff, 'pr_create').entry;
  const search = reorderListRoute.useSearch();
  const navigate = reorderListRoute.useNavigate();
  const gotoPage = useCallback(
    (p: number): void => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.reorderList, () => gotoPage(1));
  const { data, isLoading, isFetching, isError, error } = useReorderList({
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.page),
  });
  const total = data?.total ?? 0;
  useClampPage(search.page, data?.total, gotoPage);
  const raise = useRaiseReorderPrs();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // The ticked rows by item id, across pages — the row is kept with its id so
  // a tick on page 1 still raises its PR while page 3 is on screen.
  const [ticked, setTicked] = useState<Map<string, ReorderListRow>>(() => new Map());
  const selectedKeys = useMemo(() => new Set(ticked.keys()), [ticked]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReorderPrResult | null>(null);

  const rows = useMemo(() => data?.items ?? [], [data]);

  const draftOf = useCallback(
    (r: ReorderListRow): Draft =>
      drafts[r.itemId] ?? {
        qty: String(r.suggestedQty),
        vendorId: r.suggestedVendor?.id ?? null,
        vendorLabel: r.suggestedVendor?.code,
      },
    [drafts],
  );
  const setDraft = useCallback(
    (r: ReorderListRow, patch: Partial<Draft>): void =>
      setDrafts((d) => ({
        ...d,
        [r.itemId]: {
          ...(d[r.itemId] ?? {
            qty: String(r.suggestedQty),
            vendorId: r.suggestedVendor?.id ?? null,
            vendorLabel: r.suggestedVendor?.code,
          }),
          ...patch,
        },
      })),
    [],
  );

  const columns = useMemo(
    () => reorderListColumns({ draftOf, setDraft, canRaise }),
    [draftOf, setDraft, canRaise],
  );

  // A row can be ticked only when the user may raise PRs and it has no open PR.
  const isRowSelectable = useCallback(
    (r: ReorderListRow): boolean => canRaise && r.openPrs.length === 0,
    [canRaise],
  );

  const onToggleRow = useCallback(
    (key: string | number, r: ReorderListRow, next: boolean): void => {
      setTicked((s) => {
        const ns = new Map(s);
        if (next) ns.set(String(key), r);
        else ns.delete(String(key));
        return ns;
      });
    },
    [],
  );

  // Select-all = this page's rows (the engine passes their keys).
  const onToggleAll = useCallback(
    (next: boolean, keys: (string | number)[]): void => {
      const byId = new Map(rows.map((r) => [r.itemId, r]));
      setTicked((s) => {
        const ns = new Map(s);
        for (const k of keys) {
          const row = byId.get(String(k));
          if (next && row) ns.set(String(k), row);
          else if (!next) ns.delete(String(k));
        }
        return ns;
      });
    },
    [rows],
  );

  const tickedCount = ticked.size;

  const onRaise = useCallback((): void => {
    setErr(null);
    setResult(null);
    const lines: Array<{ itemId: string; qty: number; vendorId: string }> = [];
    for (const r of ticked.values()) {
      const d = draftOf(r);
      const q = Number(d.qty);
      if (!Number.isFinite(q) || q <= 0) return setErr(`${r.itemCode}: enter the PR Qty.`);
      if (!d.vendorId) return setErr(`${r.itemCode}: pick the vendor.`);
      lines.push({ itemId: r.itemId, qty: q, vendorId: d.vendorId });
    }
    if (lines.length === 0) return setErr('Tick at least one item.');
    raise.mutate(
      { lines },
      {
        onSuccess: (res) => {
          setResult(res);
          setDrafts({});
          setTicked(new Map());
        },
        onError: (e) => setErr(e.message || 'Could not raise the PRs.'),
      },
    );
  }, [ticked, draftOf, raise]);

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is the
    // only scrollbox, so the column header cannot ride off the top at the last row.
    <div className="page-fill">
      <ListHeader
        title="Reorder List"
        icon="🔁"
        count={isLoading ? undefined : total}
        noun="item below reorder"
        updating={isFetching && !isLoading}
        onClearFilters={sf.clearFilters}
        filtersActive={sf.filtering}
      />
      {result ? (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{ fontSize: 12 }}>
            {result.created.length > 0 ? (
              <div>
                ✓ Raised:{' '}
                {result.created.map((c, i) => (
                  <span key={c.prId}>
                    {i > 0 ? ', ' : ''}
                    <Link to="/purchase-requests/$id" params={{ id: c.prId }} className="td-code">
                      {c.prCode}
                    </Link>{' '}
                    ({c.itemCode} × {c.qty})
                  </span>
                ))}
              </div>
            ) : null}
            {result.skipped.map((s) => (
              <div key={s.itemCode} style={{ color: 'var(--amber2)' }}>
                Skipped {s.itemCode}: {s.reason}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {err ? (
        <div style={{ color: 'var(--red2)', fontSize: 12, marginBottom: 8 }}>{err}</div>
      ) : null}
      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load the reorder list.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.reorderList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            rowKey={(r) => r.itemId}
            editable
            sortFilterServer={sf}
            emptyText={sf.filtering ? 'No items match.' : 'Nothing is below its Reorder Level.'}
            // A blocked row (has an open PR) is washed, as it was greyed before.
            rowClassName={(r) => (r.openPrs.length > 0 ? ROW_TINT.cancelled : undefined)}
            selectable
            selectedKeys={selectedKeys}
            isRowSelectable={isRowSelectable}
            onToggleRow={onToggleRow}
            onToggleAll={onToggleAll}
            selectionActions={() => (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setTicked(new Map())}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={raise.isPending || tickedCount === 0}
                  onClick={onRaise}
                >
                  {raise.isPending ? 'Raising…' : `Raise PRs (${tickedCount})`}
                </button>
              </>
            )}
          />
        </Panel>
      )}
      <ListFooter
        total={total}
        noun="item"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
