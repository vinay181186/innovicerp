// JW Master list — 1:1 with legacy renderJWMaster (L12642). ONE ROW PER LINE,
// columns in legacy order: JW NO. · LINE · DATE · CLIENT · CLIENT PO · ITEM
// CODE · PART NAME · QTY · JC QTY · MATERIAL · DUE · STATUS · REMARKS · (Edit
// Del). Material is colored text (✓ Full / ◑ Partial / ✕ Not Received) keyed on
// header materialReceivedQty vs line orderQty (legacy L12648).

import {
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
  SO_STATUSES,
  type SoStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrdersList, useSoftDeleteJobWorkOrder } from '../api';

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

// Material status as legacy colored text (L12648-12650): received vs line qty.
function MaterialCell({ received, orderQty }: { received: number; orderQty: number }): React.JSX.Element {
  if (orderQty > 0 && received >= orderQty) {
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

  const onDelete = (jwId: string, code: string): void => {
    if (confirm(`Move JW ${code} to Trash?`)) deleteMut.mutate(jwId);
  };

  const columns = useMemo<ColumnDef<JobWorkOrderListItem>[]>(
    () => [
      {
        header: 'JWSO No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link to="/job-work-orders/$id" params={{ id: row.original.jwId }} className="td-code cyan" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
            {row.original.code}
          </Link>
        ),
      },
      { header: 'Line', cell: ({ row }) => <span className="td-ctr mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{row.original.lineNo}</span> },
      { header: 'Date', cell: ({ row }) => <span className="text2" style={{ fontSize: 11 }}>{row.original.jwDate}</span> },
      { header: 'Client', cell: ({ row }) => <span className="fw-700">{row.original.customerName ?? '—'}</span> },
      { header: 'Client PO', cell: ({ row }) => <span className="td-code mono" style={{ fontSize: 11, color: 'var(--purple)' }}>{row.original.clientPoNo ?? '—'}</span> },
      { header: 'Item Code', cell: ({ row }) => <span className="td-code" style={{ color: 'var(--text2)' }}>{row.original.itemCode ?? '—'}</span> },
      { header: 'Part Name', cell: ({ row }) => row.original.partName },
      { header: 'Qty', cell: ({ row }) => <span className="td-ctr mono fw-700">{row.original.orderQty}</span> },
      {
        header: 'JC Qty',
        cell: ({ row }) => {
          const jc = row.original.jcQty;
          const tot = row.original.orderQty;
          const color = jc >= tot && tot > 0 ? 'var(--green)' : jc > 0 ? 'var(--amber)' : 'var(--text3)';
          return (
            <span className="td-ctr mono" style={{ fontSize: 11 }}>
              <span style={{ color }}>{jc}</span>
              <span className="text3" style={{ fontSize: 10 }}> /{tot}</span>
            </span>
          );
        },
      },
      {
        header: 'Material',
        cell: ({ row }) => (
          <span className="td-ctr" style={{ fontSize: 11 }}>
            <MaterialCell received={Number(row.original.materialReceivedQty ?? 0)} orderQty={row.original.orderQty} />
          </span>
        ),
      },
      {
        header: 'Due',
        cell: ({ row }) => {
          const due = row.original.dueDate;
          const overdue = !!due && due < today && row.original.status === 'open';
          return <span className="text2 td-ctr" style={{ fontSize: 11, color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 700 : undefined }}>{due ?? '—'}</span>;
        },
      },
      { header: 'Status', accessorKey: 'status', cell: ({ row }) => <SoStatusBadge status={row.original.status} /> },
      {
        header: 'Remarks',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11, maxWidth: 110, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.original.remarks ?? ''}>
            {row.original.remarks ?? ''}
          </span>
        ),
      },
      ...(canWrite
        ? [{
            header: '',
            id: 'actions',
            cell: ({ row }: { row: { original: JobWorkOrderListItem } }) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Link to="/job-work-orders/$id/edit" params={{ id: row.original.jwId }} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</Link>
                <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 11 }} disabled={deleteMut.isPending} onClick={() => onDelete(row.original.jwId, row.original.code)}>Del</button>
              </div>
            ),
          } as ColumnDef<JobWorkOrderListItem>]
        : []),
    ],
    [canWrite, today],
  );

  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel() });
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
        📌 <b style={{ color: 'var(--green)' }}>Job Work:</b> Client provides raw material → we machine/process it → deliver finished parts back to client. Track client material receipt here.
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={columns.length} className="empty-state"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</td></tr>
              ) : isError ? (
                <tr><td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load job work orders'}</td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="empty-state">No Job Work Sales Orders — click + New JWSO Order</td></tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        <span>{total === 0 ? 'No lines' : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage <= 1} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }), replace: true })}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>Page {currentPage} / {totalPages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage >= totalPages} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }), replace: true })}>Next <ChevronRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}
