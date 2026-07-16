// SO / WO Master (UI-003-05 + legacy renderSOmaster L11839 parity). Grouped,
// expandable rows; per-row +Line / Del; expanded component lines show JC Qty /
// Dispatched / Balance with inline Edit + Del; expanded equipment shows the
// BOM-status strip + exploded BOM items table. Header has Excel Export.

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
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { useSession } from '@/lib/session';
import { soDocSignedUrl } from '@/modules/so-documents/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoStatus } from '../../so-status/api';
import {
  fetchSalesOrdersForExport,
  useSalesOrder,
  useSalesOrdersList,
  useSoftDeleteSalesOrder,
  useUpdateSalesOrder,
} from '../api';
import { SoStatusBadge } from '../components/so-status-badge';
import { exportSoListExcel } from '../lib/import-export';

// ISSUE-020 — legacy puts its cell classes on the <td> itself (e.g. L11867
// `<td class="td-ctr mono fw-700">`), not on a wrapper span. td-ctr is
// text-align:center, which does nothing on an inline <span>, and
// `.innovic-table td` sets no text-align of its own — so those columns rendered
// left-aligned where legacy centres them. Carry the class through the column def
// so the flexRender loop puts it where legacy has it. Mirrors the augmentation
// in items/routes/list.tsx.
const PAGE_SIZE = 25;

