// Item Issue Register (PL-II-1) — ADR-193 phase 3b: a slip has lines and is
// issued against a Job Card, an Assembly SO or for General use. Click a row to
// see its lines and Return leftovers or Reverse it. On the shared FIT DataTable
// (ADR-199, table standard 2026-10-01): one line per row, always fits the
// screen, the ▸ reveals Remarks and (when reversed) who reversed it and why.

import { ISSUE_AGAINST } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { ToolIssueRegisterView } from '@/modules/tool-issues/components/tool-issue-register-view';
import { fmtDate } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useStoreIssuesList } from '../api';
import { issueRegisterColumns } from '../components/issue-register-columns';
import { IssueViewModal } from '../components/issue-view-modal';
import { NewIssueModal, type NewIssueSeed } from '../components/new-issue-modal';

const PAGE_SIZE = 25;

// Deep-link seed for Global Search (no detail page here): `?tab=tools&search=
// TIS-00003` opens the Tool Issues tab with its box pre-filled. Read ONCE into
// the local state below — tab clicks and typing stay local, never navigate.
// `?new=job_card&jobCardId=…` (JC Material tab "Issue from Store") or
// `?new=assembly_so&salesOrderId=…` (assembly page) opens New Issue seeded.
const searchSchema = z.object({
  tab: z.enum(['items', 'tools']).optional(),
  search: z.string().optional(),
  new: z.enum(ISSUE_AGAINST).optional(),
  jobCardId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
});

export const storeIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'issue-register',
  validateSearch: (search) => searchSchema.parse(search),
  component: StoreIssuesListPage,
});

function StoreIssuesListPage(): React.JSX.Element {
  const routeSearch = storeIssuesListRoute.useSearch();
  const [tab, setTab] = useState<'items' | 'tools'>(() => routeSearch.tab ?? 'items');
  // Seed this tab's box only when the landing targets it; a `?tab=tools`
  // landing must not pre-fill the Items box with a tool-issue code.
  const [search, setSearch] = useState(() =>
    (routeSearch.tab ?? 'items') === 'items' ? (routeSearch.search ?? '') : '',
  );
  const [page, setPage] = useState(1);
  const [newSeed, setNewSeed] = useState<NewIssueSeed | null>(() =>
    routeSearch.new
      ? {
          issueAgainst: routeSearch.new,
          jobCardId: routeSearch.jobCardId,
          salesOrderId: routeSearch.salesOrderId,
        }
      : null,
  );
  const [viewId, setViewId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Tier-driven, per department (Store). Was `role === admin || manager`, which
  // let any manager in any department post a stock issue and locked out the
  // L2 storekeeper whose job this is. This gate covers the Item Issues tab
  // only — the Tool Issues tab hits a different endpoint under a different key
  // (`toolissue_create`) and carries its own create control inside
  // `tool-issues/components/tool-issue-register-view.tsx`, gated the same way
  // (tier on `toolissue_create`); the server enforces it too.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'issue_create');

  const { data, isLoading, isError, error } = useStoreIssuesList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const columns = useMemo(() => issueRegisterColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Issues. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-201): on the list tab the page fills the content area and the
    // TABLE is the only scrollbox, so the column header cannot ride off the top at the
    // last row. The Tool Issues tab is its own screen and keeps today's page scroll.
    <div className={tab === 'tools' ? undefined : 'page-fill'}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['items', 'tools'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'items' ? 'Item Issues' : 'Tool Issues'}
          </button>
        ))}
      </div>

      {tab === 'tools' ? (
        // key: a new ?search landing while already on this page remounts the
        // view so it re-seeds; nothing else changes the key.
        <ToolIssueRegisterView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · search ·
              + New Issue. */}
          <ListHeader
            title="Item Issue Register"
            icon="📋"
            count={data?.total}
            noun="issue"
            search={search}
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            searchPlaceholder="Search issue, item, JC, SO, name…"
            primary={
              perms.entry ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setNewSeed({ issueAgainst: 'job_card' })}
                >
                  <Plus size={14} /> New Issue
                </button>
              ) : null
            }
          />

          {isError ? (
            <PageState
              state="error"
              message={error instanceof Error ? error.message : 'Could not load issues. Try again.'}
            />
          ) : (
            <Panel fill bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.issueRegister}
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(iss) => iss.id}
                loading={isLoading}
                empty={search.trim() ? 'No issues match.' : 'No issues yet.'}
                onRowClick={(iss) => setViewId(iss.id)}
                // A reversed slip washes the whole row and strikes its items.
                rowClassName={(iss) => (iss.reversedAt ? ROW_TINT.cancelled : undefined)}
                // The fit table's ▸ is the row's one expand control: Remarks and,
                // when reversed, who reversed it and why.
                renderExpanded={(iss) =>
                  expanded.has(iss.id) ? (
                    <div
                      className="text3"
                      style={{ fontSize: 'var(--fs-xs)', padding: 'var(--sp-2) var(--sp-6)' }}
                    >
                      <b>Remarks:</b> {iss.remarks ?? '—'}
                      {iss.reversedAt ? (
                        <div style={{ color: 'var(--red2)', marginTop: 'var(--sp-1)' }}>
                          <b>Reversed:</b> {fmtDate(iss.reversedAt.slice(0, 10))}
                          {iss.reversalReason ? ` — ${iss.reversalReason}` : ''}
                        </div>
                      ) : null}
                    </div>
                  ) : null
                }
                onToggleExpanded={(iss) => toggleExpand(iss.id)}
                rowActionsWidth="1%"
                rowActions={(iss) => <RowActions onView={() => setViewId(iss.id)} />}
              />
            </Panel>
          )}

          {data ? (
            <ListFooter
              total={data.total}
              noun="issue"
              page={page}
              pageSize={PAGE_SIZE}
              onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
            />
          ) : null}

          {newSeed && perms.entry ? (
            <NewIssueModal seed={newSeed} onClose={() => setNewSeed(null)} />
          ) : null}
          {viewId ? (
            <IssueViewModal
              issueId={viewId}
              canReturn={perms.entry}
              canReverse={perms.edit}
              onClose={() => setViewId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
