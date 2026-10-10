// PR / PO tab of Settings → Approvals (ADR-190), on the uniform approval shell.
//
// One line per document waiting for the signed-in user to approve, 25 a page,
// with search + Sort & Filter on the server over every waiting document
// (ADR-201). The visible row ✓ / ✗ call the document's EXISTING approve / reject
// endpoints IN-PAGE (never navigating away); the row still opens the document on
// click for the full context, and its ▸ shows a read-only summary from the
// inbox row.
//
// GAP: the inbox only lists what is WAITING, so there is no Approved / Rejected
// history list for PR / PO. Those two views render an informational empty state
// (the trail lives on each document's History tab) rather than inventing a
// backend call — reported to the owner.

import type { ApprovalInboxRow } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import {
  useApprovePurchaseOrder,
  useRejectPurchaseOrder,
} from '@/modules/purchase-orders/api';
import { useApprovePr, useRejectPr } from '@/modules/purchase-requests/api';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { approvalsKeys, useApprovalInboxList } from '../api';
import { ApprovalTab, type ApprovalView } from './approval-tab';
import { prPoColumns } from './pr-po-columns';

type Section = 'pr' | 'po';

const TITLE: Record<Section, string> = { pr: 'PR Approvals', po: 'PO Approvals' };
const NOUN: Record<Section, string> = { pr: 'request', po: 'order' };
const EMPTY_PENDING: Record<Section, string> = {
  pr: 'No Purchase Requests waiting for your approval.',
  po: 'No Purchase Orders waiting for your approval.',
};
const NO_MATCH: Record<Section, string> = {
  pr: 'No Purchase Requests match.',
  po: 'No Purchase Orders match.',
};

/** ₹ before GST, formatted like the amount column. */
const fmtAmount = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The ▸ read-only summary (requirement E): the document's figures from the
 *  inbox row — vendor, item, qty, amount, who raised it and when. */
function InboxSummary({ r, section }: { r: ApprovalInboxRow; section: Section }): React.JSX.Element {
  const items: Array<[string, React.ReactNode]> = [
    ['Vendor', r.vendorName ?? '—'],
    ['Item Code', r.itemCode ?? '—'],
    ['Item Name', r.itemName ?? '—'],
    [section === 'pr' ? 'PR Qty' : 'PO Qty', r.docQty == null ? '—' : r.docQty.toLocaleString('en-IN')],
    [
      section === 'pr' ? 'Est. Amount' : 'Subtotal',
      r.docAmount == null ? '—' : fmtAmount(r.docAmount),
    ],
    ['Raised By', r.createdByName ?? '—'],
    ['Raised On', fmtDate(r.createdAt)],
  ];
  return (
    <div
      style={{
        padding: 'var(--sp-2) var(--sp-3)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--sp-1) var(--sp-3)',
      }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 'var(--sp-1)', fontSize: 'var(--fs-sm)' }}>
          <span className="text3" style={{ minWidth: 86 }}>
            {label}
          </span>
          <span className="text2">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function InboxApprovalTab({
  section,
  pendingCount,
  tabs,
}: {
  section: Section;
  /** Waiting-queue size for this section — Pending option + tab badge. */
  pendingCount?: number | undefined;
  /** The Approvals page's fixed tab row, shown under the header. */
  tabs: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<ApprovalView>('pending');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const pending = view === 'pending';
  const list = useApprovalInboxList({
    section,
    search: q,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  // Only the pending queue has a list; Approved / Rejected have no backend here.
  const rows = useMemo(
    () => (pending ? (list.data?.items ?? []) : []),
    [pending, list.data?.items],
  );
  const total = list.data?.total ?? 0;
  useClampPage(page, pending ? list.data?.total : 0, setPage);
  // Amount is null when the caller's access hides prices — then the column goes.
  const showAmount = rows.some((r) => r.docAmount != null);
  const columns = useMemo(() => prPoColumns(section, showAmount), [section, showAmount]);

  // PR has no approve-remarks; PO's approve takes none here (business rules stay
  // on the server). Both rejects need a reason.
  const approvePr = useApprovePr();
  const rejectPr = useRejectPr();
  const approvePo = useApprovePurchaseOrder();
  const rejectPo = useRejectPurchaseOrder();
  const refreshInbox = (): void => {
    void qc.invalidateQueries({ queryKey: approvalsKeys.inbox() });
  };

  const toggleExpanded = (r: ApprovalInboxRow): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  };

  const viewCounts: Partial<Record<ApprovalView, number>> =
    pendingCount != null ? { pending: pendingCount } : {};

  return (
    <ApprovalTab<ApprovalInboxRow>
      tabs={tabs}
      title={TITLE[section]}
      noun={NOUN[section]}
      count={pending && !list.isLoading ? total : undefined}
      searchPlaceholder="Search number, vendor, item, raised by…"
      term={term}
      onSearch={setTerm}
      searching={q !== undefined || sf.filtering}
      updating={list.isFetching && !list.isLoading}
      view={view}
      onView={setView}
      viewCounts={viewCounts}
      onClearExtra={() => sf.clearFilters()}
      filtersActive={view !== 'pending' || term !== '' || sf.filtering}
      tableKey={TABLE_KEYS.approvalsPrPo}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={pending && list.isLoading}
      isError={pending && list.isError}
      errorMessage={list.error instanceof Error ? list.error.message : undefined}
      emptyPending={EMPTY_PENDING[section]}
      emptyDecided={`Decided ${section === 'pr' ? 'Purchase Requests' : 'Purchase Orders'} are not listed here — each document's History tab shows who approved or rejected it, and when.`}
      emptyNoMatch={NO_MATCH[section]}
      {...(pending ? { sortFilterServer: sf } : {})}
      renderExpanded={(r) => (expanded.has(r.id) ? <InboxSummary r={r} section={section} /> : null)}
      onToggleExpanded={toggleExpanded}
      onRowClick={(r) => void navigate({ to: r.navPage })}
      footer={
        pending ? (
          <ListFooter
            total={total}
            noun={NOUN[section]}
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPage}
          />
        ) : null
      }
      approveRow={async (r) => {
        if (section === 'pr') await approvePr.mutateAsync(r.id);
        else await approvePo.mutateAsync({ id: r.id });
        refreshInbox();
      }}
      rejectRow={async (r, reason) => {
        if (section === 'pr') await rejectPr.mutateAsync({ id: r.id, reason });
        else await rejectPo.mutateAsync({ id: r.id, reason });
        refreshInbox();
      }}
      rejectTitle={(r) => `Reject — ${r.docCode}`}
      rejectPrompt="Why is this rejected?"
    />
  );
}
