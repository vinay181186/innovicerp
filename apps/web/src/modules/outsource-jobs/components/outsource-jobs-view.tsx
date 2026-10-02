// Outsource Jobs (OSP) view — mirror of legacy renderOutsourceJobs (L27044),
// embedded as a tab inside Purchase Requests. ADR-199 conversion: the hand-built
// table is now the shared FIT table (DataTable + tableKey); its columns, ▸
// expand, status tint and per-row action live in ./outsource-jobs-columns, and
// the two balance questions in ../lib/osp-band.
//
// ADR-201 (2026-10-02): 25 OSP requests a page, loaded one page at a time. The
// band (Open / PO Created), the JC filter, the search and Sort & Filter all run
// on the SERVER over every OSP request (prType=jw_osp, orderBand, sourceJcCode,
// search, sf); the "(n)" counts in the band dropdown are server totals. Any
// change goes back to page 1. The page is component state (a tab, no route).
//
// "Create PO from Selected" opens the full PO form at /purchase-orders/from-pr
// ?prIds=… with the Purchase Requests tab's one-vendor-per-PO rule: the ticks
// are kept BY ID across pages (usePrSelection records each tick's vendor), and
// a request of a different vendor than the first ticked cannot be ticked.
// "Select all" ticks this page. Same po_create entry gate.
//
// 2026-09-08 (ADR-152): the bands, the tick box and the Pending column all read
// the BALANCE (purchase-requests/lib/pr-balance), not `status === 'po_created'`.

import type { ListPurchaseRequestsQuery, PurchaseRequestListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useDebounce } from '@/lib/use-debounce';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import { usePrSelection } from '@/modules/purchase-requests/lib/use-pr-selection';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

import { OspJcFilter } from './osp-jc-filter';
import {
  OutsourceJobExpand,
  OutsourceJobRowActions,
  ospRowTint,
  outsourceJobsColumns,
} from './outsource-jobs-columns';
import { ospCanOrder } from '../lib/osp-band';

type Band = 'open' | 'po_created';

// Band counts over every OSP request (module constants keep the keys stable).
const COUNT_ALL: ListPurchaseRequestsQuery = { prType: 'jw_osp', limit: 1, offset: 0 };
const COUNT_OPEN: ListPurchaseRequestsQuery = { ...COUNT_ALL, orderBand: 'open' };
const COUNT_ORDERED: ListPurchaseRequestsQuery = { ...COUNT_ALL, orderBand: 'ordered' };

export function OutsourceJobsView(): React.JSX.Element {
  const [jcNo, setJcNo] = useState<string | undefined>(undefined);
  const [statusBand, setStatusBand] = useState<Band | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(normalizeSearchTerm(searchText), 300);
  const [page, setPage] = useState(1);

  // Sort & Filter on the server (the tab is paged); every change → page 1.
  const sf = useServerSortFilter(TABLE_KEYS.outsourceJobs, () => setPage(1));
  const lastFilters = useRef(`${jcNo}|${statusBand}|${search}`);
  useEffect(() => {
    const key = `${jcNo}|${statusBand}|${search}`;
    if (lastFilters.current === key) return;
    lastFilters.current = key;
    setPage(1);
  }, [jcNo, statusBand, search]);

  // Ticking a row raises a PURCHASE ORDER, so it follows po_create entry — the
  // same key the Purchase Requests tab gates its tick boxes on, and the key
  // /purchase-orders/from-pr itself guards on.
  const { data: eff } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'po_create').entry;

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      prType: 'jw_osp',
      ...(statusBand ? { orderBand: statusBand === 'open' ? 'open' : 'ordered' } : {}),
      ...(jcNo ? { sourceJcCode: jcNo } : {}),
      ...(search ? { search } : {}),
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [statusBand, jcNo, search, sf.param, page],
  );
  const { data, isLoading, isFetching, isError, error } = usePurchaseRequestsList(query);
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, setPage);

  const totalPR = usePurchaseRequestsList(COUNT_ALL).data?.total;
  const openPR = usePurchaseRequestsList(COUNT_OPEN).data?.total;
  const poCreated = usePurchaseRequestsList(COUNT_ORDERED).data?.total;
  const n = (v: number | undefined): string => (v === undefined ? '' : ` (${v})`);

  // One vendor per PO, ticks kept by id across pages (the PR tab's hook); the
  // OSP tick gate adds the band's "still something to order" question.
  const sel = usePrSelection(rows, canEdit);
  const isRowSelectable = useCallback(
    (pr: PurchaseRequestListItem): boolean => ospCanOrder(pr) && sel.isRowSelectable(pr),
    [sel],
  );
  const onToggleAll = useCallback(
    (next: boolean, keys: (string | number)[]): void => {
      const ok = new Set(rows.filter(ospCanOrder).map((pr) => pr.id));
      sel.onToggleAll(next, next ? keys.filter((k) => ok.has(String(k))) : keys);
    },
    [rows, sel],
  );

  const columns = useMemo(() => outsourceJobsColumns(), []);
  const filtering = statusBand !== undefined || jcNo !== undefined || searchText !== '';

  return (
    <div>
      <ListHeader
        title="Outsource Jobs"
        icon="📦"
        count={data?.total}
        noun="OSP request"
        filterNote={
          [
            statusBand === 'open' ? 'Open' : statusBand === 'po_created' ? 'PO Created' : null,
            jcNo ?? null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        search={searchText}
        onSearch={setSearchText}
        searchPlaceholder="Search PR No., JC, item, process, vendor, due, status…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="OSP status"
              title="OSP status"
              value={statusBand ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStatusBand(v === 'open' || v === 'po_created' ? v : undefined);
              }}
            >
              <option value="">All{n(totalPR)}</option>
              <option value="open">Open{n(openPR)}</option>
              <option value="po_created">PO Created{n(poCreated)}</option>
            </select>
            <OspJcFilter value={jcNo} onChange={setJcNo} />
          </>
        }
        onClearFilters={() => {
          setSearchText('');
          setJcNo(undefined);
          setStatusBand(undefined);
          sf.clearFilters();
        }}
        filtersActive={filtering || sf.filtering}
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load outsource jobs. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.outsourceJobs}
            columns={columns}
            rows={rows}
            rowKey={(pr) => pr.id}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              filtering || sf.filtering ? 'No Outsource Jobs match.' : 'No Outsource Jobs yet.'
            }
            rowClassName={ospRowTint}
            renderExpanded={(pr) => <OutsourceJobExpand pr={pr} />}
            rowActions={(pr) => <OutsourceJobRowActions pr={pr} canCreatePo={canEdit} />}
            selectable
            selectedKeys={sel.selectedKeys}
            onToggleRow={sel.onToggleRow}
            onToggleAll={onToggleAll}
            isRowSelectable={isRowSelectable}
            selectionActions={() => (
              <>
                {sel.lockedVendor ? (
                  <span className="text3" style={{ fontSize: 12 }}>
                    Vendor <span className="text2 fw-700">{sel.lockedVendor.label}</span>
                  </span>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={sel.clear}>
                  Clear
                </button>
                <Link
                  to="/purchase-orders/from-pr"
                  search={{ prIds: sel.selectedIds.join(',') }}
                  className="btn btn-primary btn-sm"
                  title="Raises one PO from the ticked OSP requests (one vendor)."
                >
                  🛒 Create PO from Selected ({sel.selectedCount})
                </Link>
              </>
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="OSP request"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={setPage}
        hint="Tick OSP requests → Create PO from Selected."
      />
    </div>
  );
}
