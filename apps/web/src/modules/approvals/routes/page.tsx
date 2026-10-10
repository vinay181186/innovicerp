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
//
// ADR-202: after the fixed PR · PO · Op Entry tabs, one tab is added PER
// DOCUMENT TYPE that has edits waiting — driven by GET /document-edits/counts
// (only types with pending > 0 come back). Each such tab renders
// <DocTypeApprovals> (its own Pending / Approved / Rejected views, per-change
// ✓/✗ that apply immediately). There is no combined "Edit Approvals" tab.

import type { DocumentEditEntity } from '@innovic/shared';
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
import { useDocumentEditCounts } from '@/modules/document-edits/api';
import { DocTypeApprovals } from '@/modules/document-edits/components/doc-type-approvals';
import { useApprovalInbox, useApprovalInboxList } from '../api';
import { LogEntryApprovals } from '../components/log-entry-approvals';
import { prPoColumns } from '../components/pr-po-columns';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

// The three fixed tabs. Edit-approval tabs are added dynamically, one per
// document type that has edits waiting (see DOC_TAB_PREFIX below).
type BaseSection = 'pr' | 'po' | 'logEntry';
/** A dynamic edit-approval tab, keyed `doc:<entity>`. */
const DOC_TAB_PREFIX = 'doc:';
type Section = BaseSection | `doc:${DocumentEditEntity}`;

const BASE_LABEL: Record<BaseSection, string> = {
  pr: 'PR',
  po: 'PO',
  logEntry: 'Op Entry',
};

// entity → the document's name on screen. Canonical names per docs/NAMING.md
// (section B documents + A-7: the buyer reads "Customer", field stays `client*`).
// Mirrors the server's HISTORY_ENTITY_LABEL, with the NAMING.md overrides.
const ENTITY_LABEL: Record<DocumentEditEntity, string> = {
  PurchaseOrder: 'Purchase Order',
  PurchaseRequest: 'Purchase Request',
  NonConformance: 'Non-Conformance',
  Plan: 'Plan',
  SalesOrder: 'Sales Order',
  JobWorkOrder: 'Job Work Order',
  GoodsReceiptNote: 'Goods Receipt Note',
  JobCard: 'Job Card',
  Dispatch: 'Dispatch',
  DeliveryChallan: 'Delivery Challan',
  PartyGrn: 'Party GRN',
  ProductionOrder: 'Production Order',
  Item: 'Item',
  Vendor: 'Vendor',
  Client: 'Customer',
  Machine: 'Machine',
  MachineGroup: 'Machine Group',
  Operator: 'Operator',
  CostCenter: 'Cost Center',
  TpiInspector: 'TPI Inspector',
  QcProcess: 'QC Process',
  MaterialGrade: 'Material Grade',
  MaterialSize: 'Material Size',
  Instrument: 'Instrument',
  BOM: 'BOM',
};

const SECTION_TITLE: Record<Exclude<BaseSection, 'logEntry'>, string> = {
  pr: 'PR Approvals',
  po: 'PO Approvals',
};

const SECTION_EMPTY: Record<Exclude<BaseSection, 'logEntry'>, string> = {
  pr: 'No Purchase Requests waiting for your approval.',
  po: 'No Purchase Orders waiting for your approval.',
};

const SECTION_NO_MATCH: Record<Exclude<BaseSection, 'logEntry'>, string> = {
  pr: 'No Purchase Requests match.',
  po: 'No Purchase Orders match.',
};

/** The document type behind a `doc:<entity>` section key. */
function docEntityOf(s: Section): DocumentEditEntity | null {
  return s.startsWith(DOC_TAB_PREFIX) ? (s.slice(DOC_TAB_PREFIX.length) as DocumentEditEntity) : null;
}

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canDecideLogEntry = me?.role === 'admin' || me?.role === 'manager';
  const inbox = useApprovalInbox({ refetchOnMount: 'always' });
  const counts = inbox.data?.counts;
  // Edit Approvals (ADR-202) — one tab per document type that has edits waiting,
  // with its pending count. The server returns only entities with pending > 0.
  const editCounts = useDocumentEditCounts();
  const editPendingByEntity = useMemo(() => {
    const m = new Map<DocumentEditEntity, number>();
    for (const c of editCounts.data?.counts ?? []) {
      if (c.pending > 0) m.set(c.entity, c.pending);
    }
    return m;
  }, [editCounts.data?.counts]);

  const baseSections: BaseSection[] = canDecideLogEntry ? ['pr', 'po', 'logEntry'] : ['pr', 'po'];
  // PR · PO · Op Entry, then one tab per document type with edits waiting.
  const sections: Section[] = useMemo(
    () => [
      ...baseSections,
      ...[...editPendingByEntity.keys()].map((e): Section => `${DOC_TAB_PREFIX}${e}`),
    ],
    [baseSections, editPendingByEntity],
  );
  // Count for one tab — PR / PO / Op Entry from the approval inbox, a doc-type
  // tab from the edit counts.
  const countFor = (s: Section): number | undefined => {
    const entity = docEntityOf(s);
    if (entity) return editPendingByEntity.get(entity);
    return counts?.[s as BaseSection];
  };
  // Until the user picks one, open the first section that has something
  // waiting (PR first), so the page lands on work rather than an empty list.
  const [picked, setPicked] = useState<Section | null>(null);
  const pickedStillShown = picked != null && sections.includes(picked);
  const section: Section = pickedStillShown
    ? picked
    : counts
      ? (sections.find((s) => (countFor(s) ?? 0) > 0) ?? 'pr')
      : 'pr';

  const tabs = (
    <div role="tablist" aria-label="Approval type" style={{ display: 'flex', gap: 'var(--sp-1)' }}>
      {sections.map((s) => {
        const on = s === section;
        const n = countFor(s);
        const entity = docEntityOf(s);
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={on}
            className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPicked(s)}
          >
            {entity ? ENTITY_LABEL[entity] : BASE_LABEL[s as BaseSection]}
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

  const entity = docEntityOf(section);
  if (entity) {
    return <DocTypeApprovals key={section} entity={entity} tabs={tabs} />;
  }

  return <InboxSection key={section} section={section as Exclude<BaseSection, 'logEntry'>} tabs={tabs} />;
}

function InboxSection({
  section,
  tabs,
}: {
  section: Exclude<BaseSection, 'logEntry'>;
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