/** Open a stored client-PO document via a short-lived signed URL (ISSUE-013). */
async function openClientPoFile(storagePath: string): Promise<void> {
  try {
    const url = await soDocSignedUrl(storagePath);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Could not open file');
  }
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
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
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
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.type, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useSalesOrdersList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string): void => setExpandedId((prev) => (prev === id ? null : id));

  const softDelete = useSoftDeleteSalesOrder();
  const onDeleteSo = (so: SalesOrderListItem): void => {
    if (confirm(`Delete SO ${so.code}? This soft-deletes the whole order.`)) softDelete.mutate(so.id);
  };

  // Export status/error banner (import UI removed — bulk-add lives on the SO form).
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Export the whole filtered list to Excel — pulls every matching row (not just
  // the visible page) using the current search/type/status filter.
  const [exporting, setExporting] = useState(false);
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
      setImportMsg(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // Column order mirrors legacy renderSOmaster thead L11971:
  //   SO/WO No. | Lines | Date | Client | Client PO | Total Qty | JC Qty | Due |
  //   Type | Status | Remarks | (actions)
  // "Raised By" has no legacy counterpart and is kept (see report) next to Client.
  const columns = useMemo<ColumnDef<SalesOrderListItem>[]>(
    () => [
      {
        // Legacy has no separate expander column — the ▶/▼ marker sits inside the
        // SO No. cell (L11860). Kept as a button because, unlike legacy (where the
        // whole row calls _editFullSO), the React chevron is what toggles expand.
        header: 'SO/WO No.',
        accessorKey: 'code',
        meta: { tdClass: 'td-code cyan' },
        cell: ({ row }) => {
          const isExpanded = expandedId === row.original.id;
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 800 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleExpand(row.original.id); }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0, width: 16, display: 'inline-flex', alignItems: 'center' }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Link to="/sales-orders/$id" params={{ id: row.original.id }} style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
                {row.original.code}
              </Link>
            </span>
          );
        },
      },
      {
        header: 'Lines',
        accessorKey: 'lineCount',
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11, color: 'var(--cyan)' }}>
            {row.original.lineCount} line{row.original.lineCount > 1 ? 's' : ''}
          </span>
        ),
      },
      { header: 'Date', accessorKey: 'soDate', cell: ({ row }) => <span className="text2" style={{ fontSize: 11 }}>{row.original.soDate}</span> },
      { header: 'Client', accessorKey: 'customerName', cell: ({ row }) => <span className="fw-700">{row.original.customerName ?? '—'}</span> },
      { header: 'Raised By', accessorKey: 'createdByName', cell: ({ row }) => <span className="text2" style={{ fontSize: 11 }}>{row.original.createdByName ?? '—'}</span> },
      {
        header: 'Client PO',
        accessorKey: 'clientPoNo',
        meta: { tdClass: 'td-code mono' },
        cell: ({ row }) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--purple)' }}>{row.original.clientPoNo ?? '—'}</span>
            {row.original.clientPoFilePath ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 4px', fontSize: 12 }}
                title="View Client PO Document"
                onClick={(e) => { e.stopPropagation(); void openClientPoFile(row.original.clientPoFilePath!); }}
              >
                📎
              </button>
            ) : null}
          </span>
        ),
      },
      {
        header: 'Total Qty',
        accessorKey: 'totalQty',
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => row.original.totalQty,
      },
      {
        header: 'JC Qty',
        accessorKey: 'jcQty',
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => {
          const jc = row.original.jcQty;
          const total = row.original.totalQty;
          const color = jc >= total && total > 0 ? 'var(--green)' : jc > 0 ? 'var(--amber)' : 'var(--text3)';
          return (
            <span style={{ fontSize: 11 }}>
              <span style={{ color }}>{jc}</span>
              <span className="text3" style={{ fontSize: 10 }}> /{total}</span>
            </span>
          );
        },
      },
      {
        header: 'Due',
        accessorKey: 'earliestDueDate',
        meta: { tdClass: 'text2 td-ctr' },
        cell: ({ row }) => {
          const due = row.original.earliestDueDate;
          if (!due) return <span className="text3">—</span>;
          const today = new Date().toISOString().slice(0, 10);
          const overdue = due < today && row.original.status === 'open';
          return <span style={{ fontSize: 11, color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 700 : undefined }}>{due}{overdue ? ' ⚠' : ''}</span>;
        },
      },
      {
        header: 'Type',
        accessorKey: 'type',
        // Legacy renders the type through badge() (L11870), which has no map entry
        // for either SO type and so falls through to b-grey.
        cell: ({ row }) => <span className="badge b-grey">{row.original.type.replaceAll('_', ' ')}</span>,
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <SoStatusBadge status={row.original.status} />
            {row.original.type === 'equipment' && row.original.bomStatus ? (
              <span className={`badge ${row.original.bomStatus === 'BOM Pending' ? 'b-amber' : row.original.bomStatus === 'BOM Planned' ? 'b-green' : 'b-blue'}`}>{row.original.bomStatus}</span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'Remarks',
        accessorKey: 'remarks',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11, maxWidth: 80, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.original.remarks ?? ''}>
            {row.original.remarks ?? ''}
          </span>
        ),
      },
      ...(canWrite
        ? [{
            header: '',
            id: 'actions',
            enableSorting: false,
            cell: ({ row }: { row: { original: SalesOrderListItem } }) => (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                <Link to="/sales-orders/$id/edit" params={{ id: row.original.id }} className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '3px 8px' }} title="Add line to this SO">
                  + Line
                </Link>
                {row.original.status !== 'closed' ? (
                  <AssignTaskButton
                    linkedRef={{
                      type: 'sales_order',
                      id: row.original.id,
                      display: `SO ${row.original.code}`,
                      navPage: `/sales-orders/${row.original.id}`,
                    }}
                    suggestedTitle={
                      row.original.type === 'equipment' && row.original.bomStatus === 'BOM Pending'
                        ? `Create BOM for ${row.original.code}`
                        : `Follow up ${row.original.code}`
                    }
                    label=""
                  />
                ) : null}
                {row.original.status !== 'closed' ? (
                  <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => onDeleteSo(row.original)}>
                    Del
                  </button>
                ) : null}
              </div>
            ),
          } as ColumnDef<SalesOrderListItem>]
        : []),
    ],
    [expandedId, canWrite],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>SO / WO Master</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input className="innovic-input" placeholder="Search code, customer, client PO…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 220, fontSize: 12 }} />
          <select className="innovic-select" value={search.status ?? ''} onChange={(e) => { const v = e.target.value as SoStatus | ''; void navigate({ search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }), replace: true }); }} style={{ width: 130, fontSize: 12 }}>
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="innovic-select" value={search.type ?? ''} onChange={(e) => { const v = e.target.value as SoType | ''; void navigate({ search: (prev) => ({ ...prev, type: v === '' ? undefined : v, page: 1 }), replace: true }); }} style={{ width: 160, fontSize: 12 }}>
            <option value="">All types</option>
            {SELECTABLE_SO_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} disabled={exporting} title="Export the current (filtered) list to Excel" onClick={() => void onExport()}>
            {exporting ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <Download className="inline h-3 w-3" />} Export
          </button>
          {isFetching && !isLoading ? <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}><Loader2 className="inline h-3 w-3 animate-spin" /> Updating…</span> : null}
          {canWrite ? (
            <Link to="/sales-orders/new" className="btn btn-primary">+ New SO / WO</Link>
          ) : null}
        </div>
      </div>

      {importMsg ? (
        <div className="panel" style={{ marginBottom: 10, padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>
          {importMsg}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8, fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button>
        </div>
      ) : null}

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <SortableHead table={table} />
            <tbody>
              {isLoading ? (
                <tr><td colSpan={columns.length} className="empty-state"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load sales orders'}</td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="empty-state">No orders — click + New SO/WO</td></tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isExpanded = expandedId === row.original.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => void navigate({ to: '/sales-orders/$id', params: { id: row.original.id } })}
                        style={{ cursor: 'pointer', background: isExpanded ? 'rgba(34,197,94,0.04)' : undefined }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className={cell.column.columnDef.meta?.tdClass}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={columns.length} style={{ padding: 0, background: 'var(--bg3)' }}>
                            <SoExpandedPanel soId={row.original.id} soType={row.original.type} canWrite={canWrite} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        <span>{total === 0 ? 'No sales orders' : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage <= 1} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }), replace: true })}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>Page {currentPage} / {totalPages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage >= totalPages} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }), replace: true })}>Next <ChevronRight size={14} /></button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the SO. Click the chevron to expand line items inline. Use <b>+ Line</b> to add or edit lines.
      </div>
    </div>
  );
}

