// Job cards list (UI-003-07) — read-only.

import {
  JC_COMPUTED_STATUSES,
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { useSession } from '@/lib/session';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCardsList } from '../api';
import { ExcelJcButton } from '../components/excel-jc-button';
import { JcRowWriteActions } from '../components/jc-row-write-actions';
import { JcStatusBadge } from '../components/jc-status-badge';
import { JcStatusModal } from '../components/jc-status-modal';
import { PrintJcButton } from '../components/print-jc-button';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(JC_COMPUTED_STATUSES).optional(),
  machineId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards',
  validateSearch: listSearchSchema,
  component: JobCardsListPage,
});

function JobCardsListPage(): React.JSX.Element {
  const search = jobCardsListRoute.useSearch();
  const navigate = jobCardsListRoute.useNavigate();

  // JC Status modal (legacy viewJCStatus opens over the list).
  const [statusJc, setStatusJc] = useState<{ id: string; code: string } | null>(null);
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListJobCardsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [
      search.search,
      search.status,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
      search.page,
    ],
  );

  const { data, isLoading, isFetching, isError, error } = useJobCardsList(query);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: operatorsData } = useOperatorsList({ limit: 200, offset: 0 });
  const machines = machinesData?.machines ?? [];
  const operators = operatorsData?.operators ?? [];
  const { data: me } = useSession();
  // Legacy gates "+ Plan & Create Job Card" on canEntry(); mirror with the
  // codebase's admin/manager write gate.
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  // Columns mirror legacy renderJobCards L5786 exactly (14 cols):
  // JC No. · Date · SO/WO · CPO Ln · Item Code · Item Name · Order Qty ·
  // Completed (bar) · Pending · Priority · Due Date · Ops Done · Status · Actions.
  const columns = useMemo<ColumnDef<JobCardListItem>[]>(
    () => [
      {
        header: 'JC No.',
        cell: ({ row }) => (
          <button
            type="button"
            className="td-code"
            onClick={() => setStatusJc({ id: row.original.id, code: row.original.code })}
            style={{
              color: 'var(--cyan)',
              textDecoration: 'underline dotted',
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
            title="View job card status"
          >
            {row.original.code}
          </button>
        ),
      },
      {
        header: 'Date',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.jcDate}
          </span>
        ),
      },
      {
        header: 'SO/WO',
        cell: ({ row }) => {
          const s = row.original.sourceLink;
          if (!s)
            return (
              <span className="text3" style={{ fontSize: 11 }}>
                —
              </span>
            );
          const to = s.type === 'so' ? '/sales-orders/$id' : '/job-work-orders/$id';
          const id = s.type === 'so' ? s.salesOrderId : s.jobWorkOrderId;
          return (
            <Link
              to={to}
              params={{ id }}
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--cyan)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {s.code}
              {s.lineNo !== 1 ? (
                <span style={{ fontSize: 9, color: 'var(--cyan)', marginLeft: 3 }}>
                  /{s.lineNo}
                </span>
              ) : null}
            </Link>
          );
        },
      },
      {
        header: 'CPO Ln',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
            {row.original.clientPoLineNo ?? '—'}
          </span>
        ),
      },
      {
        header: 'Item Code',
        cell: ({ row }) => (
          <span className="td-code" style={{ color: 'var(--purple)' }}>
            {row.original.itemCode}
          </span>
        ),
      },
      {
        header: 'Item Name',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.itemName || '—'}</span>,
      },
      {
        header: 'Order Qty',
        cell: ({ row }) => <span className="td-ctr mono fw-700">{row.original.orderQty}</span>,
      },
      {
        id: 'completed',
        header: () => <span style={{ color: 'var(--green)' }}>Completed</span>,
        cell: ({ row }) => {
          const done = row.original.lastOpCompletedQty;
          const pct =
            row.original.orderQty > 0
              ? Math.min(100, Math.round((done / row.original.orderQty) * 100))
              : 0;
          return (
            <div className="td-ctr">
              <span className="mono fw-700" style={{ color: 'var(--green)' }}>
                {done}
              </span>
              <div
                style={{
                  width: 52,
                  height: 4,
                  background: 'var(--bg5)',
                  borderRadius: 2,
                  margin: '3px auto 0',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--green)',
                    borderRadius: 2,
                  }}
                />
              </div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'center' }}>{pct}%</div>
            </div>
          );
        },
      },
      {
        id: 'pending',
        header: () => <span style={{ color: 'var(--red)' }}>Pending</span>,
        cell: ({ row }) => {
          const pending = Math.max(0, row.original.orderQty - row.original.lastOpCompletedQty);
          return (
            <span
              className="td-ctr mono fw-700"
              style={{ color: pending > 0 ? 'var(--red)' : 'var(--green)' }}
            >
              {pending}
            </span>
          );
        },
      },
      {
        header: 'Priority',
        cell: ({ row }) => {
          const high = row.original.priority === 'high';
          return (
            <span className={`badge ${high ? 'b-amber' : 'b-grey'}`}>
              {high ? 'High' : 'Normal'}
            </span>
          );
        },
      },
      {
        header: 'Due Date',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.dueDate ?? '—'}
          </span>
        ),
      },
      {
        header: 'Ops Done',
        cell: ({ row }) => (
          <span className="td-ctr text2">
            {row.original.doneOps}/{row.original.totalOps}
          </span>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <span style={{ whiteSpace: 'nowrap' }}>
            <JcStatusBadge status={row.original.computedStatus} />
            {row.original.runningCount > 0 ? (
              <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginLeft: 4 }}>
                ▶{row.original.runningCount}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          <span style={{ display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}>
            <button
              type="button"
              onClick={() => setStatusJc({ id: row.original.id, code: row.original.code })}
              className="btn btn-ghost btn-sm"
              style={{ whiteSpace: 'nowrap' }}
              title="View job card status"
            >
              👁 View
            </button>
            <PrintJcButton jc={row.original} />
            <ExcelJcButton jc={row.original} />
            <JcRowWriteActions jc={row.original} />
            <AssignTaskButton
              linkedRef={{
                type: 'job_card',
                id: row.original.id,
                display: `JC ${row.original.code}`,
                navPage: '/job-cards',
              }}
              suggestedTitle={`Follow up on JC ${row.original.code}`}
            />
          </span>
        ),
      },
    ],
    [setStatusJc],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  const setNav = (
    update: Partial<
      Pick<typeof search, 'status' | 'machineId' | 'operatorId' | 'fromDate' | 'toDate'>
    >,
  ): void => {
    void navigate({
      search: (prev) => ({ ...prev, ...update, page: 1 }),
      replace: true,
    });
  };

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
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Job Cards
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Production batches with computed status, ops progress, and source SO/JW link. Click a
            code to open in Op Entry.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <>
              <Link to="/planning" className="btn btn-ghost">
                + Plan &amp; Create Job Card
              </Link>
              <Link to="/job-cards/new" className="btn btn-primary">
                + New Job Card
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <input
              className="innovic-input"
              placeholder="Search code, item, customer, SO/JW…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 280, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as JcComputedStatus | '';
                setNav({ status: v === '' ? undefined : v });
              }}
              style={{ width: 180, fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {JC_COMPUTED_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            <select
              className="innovic-select"
              value={search.machineId ?? ''}
              onChange={(e) => setNav({ machineId: e.target.value || undefined })}
              style={{ fontSize: 12 }}
            >
              <option value="">All machines</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              value={search.operatorId ?? ''}
              onChange={(e) => setNav({ operatorId: e.target.value || undefined })}
              style={{ fontSize: 12 }}
            >
              <option value="">All operators</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} — {o.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="innovic-input"
              value={search.fromDate ?? ''}
              onChange={(e) => setNav({ fromDate: e.target.value || undefined })}
              placeholder="From date"
              style={{ fontSize: 12 }}
            />
            <input
              type="date"
              className="innovic-input"
              value={search.toDate ?? ''}
              onChange={(e) => setNav({ toDate: e.target.value || undefined })}
              placeholder="To date"
              style={{ fontSize: 12 }}
            />
          </div>
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
                    Loading job cards…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load job cards'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No job cards match these filters.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
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
            ? 'No job cards'
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
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px', color: 'var(--text)' }}>
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

      {statusJc ? (
        <JcStatusModal id={statusJc.id} code={statusJc.code} onClose={() => setStatusJc(null)} />
      ) : null}
    </div>
  );
}
