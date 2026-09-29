// DocumentHistory — a document's own History tab (ADR-197).
//
// One line per action on THIS document: Log Date · Log Time · User (and the
// operator / inspector when it was someone else) · Action · Activity Qty ·
// Before → After · Reason. Rows come from GET /activity-log/history, newest
// first; the component is only the table — it owns no route and no write.
//
// Two ways to put it on a page (docs/AUDIT-TRAIL.md §"History tab"):
//   - a page with the Related Documents strip adds `useHistoryTab(...)` to
//     `extraTabs` — the tab hides itself while the document has no history;
//   - any other page renders <DocumentHistory entity entityId refId /> inside
//     its own <Panel title="History">.
//
// Legacy rows (before ADR-197) have no before → after list; their one-line
// `detail` is shown in that column instead, so old documents still read.

import type { ActivityChange, ActivityChangeValue, ActivityHistoryRow } from '@innovic/shared';
import type { RelatedDocsExtraTab } from '@/components/shared/related-docs-tabs';
import { fmtDateTime } from '@/lib/date';
import { useDocumentHistory, type DocumentHistoryTarget } from '@/modules/activity-log/api';
import { activityActionBadge } from '@/modules/activity-log/lib/activity-entity';
import { DataTable, EmptyState, type DataTableColumn } from '@/ui/data';

export type DocumentHistoryProps = DocumentHistoryTarget & {
  /** Copy for a document with no recorded actions yet. */
  emptyText?: string | undefined;
};

const QTY_FMT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

function showValue(v: ActivityChangeValue): string {
  if (v === null || v === '') return '—';
  if (typeof v === 'number') return QTY_FMT.format(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  // An ISO timestamp / date written raw by a caller without a `format`.
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return fmtDateTime(v);
  return v;
}

function ChangeList({ changes }: { changes: ActivityChange[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
      {changes.map((c) => (
        <div key={c.field}>
          <span className="fw-700">{c.label}</span>{' '}
          <span className="text3">{showValue(c.before)}</span>
          <span className="text3"> → </span>
          <span className="fw-700">{showValue(c.after)}</span>
        </div>
      ))}
    </div>
  );
}

const COLUMNS: DataTableColumn<ActivityHistoryRow>[] = [
  {
    header: 'Log Date',
    width: '10%',
    nowrap: true,
    className: 'mono',
    render: (r) => fmtDateTime(r.ts).split(' ')[0] ?? '—',
  },
  {
    header: 'Log Time',
    width: '7%',
    nowrap: true,
    className: 'mono',
    render: (r) => fmtDateTime(r.ts).split(' ')[1] ?? '',
  },
  {
    header: 'User',
    width: '16%',
    align: 'left',
    render: (r) => (
      <div>
        <div className="fw-700">{r.userFullName}</div>
        {r.operatorName && r.operatorName !== r.userFullName ? (
          <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            Operator: {r.operatorName}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    header: 'Action',
    width: '16%',
    render: (r) => (
      <div>
        <span className={`badge ${activityActionBadge(r.action)}`}>{r.actionLabel}</span>
        {r.lineRef || r.opRef ? (
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 2 }}>
            {[r.lineRef, r.opRef].filter(Boolean).join(' · ')}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    header: 'Activity Qty',
    width: '9%',
    nowrap: true,
    className: 'mono fw-700',
    render: (r) => (r.qty === null ? <span className="text3">—</span> : QTY_FMT.format(r.qty)),
  },
  {
    header: 'Before → After',
    width: '27%',
    align: 'left',
    render: (r) =>
      r.changes.length > 0 ? (
        <ChangeList changes={r.changes} />
      ) : r.detail ? (
        <span className="text2">{r.detail}</span>
      ) : (
        <span className="text3">—</span>
      ),
  },
  {
    header: 'Reason',
    width: '15%',
    align: 'left',
    render: (r) => (r.reason ? r.reason : <span className="text3">—</span>),
  },
];

export function DocumentHistory({
  entity,
  entityId,
  refId,
  emptyText = 'No activity recorded on this document yet.',
}: DocumentHistoryProps): React.JSX.Element {
  const { data, isLoading, isError, error } = useDocumentHistory({ entity, entityId, refId });

  if (isError) {
    return (
      <EmptyState tone="error">
        {error instanceof Error ? error.message : 'Could not load the history. Try again.'}
      </EmptyState>
    );
  }
  return (
    <DataTable
      columns={COLUMNS}
      rows={data?.rows ?? []}
      loading={isLoading}
      emptyText={emptyText}
    />
  );
}

/**
 * The History tab for a page that already shows the Related Documents strip:
 *
 *   const historyTab = useHistoryTab({ entity: 'PurchaseOrder', entityId: po.id, refId: po.code });
 *   <RelatedDocsTabs module="purchase-orders" id={po.id} extraTabs={[historyTab]} />
 *
 * `count` is the number of history rows — zero hides the tab, as for every
 * other extra tab. Shares its query with the tab body, so it is one request.
 */
export function useHistoryTab(target: DocumentHistoryTarget): RelatedDocsExtraTab {
  const { data } = useDocumentHistory(target);
  return {
    key: 'history',
    title: 'History',
    icon: '🕒',
    count: data?.rows.length ?? 0,
    render: () => <DocumentHistory {...target} />,
  };
}
