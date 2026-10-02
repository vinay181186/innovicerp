// Tool Issue Register — ADR-193 phase 4b. Renders as the Tool Issues tab of
// /issue-register. Three views: the issues, who holds what, and write-offs
// (Damaged / Lost / Scrap waiting for the Store In-charge). Local state only;
// `initialSearch` is a one-time seed from the Global Search deep link. The
// issues view is on the shared FIT DataTable (ADR-199, table standard
// 2026-10-01): one line per row, always fits the screen, the row washed by its
// return status.

import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useToolIssuesList } from '../api';
import { NewToolIssueModal } from './new-tool-issue-modal';
import { TOOL_ISSUE_HIDDEN_COLUMNS, toolIssueColumns } from './tool-issue-columns';
import { ToolHoldersView } from './tool-holders-view';
import { ToolIssueViewModal } from './tool-issue-view-modal';
import { ToolWriteoffsView } from './tool-writeoffs-view';

type FilterKey = 'all' | 'out' | 'overdue' | 'returned' | 'cancelled';
const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All',
  out: 'Currently Out',
  overdue: 'Overdue',
  returned: 'Returned',
  cancelled: 'Cancelled',
};
type View = 'issues' | 'holders' | 'writeoffs';
const withCount = (label: string, n: number | undefined): string =>
  n == null ? label : `${label} (${n})`;

export function ToolIssueRegisterView({
  initialSearch,
}: {
  initialSearch?: string | undefined;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'toolissue_create');
  const [view, setView] = useState<View>('issues');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState(() => initialSearch ?? '');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Sort & Filter runs on the SERVER here (ADR-200): the register is paged, so
  // filtering only the loaded page would miss issues. Every change goes back to
  // page 1.
  const sf = useServerSortFilter(TABLE_KEYS.toolIssues, () => setPage(1));

  const { data, isLoading, isError, error } = useToolIssuesList({
    filter,
    search: search.trim() || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);
  const columns = useMemo(() => toolIssueColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Tool Issues. Ask an admin.
      </div>
    );
  }

  const pendingWriteoffs = data?.summary?.writeoffsPending ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(
          [
            ['issues', 'Tool Issues'],
            ['holders', 'Who Holds What'],
            ['writeoffs', withCount('Write-offs', pendingWriteoffs || undefined)],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={view === k ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() => setView(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'holders' ? (
        <ToolHoldersView onOpen={setOpenId} />
      ) : view === 'writeoffs' ? (
        <ToolWriteoffsView canDecide={perms.approve} />
      ) : (
        <>
          <ListHeader
            title="Tool Issue Register"
            icon="🔧"
            count={data?.total}
            noun="tool issue"
            filterNote={filter === 'all' ? undefined : FILTER_LABELS[filter]}
            search={search}
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            searchPlaceholder="Search Issue No., item, serial, issued to…"
            filters={
              <select
                className="innovic-select"
                aria-label="Tool Issue Status"
                title="Tool Issue Status"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as FilterKey);
                  setPage(1);
                }}
              >
                <option value="all">{withCount('All', data?.summary?.total)}</option>
                <option value="out">{withCount(FILTER_LABELS.out, data?.summary?.out)}</option>
                <option value="overdue">
                  {withCount(FILTER_LABELS.overdue, data?.summary?.overdue)}
                </option>
                <option value="returned">
                  {withCount(FILTER_LABELS.returned, data?.summary?.returned)}
                </option>
                <option value="cancelled">{FILTER_LABELS.cancelled}</option>
              </select>
            }
            onClearFilters={() => {
              sf.clearFilters();
              setFilter('all');
              setSearch('');
              setPage(1);
            }}
            filtersActive={sf.filtering || filter !== 'all' || search !== ''}
            primary={
              perms.entry ? (
                <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
                  + Issue Tool
                </button>
              ) : null
            }
          />

          {isError ? (
            <PageState
              state="error"
              message={error instanceof Error ? error.message : 'Could not load tool issues.'}
            />
          ) : (
            <Panel bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.toolIssues}
                sortFilterServer={sf}
                defaultHidden={[...TOOL_ISSUE_HIDDEN_COLUMNS]}
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(t) => t.id}
                loading={isLoading}
                empty={
                  search.trim() || filter !== 'all' || sf.filtering
                    ? 'No tool issues match.'
                    : 'No tool issues yet.'
                }
                onRowClick={(t) => setOpenId(t.id)}
                // Cancelled greys the row, a full return greens it, an overdue
                // reddens it, a part return ambers it; a plain still-out stays
                // untinted.
                rowClassName={(t) =>
                  t.cancelledAt
                    ? ROW_TINT.cancelled
                    : t.returnStatus === 'returned'
                      ? ROW_TINT.done
                      : t.isOverdue
                        ? ROW_TINT.late
                        : t.returnStatus === 'partial'
                          ? ROW_TINT.pending
                          : undefined
                }
                rowActionsWidth="1%"
                rowActions={(t) => <RowActions onView={() => setOpenId(t.id)} />}
              />
            </Panel>
          )}
          {data ? (
            <ListFooter
              total={data.total}
              noun="tool issue"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
            />
          ) : null}
        </>
      )}

      {showNew && perms.entry ? <NewToolIssueModal onClose={() => setShowNew(false)} /> : null}
      {openId ? (
        <ToolIssueViewModal id={openId} canReturn={perms.edit} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
