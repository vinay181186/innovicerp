// Settings → Approvals — the things WAITING for a decision.
//
// Distinct from Approval Rules next to it in the menu, which holds the
// rules (which approvals are on, who may approve, the PO limit). This screen
// holds the queue.
//
// ADR-190: the page is an INBOX — GET /approvals/inbox lists what is waiting
// for the signed-in user, in three sections: PR · PO · Op Entry, each with its
// count. PR and PO rows open the document, where the Approve button lives. The
// Op Entry section is the existing decide-here screen (ADR-130: Pending /
// Approved / Rejected), shown only to managers and admins, who alone decide it.
//
// ADR-201: the PR and PO sections show 25 rows a page (Prev / Next); search
// and Sort & Filter run on the server (GET /approvals/inbox/list) over every
// waiting document. The tab counts are the inbox's whole-queue counts.

import { createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDocumentEdits } from '@/modules/document-edits/api';
import { EditApprovalsInbox } from '@/modules/document-edits/components/edit-approvals-inbox';
import { useApprovalInbox, useApprovalInboxList } from '../api';
import { LogEntryApprovals } from '../components/log-entry-approvals';
import { prPoColumns } from '../components/pr-po-columns';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

type Section = 'pr' | 'po' | 'logEntry' | 'editApproval';

const SECTION_LABEL: Record<Section, string> = {
  pr: 'PR',
  po: 'PO',
  logEntry: 'Op Entry',
  editApproval: 'Edit Approvals',
};

const SECTION_TITLE: Record<Exclude<Section, 'editApproval'>, string> = {
  pr: 'PR Approvals',
  po: 'PO Approvals',
  logEntry: 'Op Entry Approvals',
};

const SECTION_EMPTY: Record<Exclude<Section, 'editApproval'>, string> = {
  pr: 'No Purchase Requests waiting for your approval.',
  po: 'No Purchase Orders waiting for your approval.',
  logEntry: 'Nothing pending approval.',
};

const SECTION_NO_MATCH: Record<Exclude<Section, 'logEntry' | 'editApproval'>, string> = {
  pr: 'No Purchase Requests match.',
  po: 'No Purchase Orders match.',
};

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canDecideLogEntry = me?.role === 'admin' || me?.role === 'manager';
  const inbox = useApprovalInbox({ refetchOnMount: 'always' });
  const counts = inbox.data?.counts;
  // Edit Approvals (ADR-202) — its own query; `total` is the whole pending
  // queue, which is what the tab badge shows.
  const editInbox = useDocumentEdits({ status: 'pending' });
  const editCount = editInbox.data?.total;

  const sections: Section[] = canDecideLogEntry
    ? ['pr', 'po', 'logEntry', 'editApproval']
    : ['pr', 'po', 'editApproval'];
  // Count for one tab — PR / PO / Op Entry from the approval inbox, Edit
  // Approvals from its own query.
  const countFor = (s: Section): number | undefined =>
    s === 'editApproval' ? editCount : counts?.[s];
  // Until the user picks one, open the first section that has something
  // waiting (PR first), so the page lands on work rather than an empty list.
  const [picked, setPicked] = useState<Section | null>(null);
  const section: Section =
    picked ?? (counts ? (sections.find((s) => (countFor(s) ?? 0) > 0) ?? 'pr') : 'pr');

  const tabs = (
    <div role="tablist" aria-label="Approval type" style={{ display: 'flex', gap: 'var(--sp-1)' }}>
      {sections.map((s) => {
        const on = s === section;
        const n = countFor(s);
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={on}
            className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPicked(s)}
          >
            {SECTION_LABEL[s]}
            {n != null ? (
              <span className={`badge ${n > 0 ? 'b-amber' : 'b-grey'}`} style={{ marginLeft: 6 }}>
                {n}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  if (section === 'logEntry') {
    return <LogEntryApprovals pendingCount={counts?.logEntry} tabs={tabs} />;
  }

  if (section === 'editApproval') {
    return (
      <div className="page-fill">
        <div style={{ marginBottom: 'var(--sp-2)' }}>{tabs}</div>
        <EditApprovalsInbox />
      </div>
    );
  }

  return <InboxSection key={section} section={section} tabs={tabs} />;
}

function InboxSection({
  section,
  tabs,
}: {
  section: Exclude<Section, 'logEntry' | 'editApproval'>;
  tabs: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  // Page + search live in component state: the PR / PO switch is a tab of one
  // route, and switching it (a new key) starts the section on page 1.
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = normalizeSearchTerm(term);
    const next = t === '' ? undefined : t;
    if (next === q) return;
    const id = window.setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, q]);
  const sf = useServerSortFilter(TABLE_KEYS.approvalsPrPo, () => setPage(1));

  const list = useApprovalInboxList({
    section,
    search: q,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  const rows = useMemo(() => list.data?.items ?? [], [list.data?.items]);
  const total = list.data?.total ?? 0;
  useClampPage(page, list.data?.total, setPage);
  // Amount is null when the caller's access hides prices — then the column goes.
  const showAmount = rows.some((r) => r.docAmount != null);
  const columns = useMemo(() => prPoColumns(section, showAmount), [section, showAmount]);
  const filtering = q !== undefined || sf.filtering;

  return (
    // `page-fill` (ADR-202): the inbox fills the content area and the TABLE is
    // the only thing that scrolls, so the column header and the section tabs
    // stay on screen down to the last row.
    <div className="page-fill">
      <ListHeader
        title={SECTION_TITLE[section]}
        icon="✅"
        count={list.isLoading ? undefined : total}
        noun={section === 'pr' ? 'request' : 'order'}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search number, vendor, item, raised by…"
        updating={list.isFetching && !list.isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setTerm('');
        }}
        filtersActive={term !== '' || sf.filtering}
      >
        {tabs}
      </ListHeader>

      {list.isError ? (
        <PageState state="error" message={list.error.message} />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.approvalsPrPo}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            sortFilterServer={sf}
            empty={filtering ? SECTION_NO_MATCH[section] : SECTION_EMPTY[section]}
            onRowClick={(r) => void navigate({ to: r.navPage })}
          />
        </Panel>
      )}
      <ListFooter
        total={total}
        noun={section === 'pr' ? 'request' : 'order'}
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={setPage}
      />
    </div>
  );
}
