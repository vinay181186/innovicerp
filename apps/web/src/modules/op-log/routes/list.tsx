// Op Log viewer — mirror of legacy renderOpLog (HTML L13194).
//
// Paginated, filterable, read-only. Filters: JC, log type, shift, date range.
// Columns mirror legacy: Log No, JC, Date, Op, Shift, Machine, Operation,
// Qty, Reject, Operator, Remarks. TPI rows tagged. No delete (see service.ts
// note — legacy `delLog` violates CLAUDE.md Rule #8).

import { createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useOpLog, type ListOpLogQuery } from '../api';

const PAGE_SIZE = 50;

const listSearchSchema = z.object({
  jcNo: z.string().optional(),
  logType: z.enum(['start', 'complete', 'qc']).optional(),
  shift: z.enum(['day', 'night', 'general']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const opLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-log',
  validateSearch: listSearchSchema,
  component: OpLogListPage,
});

function logTypeBadge(t: 'start' | 'complete' | 'qc'): string {
  if (t === 'start') return 'b-amber';
  if (t === 'qc') return 'b-purple';
  return 'b-green';
}

function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function OpLogListPage(): React.JSX.Element {
  const search = opLogListRoute.useSearch();
  const navigate = opLogListRoute.useNavigate();

  const [jcInput, setJcInput] = useState(search.jcNo ?? '');
  useEffect(() => setJcInput(search.jcNo ?? ''), [search.jcNo]);

  useEffect(() => {
    const trimmed = jcInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.jcNo) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, jcNo: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [jcInput, search.jcNo, navigate]);

  const query: ListOpLogQuery = useMemo(
    () => ({
      jcNo: search.jcNo,
      logType: search.logType,
      shift: search.shift,
      fromDate: search.fromDate,
      toDate: search.toDate,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.jcNo, search.logType, search.shift, search.fromDate, search.toDate, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useOpLog(query);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Operation Log
        </div>
        <span className="mono text3" style={{ fontSize: 12 }}>
          {total} entries
        </span>
      </div>

      {/* Filters */}
      <div
        className="panel"
        style={{ padding: 12, marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="innovic-input"
          placeholder="Filter by JC code…"
          value={jcInput}
          onChange={(e) => setJcInput(e.target.value)}
          style={{ width: 180, fontSize: 12 }}
        />
        <select
          className="innovic-select"
          value={search.logType ?? ''}
          onChange={(e) => {
            const v = e.target.value as ListOpLogQuery['logType'] | '';
            void navigate({
              search: (prev) => ({ ...prev, logType: v === '' ? undefined : v, page: 1 }),
              replace: true,
            });
          }}
          style={{ width: 130, fontSize: 12 }}
        >
          <option value="">All types</option>
          <option value="start">Start</option>
          <option value="complete">Complete</option>
          <option value="qc">QC</option>
        </select>
        <select
          className="innovic-select"
          value={search.shift ?? ''}
          onChange={(e) => {
            const v = e.target.value as ListOpLogQuery['shift'] | '';
            void navigate({
              search: (prev) => ({ ...prev, shift: v === '' ? undefined : v, page: 1 }),
              replace: true,
            });
          }}
          style={{ width: 120, fontSize: 12 }}
        >
          <option value="">All shifts</option>
          <option value="day">Day</option>
          <option value="night">Night</option>
          <option value="general">General</option>
        </select>
        <span className="text3" style={{ fontSize: 11 }}>From</span>
        <input
          type="date"
          className="innovic-input"
          value={search.fromDate ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, fromDate: e.target.value || undefined, page: 1 }),
              replace: true,
            })
          }
          style={{ width: 140, fontSize: 12 }}
        />
        <span className="text3" style={{ fontSize: 11 }}>To</span>
        <input
          type="date"
          className="innovic-input"
          value={search.toDate ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, toDate: e.target.value || undefined, page: 1 }),
              replace: true,
            })
          }
          style={{ width: 140, fontSize: 12 }}
        />
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Log No.</th>
                <th>JC No.</th>
                <th>Date</th>
                <th className="td-ctr">Op</th>
                <th>Type</th>
                <th>Shift</th>
                <th>Machine</th>
                <th>Operation</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>Qty</th>
                <th className="td-ctr" style={{ color: 'var(--red)' }}>Reject</th>
                <th>Operator</th>
                <th>Remarks</th>
                <th>Logged By</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={13} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load op log'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="empty-state">No log entries match these filters.</td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id}>
                    <td className="mono text3" style={{ fontSize: 11 }}>{r.logNo}</td>
                    <td className="td-code cyan">{r.jcNo}</td>
                    <td className="text2">{fmtDate(r.logDate)}</td>
                    <td className="td-ctr mono">{r.opSeq}</td>
                    <td>
                      <span className={`badge ${logTypeBadge(r.logType)}`}>{r.logType}</span>
                      {r.isTpi ? (
                        <span className="badge b-purple" style={{ marginLeft: 4, fontSize: 9 }}>TPI</span>
                      ) : null}
                    </td>
                    <td className="text2">{r.shift}</td>
                    <td>
                      <span className="tag" style={{ background: 'var(--bg4)', color: 'var(--cyan)' }}>
                        {r.machineCode ?? '?'}
                      </span>
                    </td>
                    <td>{r.operation ?? '?'}</td>
                    <td className="td-ctr mono fw-700 green">{r.qty}</td>
                    <td className="td-ctr mono fw-700" style={{ color: r.rejectQty > 0 ? 'var(--red)' : 'var(--text3)' }}>
                      {r.rejectQty}
                    </td>
                    <td className="text2">{r.operatorName ?? '—'}</td>
                    <td className="text3" style={{ fontSize: 11 }}>{r.remarks ?? ''}</td>
                    <td className="text3" style={{ fontSize: 11 }}>{r.createdByName ?? '—'}</td>
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
            ? 'No entries'
            : `Showing ${(search.page - 1) * PAGE_SIZE + 1}–${Math.min(search.page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, search.page - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {search.page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, search.page + 1) }),
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
