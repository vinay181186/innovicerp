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

import type { ApprovalInboxRow } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useApprovalInbox } from '../api';
import { LogEntryApprovals } from '../components/log-entry-approvals';
import { prPoColumns } from '../components/pr-po-columns';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

type Section = 'pr' | 'po' | 'logEntry';

const SECTION_LABEL: Record<Section, string> = {
  pr: 'PR',
  po: 'PO',
  logEntry: 'Op Entry',
};

const SECTION_TITLE: Record<Section, string> = {
  pr: 'PR Approvals',
  po: 'PO Approvals',
  logEntry: 'Op Entry Approvals',
};

const SECTION_EMPTY: Record<Section, string> = {
  pr: 'No Purchase Requests waiting for your approval.',
  po: 'No Purchase Orders waiting for your approval.',
  logEntry: 'Nothing pending approval.',
};

const SECTION_NO_MATCH: Record<Exclude<Section, 'logEntry'>, string> = {
  pr: 'No Purchase Requests match.',
  po: 'No Purchase Orders match.',
};

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canDecideLogEntry = me?.role === 'admin' || me?.role === 'manager';
  const inbox = useApprovalInbox({ refetchOnMount: 'always' });
  const counts = inbox.data?.counts;

  const sections: Section[] = canDecideLogEntry ? ['pr', 'po', 'logEntry'] : ['pr', 'po'];
  // Until the user picks one, open the first section that has something
  // waiting (PR first), so the page lands on work rather than an empty list.
  const [picked, setPicked] = useState<Section | null>(null);
  const section: Section =
    picked ?? (counts ? (sections.find((s) => counts[s] > 0) ?? 'pr') : 'pr');

  const tabs = (
    <div role="tablist" aria-label="Approval type" style={{ display: 'flex', gap: 'var(--sp-1)' }}>
      {sections.map((s) => {
        const on = s === section;
        const n = counts?.[s];
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

  return (
    <InboxSection
      key={section}
      section={section}
      rows={inbox.data?.[section] ?? []}
      loading={inbox.isLoading}
      error={inbox.isError ? inbox.error : null}
      updating={inbox.isFetching && !inbox.isLoading}
      tabs={tabs}
    />
  );
}

function InboxSection({
  section,
  rows,
  loading,
  error,
  updating,
  tabs,
}: {
  section: Exclude<Section, 'logEntry'>;
  rows: ApprovalInboxRow[];
  loading: boolean;
  error: Error | null;
  updating: boolean;
  tabs: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const shown = rows.filter((r) =>
    matchesSearchTerm([r.docCode, r.vendorName, r.itemCode, r.itemName, r.createdByName], term),
  );
  // Amount is null when the caller's access hides prices — then the column goes.
  const showAmount = rows.some((r) => r.docAmount != null);
  const columns = useMemo(() => prPoColumns(section, showAmount), [section, showAmount]);

  return (
    // `page-fill` (ADR-201): the inbox fills the content area and the TABLE is
    // the only thing that scrolls, so the column header and the section tabs
    // stay on screen down to the last row.
    <div className="page-fill">
      <ListHeader
        title={SECTION_TITLE[section]}
        icon="✅"
        count={loading ? undefined : shown.length}
        noun={section === 'pr' ? 'request' : 'order'}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search number, vendor, item, raised by…"
        updating={updating}
      >
        {tabs}
      </ListHeader>

      {error ? (
        <PageState state="error" message={error.message} />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.approvalsPrPo}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            loading={loading}
            empty={term ? SECTION_NO_MATCH[section] : SECTION_EMPTY[section]}
            onRowClick={(r) => void navigate({ to: r.navPage })}
          />
        </Panel>
      )}
    </div>
  );
}