function SoExpandedPanel({ soId, soType, canWrite }: { soId: string; soType: SoType; canWrite: boolean }): React.JSX.Element {
  const { data, isLoading, isError, error } = useSalesOrder(soId);
  if (isLoading) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}><Loader2 size={12} className="inline animate-spin" /> Loading lines…</div>;
  if (isError || !data) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load SO detail'}</div>;
  return soType === 'equipment' ? <EquipmentSoExpand so={data} canWrite={canWrite} /> : <ComponentSoExpand so={data} canWrite={canWrite} />;
}

function EquipmentSoExpand({ so, canWrite }: { so: SalesOrderDetail; canWrite: boolean }): React.JSX.Element {
  const softDelete = useSoftDeleteSalesOrder();
  const line = so.lines[0];
  if (!line) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>No lines yet — add an item to this SO.</div>;
  const bomStatus = so.bomStatus ?? 'BOM Pending';
  return (
    <div>
      <div style={{ padding: '10px 18px 8px 36px', display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
        <Fact label="EQUIPMENT" value={`${line.itemCodeText ?? line.itemCode ?? '—'} ${line.partName}`} color="var(--purple)" />
        <Fact label="EQUIP QTY" value={String(line.orderQty)} big />
        <Fact label="DUE" value={line.dueDate ?? '—'} />
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>BOM STATUS</div>
          <div style={{ fontWeight: 700, color: bomStatus === 'BOM Pending' ? 'var(--amber)' : bomStatus === 'BOM Planned' ? 'var(--green)' : 'var(--cyan)' }}>
            {bomStatus === 'BOM Pending' ? '⚠ BOM Pending' : bomStatus === 'BOM Planned' ? '✅ BOM Planned' : `📦 ${bomStatus}`}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canWrite ? <Link to="/sales-orders/$id/edit" params={{ id: so.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>✏ Edit</Link> : null}
          {so.bomMasterId ? (
            <Link to="/planning" className="btn btn-sm" style={{ background: 'rgba(34,211,238,0.08)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', fontWeight: 700, fontSize: 11 }}>📦 Plan BOM Items</Link>
          ) : (
            <span style={{ color: 'var(--amber)', fontSize: 12, fontWeight: 600, alignSelf: 'center' }}>⚠ No BOM linked — assign one in Edit.</span>
          )}
          {canWrite ? <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 11 }} onClick={() => { if (confirm(`Delete SO ${so.code}?`)) softDelete.mutate(so.id); }}>Del</button> : null}
        </div>
      </div>
      {so.bomMasterId ? <EquipmentBomItems soId={so.id} /> : <div style={{ padding: '4px 32px 12px', color: 'var(--amber)', fontSize: 12, fontWeight: 600 }}>⚠ No BOM linked. Edit this SO to assign a BOM from BOM Master.</div>}
    </div>
  );
}

function EquipmentBomItems({ soId }: { soId: string }): React.JSX.Element | null {
  const { data } = useSoStatus(soId);
  const items = data?.bomItems ?? [];
  if (items.length === 0) return null;
  return (
    <div style={{ padding: '4px 12px 8px 32px' }}>
      <div style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, marginBottom: 4 }}>
        ▸ BOM ITEMS — {data?.header.equipmentInfo?.bomNo ?? ''} × {data?.header.equipmentInfo?.equipmentQty ?? 0} sets
      </div>
      <table className="innovic-table" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>#</th><th>Item Code</th><th>Item Name</th><th className="td-ctr">Qty/Set</th>
            <th className="td-ctr" style={{ color: 'var(--cyan)' }}>Total Need</th><th>Type</th>
            <th className="td-ctr" style={{ color: 'var(--green)' }}>Stock</th><th className="td-ctr" style={{ color: 'var(--red)' }}>Shortfall</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, idx) => {
            const typeLabel = c.bomType === 'manufacture' ? '🏭 Mfg' : c.bomType === 'purchase' ? '🛒 Buy' : '🏭 Outsrc';
            const typeColor = c.bomType === 'manufacture' ? 'var(--cyan)' : c.bomType === 'purchase' ? 'var(--green)' : 'var(--amber)';
            return (
              <tr key={c.childItemId} style={{ background: c.shortfall > 0 ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)' }}>
                <td className="td-ctr mono fw-700">{idx + 1}</td>
                <td className="td-code" style={{ color: 'var(--purple)' }}>{c.childItemCode}</td>
                <td>{c.childItemName}</td>
                <td className="td-ctr mono fw-700">{c.qtyPerSet}</td>
                <td className="td-ctr mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>{c.totalNeed}</td>
                <td><span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>{typeLabel}</span></td>
                <td className="td-ctr mono fw-700" style={{ color: c.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}>{c.stockQty}</td>
                <td className="td-ctr mono fw-700" style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}>{c.shortfall}{c.shortfall <= 0 ? ' ✅' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComponentSoExpand({ so, canWrite }: { so: SalesOrderDetail; canWrite: boolean }): React.JSX.Element {
  const update = useUpdateSalesOrder(so.id);
  const onDeleteLine = (lineId: string): void => {
    if (!confirm('Delete this line?')) return;
    const surviving = so.lines.filter((l) => l.id !== lineId).map(lineToInput);
    update.mutate({ header: {}, lines: surviving });
  };
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>▸ LINE ITEMS — {so.code}</div>
      <table className="innovic-table" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Ln</th><th style={{ color: 'var(--purple)' }}>CPO Ln</th><th>Item Code</th><th>Part Name</th>
            <th className="td-ctr">Qty</th><th className="td-ctr">JC Qty</th>
            <th className="td-ctr" style={{ color: 'var(--green)' }}>Dispatched</th>
            <th className="td-ctr" style={{ color: 'var(--red)' }}>Balance</th>
            <th>Due Date</th><th>Status</th>{canWrite ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {so.lines.length === 0 ? (
            <tr><td colSpan={canWrite ? 11 : 10} className="empty-state">No lines yet</td></tr>
          ) : (
            so.lines.map((l) => {
              const balance = Math.max(0, l.orderQty - l.dispatchedQty);
              return (
                <tr key={l.id} style={{ background: 'var(--bg)' }}>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{l.lineNo}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>{l.clientPoLineNo ?? '—'}</td>
                  <td className="td-code" style={{ color: 'var(--text2)' }}>{l.itemCode ?? l.itemCodeText ?? '—'}</td>
                  <td>{l.partName}</td>
                  <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>{l.orderQty}</td>
                  <td className="td-ctr mono" style={{ fontSize: 11 }}>
                    <span style={{ color: l.jcQty >= l.orderQty ? 'var(--green)' : l.jcQty > 0 ? 'var(--amber)' : 'var(--text3)' }}>{l.jcQty}</span>
                    <span className="text3" style={{ fontSize: 10 }}> /{l.orderQty}</span>
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: l.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}>{l.dispatchedQty}</td>
                  <td className="td-ctr mono fw-700" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>{balance <= 0 ? '✅ Done' : balance}</td>
                  <td className="text2" style={{ fontSize: 11 }}>{l.dueDate ?? '—'}</td>
                  <td><SoStatusBadge status={l.status} /></td>
                  {canWrite ? (
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Link to="/sales-orders/$id/edit" params={{ id: so.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>Edit</Link>
                        <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 10 }} disabled={update.isPending} onClick={() => onDeleteLine(l.id)}>Del</button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value, color, big }: { label: string; value: string; color?: string | undefined; big?: boolean | undefined }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontWeight: 700, color, fontSize: big ? 16 : undefined }}>{value}</div>
    </div>
  );
}
