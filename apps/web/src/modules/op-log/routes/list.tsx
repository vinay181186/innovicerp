// Op Log viewer — mirror of legacy renderOpLog (HTML L13194).
//
// Paginated, filterable, read-only. Filters: JC, log type, shift, date range.
// Columns mirror legacy: Log No, JC, Date, Op, Shift, Machine (split into
// Planned / Actual under ADR-164), Operation,
// Qty, Reject, Operator, Remarks — plus an Item column legacy never had, because
// a JC number says WHICH JOB and not WHICH PART. TPI rows tagged. No delete
// (see service.ts note — legacy `delLog` violates CLAUDE.md Rule #8).

import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DocRefLink } from '@/modules/activity-log/components/doc-ref-link';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useOpLog, type ListOpLogQuery } from '../api';
import { exportOpLog } from '../lib/export';

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

const LOG_TYPE_LABEL: Record<'start' | 'complete' | 'qc', string> = {
  start: 'Start',
  complete: 'Completed',
  qc: 'QC Inspection',
};

function logTypeBadge(t: 'start' | 'complete' | 'qc'): string {
  if (t === 'start') return 'b-amber';
  if (t === 'qc') return 'b-purple';
  return 'b-green';
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
  const [exporting, setExporting] = useState(false);

  async function onExport(): Promise<void> {
    setExporting(true);
    try {
      const { written, total: all } = await exportOpLog({
        jcNo: search.jcNo,
        logType: search.logType,
        shift: search.shift,
        fromDate: search.fromDate,
        toDate: search.toDate,
      });
      if (written < all) {
        window.alert(
          `Exported the first ${written} of ${all} entries. Narrow the filter to export the rest.`,
        );
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not export the operation log.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <ListHeader
        title="Operation Log"
        icon="☰"
        count={data ? total : undefined}
        noun="entry"
        nounPlural="entries"
        // Server-side filter on the JC number only — the placeholder says so.
        search={jcInput}
        onSearch={setJcInput}
        searchPlaceholder="Filter by JC No.…"
        updating={isFetching && !isLoading}
        tools={
          <>
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
              style={{ width: 130 }}
            >
              <option value="">All types</option>
              <option value="start">Start</option>
              <option value="complete">Completed</option>
              <option value="qc">QC Inspection</option>
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
              style={{ width: 120 }}
            >
              <option value="">All shifts</option>
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="general">General</option>
            </select>
            <input
              type="date"
              className="innovic-input"
              title="Log date from"
              aria-label="Log date from"
              value={search.fromDate ?? ''}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({ ...prev, fromDate: e.target.value || undefined, page: 1 }),
                  replace: true,
                })
              }
              style={{ width: 140 }}
            />
            <input
              type="date"
              className="innovic-input"
              title="Log date to"
              aria-label="Log date to"
              value={search.toDate ?? ''}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({ ...prev, toDate: e.target.value || undefined, page: 1 }),
                  replace: true,
                })
              }
              style={{ width: 140 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={exporting || total === 0}
              title="Export every entry matching the current filter to Excel"
              onClick={() => void onExport()}
            >
              {exporting ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '⬇'} Export
            </button>
          </>
        }
      />

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Log No.</th>
                <th>JC No.</th>
                {/* POL — the line number printed on the CUSTOMER's own purchase
                    order, immediately before the item. Not any line number of
                    ours. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                {/* The item the card makes. A JC number identifies the JOB; only
                    this column says which PART the logged qty belongs to. */}
                <th>Item Code</th>
                <th>Log Date</th>
                <th>Op</th>
                <th>Log Type</th>
                <th>Shift</th>
                <th>Planned Machine</th>
                <th>Actual Machine</th>
                <th>Operation</th>
                <th className="th-num" style={{ color: 'var(--green2)' }}>
                  Completed
                </th>
                <th className="th-num" style={{ color: 'var(--red2)' }}>
                  Rejected
                </th>
                <th>Operator</th>
                <th>Remarks</th>
                <th>Logged By</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={16} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={16} className="empty-state" style={{ color: 'var(--red2)' }}>
                    {error instanceof Error ? error.message : 'Could not load op log. Try again.'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={16} className="empty-state">
                    No log entries match these filters.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id}>
                    {/* Log No. and JC No. both open the job card the entry was
                        logged against — straight to /job-cards/$id when the row
                        carries the card's id (ADR-189 addendum), else resolved
                        from the JC number through search. */}
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {r.jobCardId ? (
                        <Link
                          to="/job-cards/$id"
                          params={{ id: r.jobCardId }}
                          className="mono fw-700"
                          title={`Open ${r.jcNo}`}
                        >
                          {r.logNo}
                        </Link>
                      ) : (
                        <DocRefLink entity="Job Card" refId={r.jcNo} label={r.logNo} />
                      )}
                    </td>
                    <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
                      {r.jobCardId ? (
                        <Link
                          to="/job-cards/$id"
                          params={{ id: r.jobCardId }}
                          className="mono fw-700"
                          title={`Open ${r.jcNo}`}
                        >
                          {r.jcNo}
                        </Link>
                      ) : (
                        <DocRefLink entity="Job Card" refId={r.jcNo} />
                      )}
                    </td>
                    {/* POL — '—' when no sales order sits behind the card. */}
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {r.clientPoLineNo ?? '—'}
                    </td>
                    {/* The item code is the value anyone scans this log for — it
                        is how the drawing and the batch get identified — so it
                        carries the darkest text token and the bold weight. The
                        cell used to be `text2` throughout, which muted the code
                        along with the part name under it; the name keeps its own
                        `text3` and stays quiet, which is the intended contrast. */}
                    <td style={{ fontSize: 11 }}>
                      <span
                        className="mono fw-700"
                        style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}
                      >
                        {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
                      </span>
                      {r.itemName ? (
                        <div
                          className="text3"
                          style={{
                            fontSize: 11,
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={r.itemName}
                        >
                          {r.itemName}
                        </div>
                      ) : null}
                    </td>
                    <td className="text2" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(r.logDate)}
                    </td>
                    <td className="mono">{opSrNo(r.opSeq)}</td>
                    <td>
                      <span className={`badge ${logTypeBadge(r.logType)}`}>
                        {LOG_TYPE_LABEL[r.logType]}
                      </span>
                      {r.isTpi ? (
                        <span className="badge b-purple" style={{ marginLeft: 4, fontSize: 11 }}>
                          TPI
                        </span>
                      ) : null}
                    </td>
                    <td className="text2">{SHIFT_LABELS[r.shift as Shift] ?? r.shift}</td>
                    {/* ADR-164 — PLANNED is the op's jc_ops machine; ACTUAL is
                        the machine this entry was stamped with. The actual
                        turns amber only when it is not the plan. */}
                    <td>
                      <span
                        className="tag"
                        style={{ background: 'var(--bg4)', color: 'var(--cyan)' }}
                      >
                        {r.plannedMachineCode ?? '?'}
                      </span>
                    </td>
                    <td>
                      <span
                        className="tag"
                        style={{
                          background: 'var(--bg4)',
                          color:
                            r.machineCode &&
                            r.plannedMachineCode &&
                            r.machineCode.trim().toLowerCase() !==
                              r.plannedMachineCode.trim().toLowerCase()
                              ? 'var(--amber)'
                              : 'var(--cyan)',
                        }}
                      >
                        {r.machineCode ?? '?'}
                      </span>
                    </td>
                    <td>{r.operation ?? '?'}</td>
                    <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
                      {r.qty}
                    </td>
                    <td
                      className="td-num mono fw-700"
                      style={{ color: r.rejectQty > 0 ? 'var(--red2)' : 'var(--text3)' }}
                    >
                      {r.rejectQty}
                    </td>
                    <td className="text2">{r.operatorName ?? '—'}</td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {r.remarks ?? ''}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {r.createdByName ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ListFooter
        total={total}
        noun="entry"
        nounPlural="entries"
        page={search.page}
        pageSize={PAGE_SIZE}
        onPage={(p) =>
          void navigate({
            search: (prev) => ({ ...prev, page: Math.min(totalPages, Math.max(1, p)) }),
            replace: true,
          })
        }
      />
    </div>
  );
}
