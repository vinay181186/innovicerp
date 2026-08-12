// Job cards list (UI-003-07) — read-only.

import {
  JC_COMPUTED_STATUSES,
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
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
import { PrintJcButton } from '../components/print-jc-button';

// No pagination — mirror the SO/WO list: one fetch, scroll (no Prev/Next). The
// JC list-query cap is 200; the count line flags a rare larger set.
const LIST_LIMIT = 200;

/** One cell of the card's metric strip — big mono value over a tiny uppercase
 *  label, mirroring the SO/WO list (ORDER QTY / COMPLETED / PENDING / OPS). */
function QtyBox({ label, value, color, bordered }: { label: string; value: number | string; color?: string; bordered?: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '4px 12px', textAlign: 'center', minWidth: 58, borderLeft: bordered ? '1px solid var(--border)' : undefined }}>
      <div className="mono fw-700" style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}>{value}</div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
    </div>
  );
}

/** Left accent bar — red when late & unfinished, green when finished, blue
 *  otherwise. Same tokens the badges use (mirrors the SO/WO list). */
function accentFor(jc: JobCardListItem, today: string): string {
  const overdue =
    jc.dueDate != null &&
    jc.dueDate < today &&
    jc.computedStatus !== 'closed' &&
    jc.computedStatus !== 'complete';
  if (overdue) return 'var(--red)';
  if (jc.computedStatus === 'closed' || jc.computedStatus === 'complete') return 'var(--green)';
  return 'var(--blue)';
}

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
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [
      search.search,
      search.status,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
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

  // Column definitions removed — the list renders SO-style cards below.

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);

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
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Job Cards
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <>
              <Link to="/planning" className="btn btn-primary">
                + Plan &amp; Create Job Card
              </Link>
              <Link
                to="/job-cards/new"
                className="btn btn-ghost"
                title="Job Work Sales Orders (JWSO) only. Sales Order items are created via Planning."
              >
                + New JWSO Job Card
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
              placeholder="Search code, item, customer, SO/JWSO…"
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

      {isLoading ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading job cards…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20, color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load job cards'}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>No job cards match these filters.</div>
        </div>
      ) : (
        rows.map((jc) => {
          const done = jc.lastOpCompletedQty;
          const pending = Math.max(0, jc.orderQty - done);
          const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
          const overdue =
            jc.dueDate != null &&
            jc.dueDate < today &&
            jc.computedStatus !== 'closed' &&
            jc.computedStatus !== 'complete';
          const s = jc.sourceLink;
          const high = jc.priority === 'high';
          return (
            <div
              key={jc.id}
              className="panel"
              style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
            >
              <div style={{ width: 4, flexShrink: 0, background: accentFor(jc, today) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Band 1: identity + priority + status + actions */}
                <div
                  onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px', cursor: 'pointer' }}
                >
                  <Link
                    to="/job-cards/$id"
                    params={{ id: jc.id }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                    title="View job card status"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {jc.code}
                  </Link>
                  <span className="fw-700" style={{ fontSize: 13 }}>{jc.itemName || '—'}</span>
                  <span className="td-code" style={{ color: 'var(--purple)', fontSize: 11 }}>{jc.itemCode}</span>
                  {s
                    ? (() => {
                        const to = s.type === 'so' ? '/sales-orders/$id' : '/job-work-orders/$id';
                        const sid = s.type === 'so' ? s.salesOrderId : s.jobWorkOrderId;
                        return (
                          <Link
                            to={to}
                            params={{ id: sid }}
                            className="mono"
                            style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.code}
                            {s.lineNo !== 1 ? (
                              <span style={{ fontSize: 9, color: 'var(--blue)', marginLeft: 2 }}>/{s.lineNo}</span>
                            ) : null}
                          </Link>
                        );
                      })()
                    : null}
                  <span className={`badge ${high ? 'b-amber' : 'b-grey'}`}>{high ? 'High' : 'Normal'}</span>
                  <JcStatusBadge status={jc.computedStatus} />
                  {jc.runningCount > 0 ? (
                    <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}>▶{jc.runningCount}</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <Link to="/job-cards/$id" params={{ id: jc.id }} className="btn btn-ghost btn-sm" title="View job card status">
                      👁 View
                    </Link>
                    <PrintJcButton jc={jc} />
                    <ExcelJcButton jc={jc} />
                    <JcRowWriteActions jc={jc} />
                    <AssignTaskButton
                      linkedRef={{ type: 'job_card', id: jc.id, display: `JC ${jc.code}`, navPage: '/job-cards' }}
                      suggestedTitle={`Follow up on JC ${jc.code}`}
                    />
                  </div>
                </div>
                {/* Band 2: metric strip + progress + meta line */}
                <div
                  onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 14px 10px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <QtyBox label="Order Qty" value={jc.orderQty} />
                    <QtyBox label="Completed" value={done} color="var(--green)" bordered />
                    <QtyBox label="Pending" value={pending} color={pending > 0 ? 'var(--red)' : 'var(--green)'} bordered />
                    <QtyBox label="Ops" value={`${jc.doneOps}/${jc.totalOps}`} bordered />
                  </div>
                  <div style={{ minWidth: 90 }}>
                    <div style={{ width: 90, height: 4, background: 'var(--bg5)', borderRadius: 2 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 2 }} />
                    </div>
                    <div className="mono" style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{pct}% complete</div>
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <span className="text2">{jc.jcDate}</span>
                    {jc.clientPoLineNo ? (
                      <>
                        <span>·</span>
                        <span>CPO <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{jc.clientPoLineNo}</span></span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span style={{ color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 700 : undefined }}>
                      {jc.dueDate ? `Due ${jc.dueDate}${overdue ? ' ⚠' : ''}` : 'No due date'}
                    </span>
                    {jc.remarks ? (
                      <>
                        <span>·</span>
                        <span title={jc.remarks} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {jc.remarks}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        <span>
          {total === 0
            ? 'No job cards'
            : total > LIST_LIMIT
              ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
              : `Showing all ${total} job card${total === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}
