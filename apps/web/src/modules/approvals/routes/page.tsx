// Settings → Approvals — the things WAITING for a decision.
//
// Distinct from Approval Rules next to it in the menu, which holds the rules
// (which approvals are on, who may approve, the PO limit). This screen holds the
// queue.
//
// ONE UNIFORM structure for every document (owner decision). A FIXED tab row —
// PR · PO · SO · GRN · Job Card · Delivery Challan · NC · JWSO · Plan ·
// Production Order · Op Entry — is ALWAYS shown, whatever each has waiting (the
// old row vanished a tab the moment its count hit 0). Every tab renders through
// the one shared shell (components/approval-tab.tsx): ListHeader(search) + a
// Pending / Approved / Rejected filter + DataTable + a VISIBLE row ✓ / ✗ + a ▸
// read-only detail. So PR, PO, the edit tabs and Op Entry all look identical.
//
// Each tab's badge is its pending count (omitted at 0): PR / PO / Op Entry from
// the approval inbox (ADR-190), the edit tabs from GET /document-edits/counts
// (ADR-202, now per-status so the in-tab filter carries counts too).

import type { DocumentEditEntity } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDocumentEditCounts } from '@/modules/document-edits/api';
import { EditApprovalTab } from '@/modules/document-edits/components/doc-type-approvals';
import { useApprovalInbox } from '../api';
import { InboxApprovalTab } from '../components/inbox-approval-tab';
import { LogEntryApprovals } from '../components/log-entry-approvals';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

// The fixed tab set. Each tab is PR/PO (the approval inbox), Op Entry (op-log
// time corrections), or one enrolled edit document type. Labels per docs/NAMING.md
// (JWSO is the registered name for Job Work Order; Client → Customer, etc.).
type TabDef =
  | { key: 'pr' | 'po'; kind: 'inbox'; section: 'pr' | 'po'; label: string }
  | { key: 'logEntry'; kind: 'opEntry'; label: string }
  | { key: `doc:${DocumentEditEntity}`; kind: 'edit'; entity: DocumentEditEntity; label: string };

const EDIT_TAB = (entity: DocumentEditEntity, label: string): TabDef => ({
  key: `doc:${entity}`,
  kind: 'edit',
  entity,
  label,
});

// PR · PO · (edit documents) · Op Entry — the order the owner named. PR is the
// stable default (always present), so the page never has to index an array.
const PR_TAB: TabDef = { key: 'pr', kind: 'inbox', section: 'pr', label: 'PR' };

const FIXED_TABS: TabDef[] = [
  PR_TAB,
  { key: 'po', kind: 'inbox', section: 'po', label: 'PO' },
  EDIT_TAB('SalesOrder', 'SO'),
  EDIT_TAB('GoodsReceiptNote', 'GRN'),
  EDIT_TAB('JobCard', 'Job Card'),
  EDIT_TAB('DeliveryChallan', 'Delivery Challan'),
  EDIT_TAB('NonConformance', 'NC'),
  EDIT_TAB('JobWorkOrder', 'JWSO'),
  EDIT_TAB('Plan', 'Plan'),
  EDIT_TAB('ProductionOrder', 'Production Order'),
  { key: 'logEntry', kind: 'opEntry', label: 'Op Entry' },
];

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  // Op Entry corrections are decided by managers / admins only — the existing
  // permission gate is preserved (the inbox only counts them for those users).
  const canDecideLogEntry = me?.role === 'admin' || me?.role === 'manager';
  const inbox = useApprovalInbox({ refetchOnMount: 'always' });
  const counts = inbox.data?.counts;
  const editCounts = useDocumentEditCounts();
  const editPendingByEntity = useMemo(() => {
    const m = new Map<DocumentEditEntity, number>();
    for (const c of editCounts.data?.counts ?? []) m.set(c.entity, c.pending);
    return m;
  }, [editCounts.data?.counts]);

  // The Op Entry tab is shown only to the users who may decide it; every other
  // tab is always present regardless of its count.
  const tabDefs = useMemo(
    () => FIXED_TABS.filter((t) => t.kind !== 'opEntry' || canDecideLogEntry),
    [canDecideLogEntry],
  );

  const pendingFor = (t: TabDef): number | undefined => {
    if (t.kind === 'edit') return editPendingByEntity.get(t.entity);
    if (t.kind === 'opEntry') return counts?.logEntry;
    return counts?.[t.section];
  };

  // Until the user picks one, open the first tab that has something waiting (PR
  // first), so the page lands on work rather than an empty list.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedTab = tabDefs.find((t) => t.key === picked);
  const active: TabDef =
    pickedTab ??
    (counts ? tabDefs.find((t) => (pendingFor(t) ?? 0) > 0) : undefined) ??
    PR_TAB;

  const tabs = (
    <div role="tablist" aria-label="Approval type" style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
      {tabDefs.map((t) => {
        const on = t.key === active.key;
        const n = pendingFor(t);
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPicked(t.key)}
          >
            {t.label}
            {n != null && n > 0 ? (
              <span className="badge b-amber" style={{ marginLeft: 6 }}>
                {n}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  if (active.kind === 'opEntry') {
    return <LogEntryApprovals key="logEntry" pendingCount={counts?.logEntry} tabs={tabs} />;
  }
  if (active.kind === 'edit') {
    return <EditApprovalTab key={active.key} entity={active.entity} tabs={tabs} />;
  }
  return (
    <InboxApprovalTab
      key={active.key}
      section={active.section}
      pendingCount={counts?.[active.section]}
      tabs={tabs}
    />
  );
}
