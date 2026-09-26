// SO / WO Orders (UI-003-05 + legacy renderSOmaster L11839 parity), rendered as
// one CARD per order per the reference supplied 2026-08-11 — accent bar, chip
// row, metric strip, line items inside. Replaced a twelve-column table that was
// wider than any screen; no field was dropped in the move, only regrouped.
// Per-card +Line / Assign / Del; expanded component lines show JC Qty /
// Dispatched / Balance with inline Edit + Del; expanded equipment shows the
// BOM-status strip + exploded BOM items table. Header has Excel Export.
// 2026-09-21: a List View (the ruled sheet, components/so-sheet-table.tsx) sits
// beside the cards behind a List View / Card View toggle, remembered per
// browser. Same query, same expand state, same actions and gates in both.

import {
  type ListSalesOrdersQuery,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderLineInput,
  type SalesOrderListItem,
  SELECTABLE_SO_TYPES,
  SO_STATUSES,
  SO_TYPES,
  type SoStatus,
  type SoType,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ConfirmDialog } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState, StatusPills, ViewToggle } from '@/ui/layout';
import { useSoStatus } from '../../so-status/api';
import {
  fetchSalesOrdersForExport,
  useSalesOrder,
  useSalesOrdersList,
  useSoftDeleteSalesOrder,
  useUpdateSalesOrder,
} from '../api';
import { SoSheetTable } from '../components/so-sheet-table';
import { SoStatusBadge } from '../components/so-status-badge';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { exportSoListExcel } from '../lib/import-export';
import { fmtDate, todayIst } from '@/lib/date';
import {
  ItemBadge,
  ItemThumbnailCell,
  ItemThumbnailHeader,
  THUMBNAIL_COL_WIDTH,
} from '@/components/shared/item-badge';

// ISSUE-020 — legacy puts its cell classes on the <td> itself (e.g. L11867
// `<td class="td-ctr mono fw-700">`), not on a wrapper span. td-ctr is
// text-align:center, which does nothing on an inline <span>, and
// `.innovic-table td` sets no text-align of its own — so those columns rendered
// left-aligned where legacy centres them. Carry the class through the column def
// so the flexRender loop puts it where legacy has it. Mirrors the augmentation
// in items/routes/list.tsx.
// No pagination — the SO/WO list loads all matching orders into one scrolling
// list (user decision: scroll, not Prev/Next pages). One fetch, offset 0. The
// API caps `limit` at 1000; the count line flags the rare case of a larger set.
const LIST_LIMIT = 1000;
// Where the List / Card choice is remembered (per browser, like the JC list's).
const VIEW_STORAGE_KEY = 'so-list-view';

/** One cell of the card's metric strip — big number over a small caps label,
 *  the shape the reference uses for TOTAL QTY / JC QTY / LINES. */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: number;
  color?: string;
  bordered?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

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

