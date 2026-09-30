// Op Log viewer — mirror of legacy renderOpLog (HTML L13194).
//
// Paginated, filterable, read-only. Filters: JC, log type, shift, date range.
// Columns mirror legacy: Log No, JC, Date, Op, Shift, Machine (split into
// Planned / Actual under ADR-164), Operation,
// Qty, Reject, Operator, Remarks — plus an Item column legacy never had, because
// a JC number says WHICH JOB and not WHICH PART. TPI rows tagged. No delete
// (see service.ts note — legacy `delLog` violates CLAUDE.md Rule #8).
//
// ADR-197 — an entry is corrected by REVERSING it: the original stays and an
// opposite entry (negative Completed / Rejected) is added. A reversal row reads
// "Reversal of LOG-…" + its reason in red; the original it cancels reads
// "Reversed by LOG-…" with its figures struck through. The Reverse button needs
// edit AND approve on the 'op_entry' Access Control form.

import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DocRefLink } from '@/modules/activity-log/components/doc-ref-link';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useOpLog, type ListOpLogQuery, type OpLogListItem } from '../api';
import { ReverseOpLogModal } from '../components/reverse-op-log-modal';
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

/** A reversal row: it names the entry it cancels, or (older payloads) it
 *  carries a negative figure. */
function isReversalRow(r: OpLogListItem): boolean {
  return Boolean(r.reversalOfId) || r.qty < 0 || r.rejectQty < 0;
}

function OpLogListPage(): React.JSX.Element {
  const search = opLogListRoute.useSearch();
  const navigate = opLogListRoute.useNavigate();

  // Reverse = edit AND approve on Op Entry (the server checks the same; admin
  // bypasses inside effectiveFormPerms). Hidden until the matrix has loaded.
  const { data: eff } = useMyAccess();
  const opEntryPerms = effectiveFormPerms(eff, 'op_entry');
  const canReverse = Boolean(eff) && opEntryPerms.edit && opEntryPerms.approve;
  const [reversing, setReversing] = useState<OpLogListItem | null>(null);
  const colCount = canReverse ? 17 : 16;

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
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="Log type"
              title="Log type"
              value={search.logType ?? ''}
              onChange={(e) => {
                const v = e.target.value as ListOpLogQuery['logType'] | '';
                void navigate({
                  search: (prev) => ({ ...prev, logType: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
            >
              <option value="">All types</option>
              <option value="start">Start</option>
              <option value="complete">Completed</option>
              <option value="qc">QC Inspection</option>
            </select>
            <select
              className="innovic-select"
              aria-label="Shift"
              title="Shift"
              value={search.shift ?? ''}
              onChange={(e) => {
                const v = e.target.value as ListOpLogQuery['shift'] | '';
                void navigate({
                  search: (prev) => ({ ...prev, shift: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
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
            />
          </>
        }
        onClearFilters={() => {
          setJcInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              jcNo: undefined,
              logType: undefined,
              shift: undefined,
              fromDate: undefined,
              toDate: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={
          !!search.logType ||
          !!search.shift ||
          !!search.fromDate ||
          !!search.toDate ||
          jcInput.trim() !== ''
        }
        tools={
          <>
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
                {canReverse ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colCount} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={colCount} className="empty-state" style={{ color: 'var(--red2)' }}>
                    {error instanceof Error ? error.message : 'Could not load op log. Try again.'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="empty-state">
                    No log entries match these filters.
                  </td>
                </tr>
              ) : (
                items.map((r) => {
                  const reversal = isReversalRow(r);
                  const reversed = Boolean(r.reversedById);
                  const showReverse =
                    canReverse &&
                    (r.logType === 'complete' || r.logType === 'qc') &&
                    !reversal &&
                    !reversed &&
                    !r.logNo.startsWith('LOG-NC-');
                  // A reversed original keeps its row; its figures no longer count.
                  const struck: React.CSSProperties | undefined = reversed
                    ? { textDecoration: 'line-through' }
                    : undefined;
                  return (
                    <tr key={r.id}>
                      {/* Log No. and JC No. both open the job card the entry was
                        logged against — straight to /job-cards/$id when the row
                        carries the card's id (ADR-190 addendum), else resolved
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
                        {reversal ? (
                          <div style={{ marginTop: 3 }}>
                            <span
                              className="badge b-red"
                              title={r.reversalReason ? `Reason: ${r.reversalReason}` : undefined}
                            >
                              Reversal of {r.reversalOfLogNo ?? 'an earlier entry'}
                            </span>
                            {r.reversalReason ? (
                              <div
                                className="text2"
                                style={{
                                  fontSize: 11,
                                  maxWidth: 200,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={r.reversalReason}
                              >
                                {r.reversalReason}
                              </div>
                            ) : null}
                          </div>
                        ) : reversed ? (
                          <div style={{ marginTop: 3 }}>
                            <span className="badge b-grey">
                              Reversed by {r.reversedByLogNo ?? 'a later entry'}
                            </span>
                          </div>
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
                          {r.plannedMachineCode ?? '—'}
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
                          {r.machineCode ?? '—'}
                        </span>
                      </td>
                      <td>{r.operation ?? '—'}</td>
                      <td
                        className="td-num mono fw-700"
                        style={{
                          color:
                            r.qty < 0 ? 'var(--red2)' : reversed ? 'var(--text3)' : 'var(--green2)',
                          ...struck,
                        }}
                      >
                        {r.qty}
                      </td>
                      <td
                        className="td-num mono fw-700"
                        style={{
                          color: r.rejectQty !== 0 && !reversed ? 'var(--red2)' : 'var(--text3)',
                          ...struck,
                        }}
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
                      {canReverse ? (
                        <td>
                          {showReverse ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Reverse this entry — the original stays and an opposite entry is added"
                              onClick={() => setReversing(r)}
                            >
                              <Undo2 size={12} /> Reverse
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reversing ? <ReverseOpLogModal row={reversing} onClose={() => setReversing(null)} /> : null}

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
