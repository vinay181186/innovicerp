// SO Master list (UI-003-05). THE Innovic fit table (ADR-199, table standard
// 2026-10-01): one ruled sheet, no card / list toggle. Every order is one row
// of the 12 standard columns; the row's ▸ opens its line items (component) or
// its BOM-status strip + exploded BOM (equipment), with Raised By and Remarks.
// Row click opens the SO detail; Edit / Assign / Delete live in the row's ⋯.
//
// Column defs live in components/so-list-columns.tsx, the ▸ panels in
// components/so-expanded-panel.tsx (+ so-component / so-equipment expand).

import {
  type ListSalesOrdersQuery,
  type SalesOrderListItem,
  SELECTABLE_SO_TYPES,
  SO_STATUSES,
  SO_TYPES,
  type SoStatus,
  type SoType,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { REASON_REQUIRED_MESSAGE, ReasonField } from '../components/reason-field';
import {
  SO_LIST_HIDDEN_COLUMNS,
  soListColumns,
  soRowMenu,
  soRowTint,
} from '../components/so-list-columns';
import { SoExpandedPanel } from '../components/so-expanded-panel';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { exportSoListExcel } from '../lib/import-export';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { fetchSalesOrdersForExport, useSalesOrdersList, useSoftDeleteSalesOrder } from '../api';

// ADR-201: 25 orders per page from the SERVER (was one 1000-row fetch); search /
// filters / Sort & Filter run there over ALL orders and reset to page 1.

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  type: z.enum(SO_TYPES).optional(),
  page: pageSearchParam,
});

export const salesOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders',
  validateSearch: listSearchSchema,
  component: SalesOrdersListPage,
});