// Map a read line back to the update-input shape, preserving identity (id +
// itemId) so mergeLines updates it in place rather than recreating it.
function lineToInput(l: SalesOrderLine): SalesOrderLineInput {
  return {
    id: l.id,
    ...(l.itemId ? { itemId: l.itemId } : {}),
    ...(l.itemCodeText ? { itemCodeText: l.itemCodeText } : {}),
    partName: l.partName,
    ...(l.material ? { material: l.material } : {}),
    ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
    // Carried through unconditionally. Rev is compulsory on the input shape, and
    // this path is a line DELETE from the list — it re-sends the surviving lines
    // untouched, so dropping the Rev here would blank it on every line of the SO
    // as a side effect of removing one. Falls back to '0', the value every line
    // held before anyone typed one, so a line that somehow stored a blank still
    // satisfies the required field instead of failing the whole save.
    revision: l.revision || '0',
    uom: l.uom,
    orderQty: l.orderQty,
    rate: Number(l.rate) || 0,
    ...(l.dueDate ? { dueDate: l.dueDate } : {}),
    ...(l.clientPoLineNo ? { clientPoLineNo: l.clientPoLineNo } : {}),
    status: l.status,
  };
}

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

  // List View (the ruled sheet) vs Card View (the original cards). List is the
  // default; the choice is remembered per browser, wrapped in try/catch so a
  // locked-down browser (no localStorage) still renders. Same pattern as the
  // Job Cards list.
  const [view, setView] = useState<'list' | 'card'>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'card' ? 'card' : 'list';
    } catch {
      return 'list';
    }
  });
  const changeView = (next: 'list' | 'card'): void => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore — persistence is best-effort
    }
  };

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

  // Many cards can be open at once (the reference shows every order with its
  // lines visible), so this is a Set rather than the single id it used to be.
  // Nothing auto-expands on load: each open card fetches that SO's detail, and
  // expanding 25 of them on arrival would fire 25 requests nobody asked for.
  // "Expand all" is one click away for the reference's fully-open view.
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
  const onDeleteSo = (so: SalesOrderListItem): void => setDeletingSo(so);

  // Export status banner — an export that finds nothing, or fails, says so here.
  // (There was a bulk multi-SO Excel import on this screen; removed on the
  // user's instruction 2026-08-31. Orders are raised through + New SO / WO. The
  // per-SO line-item import inside the SO form is untouched.)
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Export the whole filtered list to Excel — pulls every matching row (not just
  // the visible page) using the current search/type/status filter.
  const [exporting, setExporting] = useState(false);
  // Client-PO document being previewed (ADR-142). The paperclip used to
  // `window.open` a signed URL, which let Chrome's "download PDFs" setting save
  // the file when the user only meant to look at it. Preview in-app; the modal
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

  // One CARD per order, per the SO / WO Orders reference (2026-08-11). The
  // twelve-column table it replaces was wider than any screen, so reading one
  // order meant travelling the full width past mostly-empty cells.
  //
  // Every field the table showed still renders — code, client, lines, date,
  // client PO, raised by, remarks, total qty, JC qty, due, type, status, BOM
  // status — regrouped into the card's three bands: identity + chips on top,
  // the metric boxes and meta line below, line items inside.
  //
  // The table machinery (TanStack column defs + SortableHead) is gone with it:
  // a card list has no column headers to click, so per-column sorting goes too.
  // It only ever sorted the 25 rows already on screen.
  const today = todayIst();
  const rows = data?.items ?? [];
  const allExpanded = rows.length > 0 && rows.every((r) => expandedIds.has(r.id));

  /** Left accent bar — red when the order is late, green once it is finished,
   *  blue while it is simply open. Same three tokens the badges use. */
  const accentFor = (so: SalesOrderListItem): string => {
    if (so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open') {
      return 'var(--red)';
    }
    if (so.status === 'closed' || so.status === 'dispatched') return 'var(--green)';
    return 'var(--blue)';
  };

  const total = data?.total ?? 0;

  // Hide-page: a user whose VIEW was removed for SO Master sees the no-access
  // panel, not the list. `eff` undefined only while access loads — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader): title · count · search ·
          type filter · Export · + New, with the status pills and the view
          toggle in its sticky band. Same URL params, same query as before. */}
      <ListHeader
        title="SO Master"
        icon="📋"
        count={total}
        noun="order"
        filterNote={search.status ? SO_STATUS_LABEL[search.status] : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search SO no., customer, client PO, part, item code…"
        updating={isFetching && !isLoading}
        tools={
          <>
            <select
              className="innovic-select"
              value={search.type ?? ''}
              onChange={(e) => {
                const v = e.target.value as SoType | '';
                void navigate({
                  search: (prev) => ({ ...prev, type: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 160 }}
            >
              <option value="">All types</option>
              {SELECTABLE_SO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SO_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
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
          </>
        }
        primary={
          canCreate ? (
            <Link to="/sales-orders/new" className="btn btn-primary">
              + New SO
            </Link>
          ) : null
        }
      >
        {/* Status filter pills — every SO_STATUSES value, same `status` param.
            Expand all works on the one expandedIds set both views read. */}
        <StatusPills
          options={SO_STATUSES.map((s) => ({ value: s, label: SO_STATUS_LABEL[s] }))}
          value={search.status ?? null}
          onChange={(s) =>
            void navigate({
              search: (prev) => ({ ...prev, status: (s as SoStatus | null) ?? undefined, page: 1 }),
              replace: true,
            })
          }
          right={
            <ViewToggle
              value={view}
              onChange={changeView}
              expandAll={allExpanded}
              onExpandAll={() =>
                setExpandedIds(allExpanded ? new Set() : new Set(rows.map((r) => r.id)))
              }
            />
          }
        />
      </ListHeader>

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

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load sales orders. Try again.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          {search.search || search.status || search.type ? 'No SOs match.' : 'No SOs yet.'}
        </div>
      ) : view === 'list' ? (
        // ── LIST VIEW (the ruled sheet) ──────────────────────────────────────
        <SoSheetTable
          rows={rows}
          expandedIds={expandedIds}
          toggleExpand={toggleExpand}
          today={today}
          canEdit={canEdit}
          canDelete={canDelete}
          onOpen={(so) => void navigate({ to: '/sales-orders/$id', params: { id: so.id } })}
          onDeleteSo={onDeleteSo}
          onPreviewClientPo={setPreviewPath}
          renderExpanded={(so) => (
            <SoExpandedPanel
              soId={so.id}
              soType={so.type}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          )}
        />
      ) : (
        // ── CARD VIEW (the original cards, untouched) ────────────────────────
        rows.map((so) => {
          const isExpanded = expandedIds.has(so.id);
          const overdue =
            so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open';
          const jcColor =
            so.jcQty >= so.totalQty && so.totalQty > 0
              ? 'var(--green)'
              : so.jcQty > 0
                ? 'var(--amber)'
                : 'var(--text3)';
          return (
            <div
              key={so.id}
              className="panel"
              style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
            >
              {/* Accent bar — red late, green finished, blue open. */}
              <div style={{ width: 4, flexShrink: 0, background: accentFor(so) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* ── Band 1: identity + chips — actions ── */}
                <div
                  onClick={() => toggleExpand(so.id)}
                  title={isExpanded ? 'Hide line items' : 'Show line items'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '10px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: 'var(--text3)', display: 'inline-flex' }} aria-hidden>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  {/* The card body toggles the lines, so the CODE is the way to
                      the detail page — stopPropagation keeps the click off the
                      toggle underneath it. */}
                  <Link
                    to="/sales-orders/$id"
                    params={{ id: so.id }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                    title="Open the SO Master detail page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {so.code}
                  </Link>
                  <span className="fw-700" style={{ fontSize: 13 }}>
                    {so.customerName ?? '—'}
                  </span>
                  {/* Legacy renders the type through badge() (L11870), which has
                      no map entry for either SO type and falls through to grey. */}
                  <span className="badge b-grey">{SO_TYPE_LABEL[so.type]}</span>
                  <SoStatusBadge status={so.status} />
                  {so.type === 'equipment' && so.bomStatus ? (
                    <span
                      className={`badge ${so.bomStatus === 'BOM Pending' ? 'b-amber' : so.bomStatus === 'BOM Planned' ? 'b-green' : 'b-blue'}`}
                    >
                      {so.bomStatus}
                    </span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  {canEdit || canDelete ? (
                    <div
                      style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit ? (
                        <Link
                          to="/sales-orders/$id/edit"
                          params={{ id: so.id }}
                          className="btn btn-primary btn-sm"
                          title="Add line to this SO"
                        >
                          + Line
                        </Link>
                      ) : null}
                      {canEdit && so.status !== 'closed' ? (
                        <AssignTaskButton
                          linkedRef={{
                            type: 'sales_order',
                            id: so.id,
                            display: `SO ${so.code}`,
                            navPage: `/sales-orders/${so.id}`,
                          }}
                          suggestedTitle={
                            so.type === 'equipment' && so.bomStatus === 'BOM Pending'
                              ? `Create BOM for ${so.code}`
                              : `Follow up ${so.code}`
                          }
                          label=""
                        />
                      ) : null}
                      {canDelete && so.status !== 'closed' ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => onDeleteSo(so)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* ── Band 2: metric boxes + meta line ── */}
                <div
                  onClick={() => toggleExpand(so.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '0 14px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}
                  >
                    <QtyBox label="Total Qty" value={so.totalQty} />
                    <QtyBox label="JC Qty" value={so.jcQty} color={jcColor} bordered />
                    <QtyBox label="Lines" value={so.lineCount} bordered />
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text3)',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="text2">{fmtDate(so.soDate)}</span>
                    <span>·</span>
                    <span>
                      Client PO No.{' '}
                      <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                        {so.clientPoNo ?? '—'}
                      </span>
                    </span>
                    {so.clientPoFilePath ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '0 4px', lineHeight: 1 }}
                        title="Preview Client PO Document"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewPath(so.clientPoFilePath!);
                        }}
                      >
                        📎
                      </button>
                    ) : null}
                    <span>·</span>
                    <span className="text2">{so.createdByName ?? '—'}</span>
                    <span>·</span>
                    <span
                      style={{
                        color: overdue ? 'var(--red)' : undefined,
                        fontWeight: overdue ? 700 : undefined,
                      }}
                    >
                      {so.earliestDueDate
                        ? `Due ${fmtDate(so.earliestDueDate)}${overdue ? ' ⚠' : ''}`
                        : 'No due date'}
                    </span>
                    <span>·</span>
                    <span title={so.remarks ?? ''}>{so.remarks || '—'}</span>
                  </div>
                </div>

                {/* ── Band 3: line items ── */}
                {isExpanded ? (
                  <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                    <SoExpandedPanel
                      soId={so.id}
                      soType={so.type}
                      canEdit={canEdit}
                      canDelete={canDelete}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      <ListFooter total={total} shown={rows.length} noun="sales order" limit={LIST_LIMIT} />
      {previewPath ? (
        <FilePreviewModal storagePath={previewPath} onClose={() => setPreviewPath(null)} />
      ) : null}
      <ConfirmDialog
        open={deletingSo !== null}
        title={`Move SO ${deletingSo?.code ?? ''} to Trash?`}
        message="You can restore it from Trash."
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setDeletingSo(null)}
        onConfirm={async () => {
          if (!deletingSo) return;
          await softDelete.mutateAsync(deletingSo.id);
          setDeletingSo(null);
        }}
      />
    </div>
  );
}

function SoExpandedPanel({
  soId,
  soType,
  canEdit,
  canDelete,
}: {
  soId: string;
  soType: SoType;
  canEdit: boolean;
  canDelete: boolean;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useSalesOrder(soId);
  if (isLoading)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 size={12} className="inline animate-spin" /> Loading lines…
      </div>
    );
  if (isError || !data)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load SO detail. Try again.'}
      </div>
    );
  return soType === 'equipment' ? (
    <EquipmentSoExpand so={data} canEdit={canEdit} canDelete={canDelete} />
  ) : (
    <ComponentSoExpand so={data} canEdit={canEdit} />
  );
}

function EquipmentSoExpand({
  so,
  canEdit,
  canDelete,
}: {
  so: SalesOrderDetail;
  canEdit: boolean;
  canDelete: boolean;
}): React.JSX.Element {
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const line = so.lines[0];
  if (!line)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        No lines yet — add an item to this SO.
      </div>
    );
  const bomStatus = so.bomStatus ?? 'BOM Pending';
  return (
    <div>
      <div
        style={{
          padding: '10px 18px 8px 36px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          alignItems: 'center',
        }}
      >
        {/* Same label band as <Fact>, but the value is the item badge (thumbnail ·
            code · name) rather than a string. The equipment line is an SO line
            like any other, so its drawing revision renders as CODE/REV (ADR-177). */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Equipment</div>
          <ItemBadge
            size="row"
            code={line.itemCode ?? line.itemCodeText}
            name={line.partName}
            revision={line.revision}
            imagePath={line.itemImagePath}
          />
        </div>
        <Fact label="Order Qty" value={String(line.orderQty)} big />
        <Fact label="Due Date" value={fmtDate(line.dueDate)} />
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>BOM Status</div>
          <div
            style={{
              fontWeight: 700,
              color:
                bomStatus === 'BOM Pending'
                  ? 'var(--amber)'
                  : bomStatus === 'BOM Planned'
                    ? 'var(--green)'
                    : 'var(--cyan)',
            }}
          >
            {bomStatus === 'BOM Pending'
              ? '⚠ BOM Pending'
              : bomStatus === 'BOM Planned'
                ? '✅ BOM Planned'
                : `📦 ${bomStatus}`}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canEdit ? (
            <Link
              to="/sales-orders/$id/edit"
              params={{ id: so.id }}
              className="btn btn-ghost btn-sm"
            >
              ✏ Edit
            </Link>
          ) : null}
          {so.bomMasterId ? (
            <Link
              to="/planning"
              search={{ soId: so.id }}
              className="btn btn-ghost btn-sm cyan fw-700"
            >
              📦 Plan BOM Items
            </Link>
          ) : (
            <span
              style={{ color: 'var(--amber2)', fontSize: 12, fontWeight: 600, alignSelf: 'center' }}
            >
              ⚠ No BOM linked — assign one in Edit.
            </span>
          )}
          {canDelete ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
      {so.bomMasterId ? <EquipmentBomItems soId={so.id} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        title={`Move SO ${so.code} to Trash?`}
        message="You can restore it from Trash."
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await softDelete.mutateAsync(so.id);
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}

function EquipmentBomItems({ soId }: { soId: string }): React.JSX.Element | null {
  const { data } = useSoStatus(soId);
  const items = data?.bomItems ?? [];
  if (items.length === 0) return null;
  return (
    <div style={{ padding: '4px 12px 8px 32px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--cyan)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        BOM Items — {data?.header.equipmentInfo?.bomNo ?? ''} ×{' '}
        {data?.header.equipmentInfo?.equipmentQty ?? 0} sets
      </div>
      {/* tbl-ctr — the table-alignment standard: data centred, headers untouched. */}
      <table className="innovic-table tbl-ctr" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Sr No</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="th-num">Qty / Set</th>
            <th className="th-num" style={{ color: 'var(--cyan)' }}>
              Total Need
            </th>
            <th>BOM Type</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Physical
            </th>
            <th className="th-num" style={{ color: 'var(--red2)' }}>
              Pending
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, idx) => {
            const typeLabel =
              c.bomType === 'manufacture' ? 'Make' : c.bomType === 'purchase' ? 'Buy' : 'Outsource';
            const typeColor =
              c.bomType === 'manufacture'
                ? 'var(--cyan)'
                : c.bomType === 'purchase'
                  ? 'var(--green)'
                  : 'var(--amber)';
            return (
              <tr
                key={c.childItemId}
                style={{
                  background: c.shortfall > 0 ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)',
                }}
              >
                <td className="td-ctr mono fw-700">{idx + 1}</td>
                <td className="td-code" style={{ color: 'var(--purple)' }}>
                  {c.childItemCode}
                </td>
                <td>{c.childItemName}</td>
                <td className="td-num mono fw-700">{c.qtyPerSet}</td>
                <td className="td-num mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>
                  {c.totalNeed}
                </td>
                <td>
                  <span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>
                    {typeLabel}
                  </span>
                </td>
                <td
                  className="td-num mono fw-700"
                  style={{ color: c.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                >
                  {c.stockQty}
                </td>
                <td
                  className="td-num mono fw-700"
                  style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}
                >
                  {c.shortfall}
                  {c.shortfall <= 0 ? ' ✅' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComponentSoExpand({
  so,
  canEdit,
}: {
  so: SalesOrderDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const update = useUpdateSalesOrder(so.id);
  // Line delete asks through ConfirmDialog, not window.confirm. Same update
  // call as before: re-send the surviving lines.
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const onDeleteLine = (lineId: string): void => setDeletingLineId(lineId);
  const deletingLine = so.lines.find((l) => l.id === deletingLineId) ?? null;
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      {/* Preview header. The row no longer navigates, so the preview carries its
          own way through to the full record — same route the SO code uses. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          Line Items
        </div>
        <Link
          to="/sales-orders/$id"
          params={{ id: so.id }}
          style={{ fontSize: 11, color: 'var(--blue)' }}
          onClick={(e) => e.stopPropagation()}
        >
          Open full detail →
        </Link>
      </div>
      {/* tbl-ctr — the table-alignment standard: data centred, headers untouched.
          Fixed column widths: each expanded order draws its own lines table, and
          auto-sized columns put the Item column — and its picture box — at a
          slightly different x per order. Fixed, the box lines up down the page. */}
      <table
        className="innovic-table tbl-ctr"
        style={{ width: '100%', margin: 0, tableLayout: 'fixed' }}
      >
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: THUMBNAIL_COL_WIDTH }} />
          <col style={{ width: canEdit ? '27%' : '33%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          {canEdit ? <col style={{ width: '6%' }} /> : null}
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            {/* Item = thumbnail · CODE/REV · part name in one badge cell (user
                decision 2026-09-21); the old Item Code + Part Name pair folded in. */}
            <th>Ln</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <ItemThumbnailHeader />
            <th style={{ textAlign: 'left' }}>Item</th>
            <th className="th-num">Order Qty</th>
            <th className="th-num">JC Qty</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Dispatched
            </th>
            <th className="th-num" style={{ color: 'var(--red2)' }}>
              Pending
            </th>
            <th>Due Date</th>
            <th>SO Status</th>
            {canEdit ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {so.lines.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 11 : 10} className="empty-state">
                No lines yet
              </td>
            </tr>
          ) : (
            so.lines.map((l) => {
              const balance = Math.max(0, l.orderQty - l.dispatchedQty);
              return (
                <tr key={l.id} style={{ background: 'var(--bg)' }}>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--blue)' }}>
                    {l.lineNo}
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}
                  >
                    {l.clientPoLineNo ?? '—'}
                  </td>
                  {/* CODE/REV — the customer's drawing revision travels with the code
                      (the badge formats it via itemCodeWithRev). */}
                  <ItemThumbnailCell imagePath={l.itemImagePath} alt={l.partName} />
                  <td>
                    <ItemBadge
                      size="row"
                      showImage={false}
                      code={l.itemCode ?? l.itemCodeText}
                      name={l.partName}
                      revision={l.revision}
                      imagePath={l.itemImagePath}
                    />
                  </td>
                  <td className="td-num mono fw-700" style={{ fontSize: 14 }}>
                    {l.orderQty}
                  </td>
                  <td className="td-num mono" style={{ fontSize: 11 }}>
                    <span
                      style={{
                        color:
                          l.jcQty >= l.orderQty
                            ? 'var(--green)'
                            : l.jcQty > 0
                              ? 'var(--amber)'
                              : 'var(--text3)',
                      }}
                    >
                      {l.jcQty}
                    </span>
                    <span className="text3" style={{ fontSize: 11 }}>
                      {' '}
                      /{l.orderQty}
                    </span>
                  </td>
                  <td
                    className="td-num mono fw-700"
                    style={{ color: l.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                  >
                    {l.dispatchedQty}
                  </td>
                  <td
                    className="td-num mono fw-700"
                    style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                  >
                    {balance <= 0 ? '✅ Dispatched' : balance}
                  </td>
                  <td className="text2" style={{ fontSize: 11 }}>
                    {fmtDate(l.dueDate)}
                  </td>
                  <td>
                    <SoStatusBadge status={l.status} />
                  </td>
                  {canEdit ? (
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Link
                          to="/sales-orders/$id/edit"
                          params={{ id: so.id }}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={update.isPending}
                          onClick={() => onDeleteLine(l.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <ConfirmDialog
        open={deletingLine !== null}
        title={`Delete line ${deletingLine?.lineNo ?? ''} of SO ${so.code}?`}
        message="The line is removed from this Sales Order."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onCancel={() => setDeletingLineId(null)}
        onConfirm={async () => {
          if (!deletingLineId) return;
          const surviving = so.lines.filter((l) => l.id !== deletingLineId).map(lineToInput);
          await update.mutateAsync({ header: {}, lines: surviving });
          setDeletingLineId(null);
        }}
      />
    </div>
  );
}

function Fact({
  label,
  value,
  color,
  big,
}: {
  label: string;
  value: string;
  color?: string | undefined;
  big?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontWeight: 700, color, fontSize: big ? 16 : undefined }}>{value}</div>
    </div>
  );
}
