// JW Master list — ONE ROW PER JWSO (#6, matches the SO Master list). Columns,
// in legacy renderJWMaster thead order (L12685, with Line → Lines per the
// grouped SO Master L11863):
// JWSO NO. · LINES · DATE · CLIENT · CLIENT PO · TOTAL QTY · JC QTY · MATERIAL ·
// DUE · STATUS · REMARKS · (Edit Del). Material is colored text (✓ Full / ◑
// Partial / ✕ Not Received) keyed on header materialReceivedQty vs the header
// clientMaterialQty (expected client-supplied material).
//
// NOT ported from legacy L12656 — the Client PO 📎 attachment link: JW carries no
// clientPoFilePath (SO does; packages/shared/src/schemas/sales-order.ts:136), so
// the link would need a DB column + upload route. Not faked here (ISSUE-031).

import {
  type JobWorkOrderDetail,
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
  SO_STATUSES,
  type SoStatus,
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
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { useSession } from '@/lib/session';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrder, useJobWorkOrdersList, useSoftDeleteJobWorkOrder } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobWorkOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders',
  validateSearch: listSearchSchema,
  component: JobWorkOrdersListPage,
});

// Material status as colored text: header received vs expected client material.
function MaterialCell({ received, expected }: { received: number; expected: number }): React.JSX.Element {
  if (expected > 0 && received >= expected) {
    return <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Full</span>;
  }
  if (received > 0) {
    return <span style={{ color: 'var(--amber)', fontWeight: 700 }}>◑ Partial ({received})</span>;
  }
  return <span style={{ color: 'var(--red)', fontWeight: 700 }}>✕ Not Received</span>;
}

function JobWorkOrdersListPage(): React.JSX.Element {
  const search = jobWorkOrdersListRoute.useSearch();
  const navigate = jobWorkOrdersListRoute.useNavigate();
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

  const query: ListJobWorkOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useJobWorkOrdersList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const deleteMut = useSoftDeleteJobWorkOrder();
  const today = new Date().toISOString().slice(0, 10);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string): void => setExpandedId((prev) => (prev === id ? null : id));

  const onDelete = (jwId: string, code: string): void => {
    if (confirm(`Move JW ${code} to Trash?`)) deleteMut.mutate(jwId);
  };

  // Column order mirrors legacy renderJWMaster thead L12685:
  //   JW No. | Line | Date | Client | Client PO | Item Code | Part Name | Qty |
  //   JC Qty | Material | Due | Status | Remarks | (actions)
  // Item Code / Part Name are line-level here (header+lines model, ADR-012) and
  // live in the expand panel — exactly as legacy renderSOmaster L11858 drops
  // them from its grouped header row. Legacy JW's per-record "Line" number
  // becomes the "Lines" count, rendered as legacy SO Master does (L11863).
  // Cell classes ride on meta.tdClass so they land on the <td> like legacy;
  // flexRender only renders inner content, so a td-ctr on a <span> is inert
  // (ISSUE-020).
  const columns = useMemo<ColumnDef<JobWorkOrderListItem>[]>(
    () => [
      {
        // Legacy has no separate expander column — the ▶/▼ marker sits inside
        // the No. cell (renderSOmaster L11860). Kept as a button because the
        // React chevron is what toggles expand (the row itself opens the JWSO).
        header: 'JWSO No.',
        accessorKey: 'code',
        meta: { tdClass: 'td-code cyan' },
        cell: ({ row }) => {
          const isExpanded = expandedId === row.original.jwId;
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleExpand(row.original.jwId); }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0, width: 16, display: 'inline-flex', alignItems: 'center' }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Link to="/job-work-orders/$id" params={{ id: row.original.jwId }} style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
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
      { header: 'Date', accessorKey: 'jwDate', meta: { tdClass: 'text2' }, cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.jwDate}</span> },
      { header: 'Client', accessorKey: 'customerName', meta: { tdClass: 'fw-700' }, cell: ({ row }) => row.original.customerName ?? '—' },
      { header: 'Client PO', accessorKey: 'clientPoNo', meta: { tdClass: 'td-code mono' }, cell: ({ row }) => <span style={{ fontSize: 11, color: 'var(--purple)' }}>{row.original.clientPoNo ?? '—'}</span> },
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
          const tot = row.original.totalQty;
          const color = jc >= tot && tot > 0 ? 'var(--green)' : jc > 0 ? 'var(--amber)' : 'var(--text3)';
          return (
            <span style={{ fontSize: 11 }}>
              <span style={{ color }}>{jc}</span>
              <span className="text3" style={{ fontSize: 10 }}> /{tot}</span>
            </span>
          );
        },
      },
      {
        header: 'Material',
        id: 'material',
        accessorFn: (r) => Number(r.materialReceivedQty ?? 0),
        meta: { tdClass: 'td-ctr' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            <MaterialCell received={Number(row.original.materialReceivedQty ?? 0)} expected={Number(row.original.clientMaterialQty ?? 0)} />
          </span>
        ),
      },
      {
        header: 'Due',
        accessorKey: 'earliestDueDate',
        meta: { tdClass: 'text2 td-ctr' },
        cell: ({ row }) => {
          const due = row.original.earliestDueDate;
          const overdue = !!due && due < today && row.original.status === 'open';
          return <span style={{ fontSize: 11, color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 700 : undefined }}>{due ?? '—'}</span>;
        },
      },
      { header: 'Status', accessorKey: 'status', cell: ({ row }) => <SoStatusBadge status={row.original.status} /> },
      {
        header: 'Remarks',
        accessorKey: 'remarks',
        meta: { tdClass: 'text3' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11, maxWidth: 110, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.original.remarks ?? ''}>
            {row.original.remarks ?? ''}
          </span>
        ),
      },
      ...(canWrite
        ? [{
            header: '',
            id: 'actions',
            enableSorting: false,
            cell: ({ row }: { row: { original: JobWorkOrderListItem } }) => (
              <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <Link to="/job-work-orders/$id/edit" params={{ id: row.original.jwId }} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</Link>
                <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 11 }} disabled={deleteMut.isPending} onClick={() => onDelete(row.original.jwId, row.original.code)}>Del</button>
              </div>
            ),
          } as ColumnDef<JobWorkOrderListItem>]
        : []),
    ],
    [expandedId, canWrite, today],
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
        <div className="section-hdr" style={{ marginBottom: 0 }}>JWSO Master — Job Work Sales Order (Material from Client)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="innovic-input" placeholder="Search JWSO, client, item…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 220, fontSize: 12 }} />
          <select className="innovic-select" value={search.status ?? ''} onChange={(e) => { const v = e.target.value as SoStatus | ''; void navigate({ search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }), replace: true }); }} style={{ width: 130, fontSize: 12 }}>
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {isFetching && !isLoading ? <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}><Loader2 className="inline h-3 w-3 animate-spin" /> Updating…</span> : null}
          {canWrite ? <Link to="/job-work-orders/new" className="btn btn-primary">+ New JWSO Order</Link> : null}
        </div>
      </div>

      <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
        <b style={{ color: 'var(--green)' }}>📌 Job Work:</b> Client provides raw material → We machine/process it → Deliver finished parts back to client. Track client material receipt here.
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <SortableHead table={table} />
            <tbody>
              {isLoading ? (
                <tr><td colSpan={columns.length} className="empty-state"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load job work orders'}</td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="empty-state">No Job Work Sales Orders — click + New JWSO Order</td></tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isExpanded = expandedId === row.original.jwId;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => void navigate({ to: '/job-work-orders/$id', params: { id: row.original.jwId } })}
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
                            <JwExpandedPanel jwId={row.original.jwId} canWrite={canWrite} />
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
        <span>{total === 0 ? 'No JWSOs' : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage <= 1} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }), replace: true })}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>Page {currentPage} / {totalPages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage >= totalPages} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }), replace: true })}>Next <ChevronRight size={14} /></button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the JWSO. Click the chevron to expand its line items inline.
      </div>
    </div>
  );
}