function SalesOrdersListPage(): React.JSX.Element {
  const search = salesOrdersListRoute.useSearch();
  const navigate = salesOrdersListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link).
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-SO  26 " and "IN-SO 26" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER (ADR-200): the list is paged, so filtering
  // the loaded page only would miss orders. A change → page 1.
  const sf = useServerSortFilter(TABLE_KEYS.soMaster, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const offset = pageOffset(search.page);
  const query: ListSalesOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      type: search.type,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [sf.param, search.search, search.status, search.type, offset],
  );

  const { data, isLoading, isFetching, isError, error } = useSalesOrdersList(query);
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);
  // Access matrix (so_create, dept Sales) replaces the old admin/manager flag.
  //   New SO / bulk import -> entry; +Line / per-line edit -> edit;
  //   whole-SO delete      -> edit AND approve (L5 Dept Admin and up).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const canCreate = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // Rows whose ▸ is open (none on load, so no per-order fetches on arrival).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const softDelete = useSoftDeleteSalesOrder();
  // Delete asks through the ONE confirm dialog; a failure shows inside it.
  const [deletingSo, setDeletingSo] = useState<SalesOrderListItem | null>(null);
  // ADR-197 — why it goes to Trash (required; lands on the SO History).
  const [deleteReason, setDeleteReason] = useState('');
  const onDeleteSo = (so: SalesOrderListItem): void => {
    setDeleteReason('');
    setDeletingSo(so);
  };
  // The order whose Assign Task dialog is open (from its ⋯), or null.
  const [assignSo, setAssignSo] = useState<SalesOrderListItem | null>(null);

  // Export status banner — an export that finds nothing, or fails, says so here.
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Excel export: EVERY row matching search / status / type / Sort & Filter.
  const [exporting, setExporting] = useState(false);
  // Client-PO document being previewed in-app (ADR-142).
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  async function onExport(): Promise<void> {
    setExporting(true);
    try {
      const res = await fetchSalesOrdersForExport({
        search: search.search,
        status: search.status,
        type: search.type,
        sf: sf.param,
        limit: 10000,
        offset: 0,
      });
      if (res.items.length === 0) {
        setImportMsg('Nothing to export for the current filter.');
        return;
      }
      await exportSoListExcel(res.items);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not export. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const today = todayIst();
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const columns = useMemo(
    () => soListColumns({ today, onPreviewClientPo: setPreviewPath }),
    [today],
  );

  // Hide-page: no VIEW → the no-access panel (not while access still loads).
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader): title · count · Export · +
          New, then the filter bar (search · status · type · Clear). */}
      <ListHeader
        title="SO Master"
        icon="📋"
        count={total}
        noun="order"
        filterNote={search.status ? SO_STATUS_LABEL[search.status] : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search SO no., customer, client PO, part name, item code…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="SO status"
              title="SO status"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as SoStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
            >
              <option value="">All statuses</option>
              {SO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SO_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              aria-label="SO type"
              title="SO type"
              value={search.type ?? ''}
              onChange={(e) => {
                const v = e.target.value as SoType | '';
                void navigate({
                  search: (prev) => ({ ...prev, type: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
            >
              <option value="">All types</option>
              {SELECTABLE_SO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SO_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              status: undefined,
              type: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={
          sf.filtering ||
          search.search != null ||
          search.status != null ||
          search.type != null ||
          searchInput !== ''
        }
        tools={
          <button
            type="button"
            className="btn btn-ghost"
            disabled={exporting}
            title="Export the current (filtered) list to Excel"
            onClick={() => void onExport()}
          >
            {exporting ? (
              <Loader2 className="inline h-3 w-3 animate-spin" />
            ) : (
              <Download className="inline h-3 w-3" />
            )}{' '}
            Export
          </button>
        }
        primary={
          canCreate ? (
            <Link to="/sales-orders/new" className="btn btn-primary">
              + New SO
            </Link>
          ) : null
        }
      />

      {importMsg ? (
        <div
          className="panel"
          style={{ marginBottom: 10, padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}
        >
          {importMsg}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 8, fontSize: 11 }}
            onClick={() => setImportMsg(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load sales orders. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable<SalesOrderListItem>
            tableKey={TABLE_KEYS.soMaster}
            sortFilterServer={sf}
            columns={columns}
            defaultHidden={SO_LIST_HIDDEN_COLUMNS}
            rows={rows}
            loading={isLoading}
            empty={
              sf.filtering || search.search || search.status || search.type
                ? 'No SOs match.'
                : 'No SOs yet.'
            }
            rowClassName={(so) => soRowTint(so, today)}
            onRowClick={(so) => void navigate({ to: '/sales-orders/$id', params: { id: so.id } })}
            // ▸ opens the SO's detail panel; a closed row renders null (no fetch).
            renderExpanded={(so) =>
              expandedIds.has(so.id) ? (
                <SoExpandedPanel so={so} canEdit={canEdit} canDelete={canDelete} />
              ) : null
            }
            onToggleExpanded={(so) => toggleExpand(so.id)}
            rowMenu={(so) =>
              soRowMenu(so, { canEdit, canDelete, onAssign: setAssignSo, onDelete: onDeleteSo })
            }
            renderLink={(p) => <Link {...p} />}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="sales order"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {previewPath ? (
        <FilePreviewModal storagePath={previewPath} onClose={() => setPreviewPath(null)} />
      ) : null}

      {assignSo ? (
        <AssignTaskModal
          linkedRef={{
            type: 'sales_order',
            id: assignSo.id,
            display: `SO ${assignSo.code}`,
            navPage: `/sales-orders/${assignSo.id}`,
          }}
          suggestedTitle={
            assignSo.type === 'equipment' && assignSo.bomStatus === 'BOM Pending'
              ? `Create BOM for ${assignSo.code}`
              : `Follow up ${assignSo.code}`
          }
          onClose={() => setAssignSo(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deletingSo !== null}
        title={`Move SO ${deletingSo?.code ?? ''} to Trash?`}
        message={
          <>
            You can restore it from Trash.
            <ReasonField value={deleteReason} onChange={setDeleteReason} />
          </>
        }
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setDeletingSo(null)}
        onConfirm={async () => {
          if (!deletingSo) return;
          const reason = deleteReason.trim();
          if (!reason) throw new Error(REASON_REQUIRED_MESSAGE);
          await softDelete.mutateAsync({ id: deletingSo.id, reason });
          setDeletingSo(null);
        }}
      />
    </div>
  );
}
