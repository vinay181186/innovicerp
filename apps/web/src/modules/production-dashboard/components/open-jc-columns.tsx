// Open Job Cards tab (legacy L3719-3799) — the card grid turned into ONE table
// (ADR-203 frozen header): one row per open job card with every fact the card
// showed — JC No., Item Code (CODE/REV), Item Name, Order Qty, the progress
// bar + %, Due Date and the Priority badge. The card's own click (open Op
// Entry for this card) is now the row's ⋯ menu item; the JC No. still opens
// the job card itself. Same endpoint and 25-row paging the cards used.

import type { ProductionDashboardJc } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { renderJcOpsLink } from '@/modules/jc-ops/components/jc-ops-columns';
import { ProgressBar, RowMenu } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';

/** done / total ops as a whole %, exactly as the card worked it out. */
export function jcProgressPct(jc: ProductionDashboardJc): number {
  return jc.totalOps > 0 ? Math.round((jc.doneOps / jc.totalOps) * 100) : 0;
}

export function openJcColumns(): DataTableColumn<ProductionDashboardJc>[] {
  return [
    {
      id: 'jc_no',
      header: 'JC No.',
      kind: 'code',
      nowrap: true,
      render: (jc) => (
        <Link
          to="/job-cards/$id"
          params={{ id: jc.jobCardId }}
          title="View job card status"
          className="mono fw-700 cyan"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {jc.code}
        </Link>
      ),
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      className: 'mono fw-700',
      nowrap: true,
      render: (jc) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(jc.itemCode, jc.itemRevision, '—')}
        </span>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (jc) => jc.itemName ?? '—',
      title: (jc) => jc.itemName ?? '',
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (jc) => jc.orderQty,
    },
    {
      id: 'progress',
      header: 'Progress',
      nowrap: true,
      render: (jc) => {
        const pct = jcProgressPct(jc);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
            <span style={{ flex: 1 }}>
              <ProgressBar value={pct} color="var(--blue)" label={`${pct}% of operations done`} />
            </span>
            <span className="mono text3">{pct}%</span>
          </span>
        );
      },
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (jc) => (jc.dueDate ? fmtDate(jc.dueDate) : '—'),
    },
    {
      // Legacy badge(jc.priority) (L3723): High → b-amber, Normal → b-grey.
      id: 'priority',
      header: 'Priority',
      kind: 'badge',
      nowrap: true,
      render: (jc) => (
        <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {jc.priority === 'high' ? 'High' : 'Normal'}
        </span>
      ),
    },
  ];
}

/** The card's click, now the row's ⋯: open Op Entry for this job card. */
export function OpenJcRowMenu({ jc }: { jc: ProductionDashboardJc }): React.JSX.Element {
  return (
    <RowMenu
      renderLink={renderJcOpsLink}
      items={[
        {
          key: 'op-entry',
          label: 'Op Entry',
          icon: 'play',
          group: 'workflow',
          to: `/op-entry?${new URLSearchParams({ jc: jc.code }).toString()}`,
        },
      ]}
    />
  );
}