// Inline line-item panel for one JWSO — mirrors the SO Master expand. Loads the
// JWSO detail (header + lines) and lists each line's item / part / material /
// qty / rate / due / status.
function JwExpandedPanel({ jwId, canWrite }: { jwId: string; canWrite: boolean }): React.JSX.Element {
  const { data, isLoading, isError, error } = useJobWorkOrder(jwId);
  if (isLoading) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}><Loader2 size={12} className="inline animate-spin" /> Loading lines…</div>;
  if (isError || !data) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load JWSO detail'}</div>;
  return <JwLinesTable jw={data} canWrite={canWrite} />;
}

function JwLinesTable({ jw, canWrite }: { jw: JobWorkOrderDetail; canWrite: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>▸ LINE ITEMS — {jw.code}</div>
      <table className="innovic-table" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Ln</th><th>Item Code</th><th>Part Name</th><th>Material</th><th>Drawing No</th>
            <th className="td-ctr">Qty</th><th>UOM</th><th className="td-ctr">Rate</th><th>Due Date</th><th>Status</th>
            {canWrite ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {jw.lines.length === 0 ? (
            <tr><td colSpan={canWrite ? 11 : 10} className="empty-state">No lines yet</td></tr>
          ) : (
            jw.lines.map((l) => (
              <tr key={l.id} style={{ background: 'var(--bg)' }}>
                <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{l.lineNo}</td>
                <td className="td-code" style={{ color: 'var(--text2)' }}>{l.itemCodeText ?? '—'}</td>
                <td>{l.partName}</td>
                <td className="text2" style={{ fontSize: 11 }}>{l.material ?? '—'}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>{l.drawingNo ?? '—'}</td>
                <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>{l.orderQty}</td>
                <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>{l.uom}</td>
                <td className="td-ctr mono" style={{ fontSize: 11 }}>{l.rate}</td>
                <td className="text2" style={{ fontSize: 11 }}>{l.dueDate ?? '—'}</td>
                <td><SoStatusBadge status={l.status} /></td>
                {canWrite ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to="/job-work-orders/$id/edit" params={{ id: jw.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>Edit</Link>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
