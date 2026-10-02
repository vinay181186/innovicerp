// SO Master list (UI-003-05). THE Innovic fit table (ADR-199, table standard
// 2026-10-01): one ruled sheet, no card / list toggle. Every order is one row
// of the 12 standard columns; the row's ▸ opens its line items (component) or
// its BOM-status strip + exploded BOM (equipment), with Raised By and Remarks.
// Row click opens the SO detail; Edit / Assign / Delete live in the row's ⋯.
//
// What this file no longer owns (ADR-199 split): the card markup and its metric
// boxes, the List / Card ViewToggle and its per-browser memory, the hand-rolled
// sheet (components/so-sheet-table.tsx, retired), the column defs
// (components/so-list-columns.tsx) and the expanded panels
// (components/so-expanded-panel.tsx + so-component-expand.tsx +
// so-equipment-expand.tsx). The DATA and RULES stay: same query, same so_create
// access matrix, same soft-delete, same filters, same URL params.

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
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { REASON_REQUIRED_MESSAGE, ReasonField } from '../components/reason-field';
import { soListColumns, soRowMenu, soRowTint } from '../components/so-list-columns';
import { SoExpandedPanel } from '../components/so-expanded-panel';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { exportSoListExcel } from '../lib/import-export';
import { todayIst } from '@/lib/date';
import { fetchSalesOrdersForExport, useSalesOrdersList, useSoftDeleteSalesOrder } from '../api';

// No pagination — the SO/WO list loads all matching orders into one scrolling
// list (user decision: scroll, not Prev/Next pages). One fetch, offset 0. The
// API caps `limit` at 1000; the count line flags the rare case of a larger set.
const LIST_LIMIT = 1000;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  type: z.enum(SO_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
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
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
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

  const query: ListSalesOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      type: search.type,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.status, search.type],
  );

  const { data, isLoading, isFetching, isError, error } = useSalesOrdersList(query);
  // Access matrix (so_create, dept Sales) replaces the old admin/manager flag.
  //   New SO / bulk import -> entry; +Line / per-line edit -> edit;
  //   whole-SO delete      -> edit AND approve (L5 Dept Admin and up).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const canCreate = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // The row's ▸ opens that SO's detail fetch; nothing auto-expands on load, so
  // arriving on the list fires no per-order requests. A Set — many can be open.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const softDelete = useSoftDeleteSalesOrder();
  // Delete asks through the ONE confirm dialog (never window.confirm); a failed
  // delete is shown inside the dialog and the question stays open.
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

  // Export the whole filtered list to Excel — pulls every matching row (not just
  // the visible page) using the current search/type/status filter.
  const [exporting, setExporting] = useState(false);
  // Client-PO document being previewed (ADR-142). Preview in-app; the modal
  // owns the one button that actually downloads.
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  async function onExport(): Promise<void> {
    setExporting(true);
    try {
      const res = await fetchSalesOrdersForExport({
        search: search.search,
        status: search.status,
        type: search.type,
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

  // Hide-page: a user whose VIEW was removed for SO Master sees the no-access
  // panel, not the list. `eff` undefined only while access loads — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-201): this page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header — sticky to the table's
    // own scroll box — can never ride off the top of the screen, and the
    // search / filters stay reachable at the last row.
    <div className="page-fill">
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
        <Panel fill bodyPadding="none">
          <DataTable<SalesOrderListItem>
            tableKey={TABLE_KEYS.soMaster}
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={search.search || search.status || search.type ? 'No SOs match.' : 'No SOs yet.'}
            rowClassName={(so) => soRowTint(so, today)}
            onRowClick={(so) => void navigate({ to: '/sales-orders/$id', params: { id: so.id } })}
            // The fit table's ▸ is the row's one expand control: it opens the
            // SO's detail panel too. renderExpanded returns null for a closed
            // row, so the detail fetch never fires for it.
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

      <ListFooter total={total} shown={rows.length} noun="sales order" limit={LIST_LIMIT} />

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
