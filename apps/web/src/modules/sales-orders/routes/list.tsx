// Sales Orders list (UI-003-05).

import {
  type ListSalesOrdersQuery,
  type SalesOrderListItem,
  SO_STATUSES,
  SO_TYPES,
  type SoStatus,
  type SoType,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSalesOrder, useSalesOrdersList } from '../api';
import { SoStatusBadge } from '../components/so-status-badge';

const PAGE_SIZE = 25;

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

  // PL-SOM-1b — row-expand mirrors legacy renderSOmaster L11878–11958.
  // Click the chevron to toggle expansion; expanded body fetches the SO detail
  // (lines + Equipment-BOM info) and renders an inline panel under the row.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string): void =>
    setExpandedId((prev) => (prev === id ? null : id));

  const columns = useMemo<ColumnDef<SalesOrderListItem>[]>(
    () => [
      {
        // Chevron for row-expand. Mirrors legacy L11860 (▶/▼ glyph).
        header: '',
        id: 'expand',
        cell: ({ row }) => {
          const isExpanded = expandedId === row.original.id;
          return (
            <button
              type="button"
              onClick={() => toggleExpand(row.original.id)}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text3)',
                padding: 2,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          );
        },
      },
      {
        header: 'SO No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/sales-orders/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'soDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.soDate}
          </span>
        ),
      },
      {
        header: 'Customer',
        cell: ({ row }) => <span className="fw-700">{row.original.customerName ?? '—'}</span>,
      },
      {
        // Legacy renderSOmaster L11866 — Client PO col with purple mono text.
        header: 'Client PO',
        cell: ({ row }) => (
          <span
            className="td-code mono"
            style={{ fontSize: 11, color: 'var(--purple)' }}
          >
            {row.original.clientPoNo ?? '—'}
          </span>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            {row.original.type.replaceAll('_', ' ')}
          </span>
        ),
      },
      {
        header: 'Lines',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.lineCount}</span>,
      },
      {
        header: 'Total Qty',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.totalQty}</span>,
      },
      {
        header: 'JC Qty',
        cell: ({ row }) => {
          const jc = row.original.jcQty;
          const total = row.original.totalQty;
          const color =
            jc >= total && total > 0 ? 'var(--green)' : jc > 0 ? 'var(--amber)' : 'var(--text3)';
          return (
            <span className="td-ctr mono" style={{ color, fontWeight: 700 }}>
              {jc}
              <span className="text3" style={{ fontSize: 10 }}>
                {' '}
                /{total}
              </span>
            </span>
          );
        },
      },
      {
        // Legacy renderSOmaster L11869 — Due Date col, red when overdue.
        header: 'Due',
        cell: ({ row }) => {
          const due = row.original.earliestDueDate;
          if (!due) return <span className="text3">—</span>;
          const today = new Date().toISOString().slice(0, 10);
          const overdue = due < today && row.original.status === 'open';
          return (
            <span
              className="text2"
              style={{
                fontSize: 11,
                color: overdue ? 'var(--red)' : undefined,
                fontWeight: overdue ? 700 : undefined,
              }}
            >
              {due}
              {overdue ? ' ⚠' : ''}
            </span>
          );
        },
      },
      {
        // Legacy renderSOmaster L11871 — Status + BOM-status secondary badge
        // for Equipment SOs (BOM Pending / Assigned / Planned).
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <SoStatusBadge status={row.original.status} />
            {row.original.type === 'equipment' && row.original.bomStatus ? (
              <span
                className={`badge ${
                  row.original.bomStatus === 'BOM Pending'
                    ? 'b-amber'
                    : row.original.bomStatus === 'BOM Planned'
                      ? 'b-green'
                      : 'b-blue'
                }`}
              >
                {row.original.bomStatus}
              </span>
            ) : null}
          </div>
        ),
      },
    ],
    [expandedId],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Sales Orders
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, customer, client PO…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as SoStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
            style={{ width: 180, fontSize: 12 }}
          >
            <option value="">All types</option>
            {SO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/sales-orders/new" className="btn btn-primary">
              <Plus size={14} /> New SO
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load sales orders'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No sales orders
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isExpanded = expandedId === row.original.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        style={{
                          background: isExpanded ? 'rgba(34,197,94,0.04)' : undefined,
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={columns.length} style={{ padding: 0, background: 'var(--bg3)' }}>
                            <SoExpandedPanel soId={row.original.id} soType={row.original.type} />
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No sales orders'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// PL-SOM-1b — inline expand panel under an SO row. Lazy-fetches detail via
// useSalesOrder. Renders Equipment-SO strip (legacy L11881–11927) or
// Component-SO line-items table (legacy L11929–11956).
function SoExpandedPanel({
  soId,
  soType,
}: {
  soId: string;
  soType: SoType;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useSalesOrder(soId);

  if (isLoading) {
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 size={12} className="inline animate-spin" /> Loading lines…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load SO detail'}
      </div>
    );
  }

  if (soType === 'equipment') {
    return <EquipmentSoExpand so={data} />;
  }
  return <ComponentSoExpand so={data} />;
}

function EquipmentSoExpand({
  so,
}: {
  so: { lines: Array<{ id: string; lineNo: number; partName: string; itemCodeText: string | null; orderQty: number; dueDate: string | null }>; bomStatus: string | null; bomMasterId: string | null };
}): React.JSX.Element {
  // Equipment SOs are 1-line per legacy convention. Take the first line.
  const line = so.lines[0];
  if (!line) {
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        No lines yet — add an item to this SO.
      </div>
    );
  }
  const bomStatus = so.bomStatus ?? 'BOM Pending';
  return (
    <div
      style={{
        padding: '10px 18px 12px 36px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 18,
        alignItems: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>EQUIPMENT</div>
        <div style={{ fontWeight: 700, color: 'var(--purple)' }}>
          {line.itemCodeText ?? '—'} {line.partName}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>EQUIP QTY</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{line.orderQty}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>DUE</div>
        <div style={{ fontWeight: 700 }}>{line.dueDate ?? '—'}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>BOM STATUS</div>
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
      {so.bomMasterId ? (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Link
            to="/planning"
            className="btn btn-sm"
            style={{
              background: 'rgba(34,211,238,0.08)',
              color: 'var(--cyan)',
              border: '1px solid rgba(34,211,238,0.3)',
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            📦 Plan BOM Items
          </Link>
          <Link
            to="/sales-orders/$id"
            params={{ id: so['id' as keyof typeof so] as unknown as string }}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
          >
            ✏ Edit
          </Link>
        </div>
      ) : (
        <div
          style={{
            marginLeft: 'auto',
            color: 'var(--amber)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ⚠ No BOM linked — assign one in Edit.
        </div>
      )}
    </div>
  );
}

function ComponentSoExpand({
  so,
}: {
  so: {
    id: string;
    code: string;
    lines: Array<{
      id: string;
      lineNo: number;
      itemCodeText: string | null;
      partName: string;
      orderQty: number;
      dueDate: string | null;
      clientPoLineNo: string | null;
      status: SoStatus;
    }>;
  };
}): React.JSX.Element {
  return (
    <div style={{ padding: '8px 12px 4px 36px' }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--cyan)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        ▸ LINE ITEMS — {so.code}
      </div>
      <table style={{ width: '100%', margin: 0 }} className="innovic-table">
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Ln</th>
            <th style={{ color: 'var(--purple)' }}>CPO Ln</th>
            <th>Item Code</th>
            <th>Part Name</th>
            <th className="td-ctr">Qty</th>
            <th>Due Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {so.lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-state">
                No lines yet
              </td>
            </tr>
          ) : (
            so.lines.map((l) => (
              <tr key={l.id} style={{ background: 'var(--bg)' }}>
                <td
                  className="td-ctr mono fw-700"
                  style={{ color: 'var(--cyan)' }}
                >
                  {l.lineNo}
                </td>
                <td
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}
                >
                  {l.clientPoLineNo ?? '—'}
                </td>
                <td className="td-code" style={{ color: 'var(--text2)' }}>
                  {l.itemCodeText ?? '—'}
                </td>
                <td>{l.partName}</td>
                <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                  {l.orderQty}
                </td>
                <td className="text2" style={{ fontSize: 11 }}>
                  {l.dueDate ?? '—'}
                </td>
                <td>
                  <SoStatusBadge status={l.status} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
