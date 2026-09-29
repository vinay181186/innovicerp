// Tool Issue Register — ADR-193 phase 4b. Renders as the Tool Issues tab of
// /issue-register. Three views: the issues, who holds what, and write-offs
// (Damaged / Lost / Scrap waiting for the Store In-charge). Local state only;
// `initialSearch` is a one-time seed from the Global Search deep link.

import type { ToolIssueListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useToolIssuesList } from '../api';
import { NewToolIssueModal } from './new-tool-issue-modal';
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
const PAGE_SIZE = 25;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
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

  const { data, isLoading, isError, error } = useToolIssuesList({
    filter,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

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
              setFilter('all');
              setSearch('');
              setPage(1);
            }}
            filtersActive={filter !== 'all' || search !== ''}
            primary={
              perms.entry ? (
                <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
                  + Issue Tool
                </button>
              ) : null
            }
          />

          <div className="panel">
            {isLoading ? (
              <div className="panel-body text3" style={{ fontSize: 12 }}>
                <Loader2 size={14} className="inline animate-spin" /> Loading…
              </div>
            ) : isError ? (
              <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
                {error instanceof Error ? error.message : 'Could not load tool issues.'}
              </div>
            ) : data ? (
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>Issue No.</th>
                      <th>Issue Date</th>
                      <th>Item Code</th>
                      <th>Instrument Serial No.</th>
                      <th className="th-num">Issue Qty</th>
                      <th>Issued To</th>
                      <th>Expected Return</th>
                      <th className="th-num">Returned Good</th>
                      <th className="th-num">Still Out</th>
                      <th>Return Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((t) => (
                      <IssueRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
                    ))}
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="empty-state">
                          {search.trim() || filter !== 'all'
                            ? 'No tool issues match.'
                            : 'No tool issues yet.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          {data ? (
            <ListFooter
              total={data.total}
              noun="tool issue"
              page={page}
              pageSize={PAGE_SIZE}
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

function IssueRow({ t, onOpen }: { t: ToolIssueListItem; onOpen: () => void }): React.JSX.Element {
  const status = t.cancelledAt ? (
    <span className="badge b-red">Cancelled</span>
  ) : t.returnStatus === 'returned' ? (
    <span className="badge b-green">Returned</span>
  ) : t.isOverdue ? (
    <span className="badge b-red">Overdue</span>
  ) : t.returnStatus === 'partial' ? (
    <span className="badge b-amber">Partly Returned</span>
  ) : (
    <span className="badge b-amber">Out</span>
  );
  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }} title="Open — return, cancel, history">
      <td className="td-code" style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>
        {t.code}
      </td>
      <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {fmtDate(t.issueDate)}
      </td>
      <td>
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {t.itemCode ?? '—'}
        </span>
        {t.itemName ? (
          <div className="text3" style={{ fontSize: 11 }}>
            {t.itemName}
          </div>
        ) : null}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {t.serialNos || '—'}
      </td>
      <td className="mono fw-700 td-num">{r3(t.qty)}</td>
      <td>{t.issuedTo || '—'}</td>
      <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {t.expectedReturnDate ? fmtDate(t.expectedReturnDate) : '—'}
      </td>
      <td className="mono td-num">{r3(t.goodQty)}</td>
      <td className="mono fw-700 td-num">
        {r3(t.stillOutQty)}
        {t.writeoffPendingQty > 0 ? (
          <div style={{ fontSize: 10, color: 'var(--amber2)' }}>
            {r3(t.writeoffPendingQty)} write-off pending
          </div>
        ) : null}
      </td>
      <td>{status}</td>
    </tr>
  );
}
