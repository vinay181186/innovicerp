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

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useOpLog, type ListOpLogQuery, type OpLogListItem } from '../api';
import {
  isReversalRow,
  OP_LOG_DEFAULT_PINNED,
  OP_LOG_HIDDEN_COLUMNS,
  opLogColumns,
} from '../components/op-log-columns';
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

/** Reverse is offered on a Completed / QC entry that is neither a reversal
 *  nor already reversed, and never on a non-conformance entry. */
function canReverseRow(r: OpLogListItem): boolean {
  return (
    (r.logType === 'complete' || r.logType === 'qc') &&
    !isReversalRow(r) &&
    !r.reversedById &&
    !r.logNo.startsWith('LOG-NC-')
  );
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
  const columns = useMemo(() => opLogColumns(), []);

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

  // Sort & Filter runs on the SERVER here (ADR-200): the log is paged 50 at a
  // time, so sorting / filtering only the loaded page would miss entries.
  // Every change goes back to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.opLogList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListOpLogQuery = useMemo(
    () => ({
      jcNo: search.jcNo,
      logType: search.logType,
      shift: search.shift,
      fromDate: search.fromDate,
      toDate: search.toDate,
      sf: sf.param,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [
      sf.param,
      search.jcNo,
      search.logType,
      search.shift,
      search.fromDate,
      search.toDate,
      search.page,
    ],
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
        sf: sf.param,
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
          sf.clearFilters();
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
          sf.filtering ||
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

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load op log. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.opLogList}
            sortFilterServer={sf}
            columns={columns}
            defaultHidden={[...OP_LOG_HIDDEN_COLUMNS]}
            rows={items}
            loading={isLoading}
            emptyText="No log entries match these filters."
            defaultPinned={OP_LOG_DEFAULT_PINNED}
            // ⋯ menu: Reverse — only on an entry that can still be reversed,
            // and only for a user with edit + approve on Op Entry.
            rowMenu={
              canReverse
                ? (r) =>
                    canReverseRow(r)
                      ? [
                          {
                            key: 'reverse',
                            label: 'Reverse',
                            onSelect: () => setReversing(r),
                          },
                        ]
                      : []
                : undefined
            }
          />
        </Panel>
      )}

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
