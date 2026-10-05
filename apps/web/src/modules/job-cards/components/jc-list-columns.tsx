// Job Card list columns (ADR-199 fit table: one line per row, Item Code and
// Item Name split, Progress inline, Customer Dispatch Date its own column).
// Moved out of routes/list.tsx to keep that file from growing.

import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ItemImageBox, THUMBNAIL_COL_WIDTH } from '@/components/shared/item-badge';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { Badge, StatusBadge } from '@/ui/core';
import { ProgressBar, type DataTableColumn } from '@/ui/data';
import { JC_STATUS_LABEL } from './jc-status-badge';

/** Sort & Filter tick lists (server mode): stored value → the label shown. */
const JC_STATUS_OPTIONS = Object.entries(JC_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));
const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
];

/** A job is "done" when it has reached complete or closed — the Days Left
 *  column's rule. */
function isDone(jc: JobCardListItem): boolean {
  return jc.computedStatus === 'complete' || jc.computedStatus === 'closed';
}

/** Days from today until the due date (negative = late). null when there is no
 *  due date or the job is already done, so the column shows "—" instead of a
 *  meaningless countdown. */
export function daysLeftFor(jc: JobCardListItem, today: string): number | null {
  if (jc.dueDate == null || isDone(jc)) return null;
  const ms = Date.parse(jc.dueDate) - Date.parse(today);
  return Math.round(ms / 86_400_000);
}

/** The Days Left colour — late red, due within the working week amber, else
 *  green; muted when there is nothing to count down to. */
export function daysLeftColor(days: number | null): string {
  if (days == null) return 'var(--text3)';
  if (days < 0) return 'var(--red)';
  if (days <= 5) return 'var(--amber)';
  return 'var(--green)';
}

/** Where a job card's source document lives — the SO / JWSO link in the row. */
export function sourceRoute(link: NonNullable<JobCardListItem['sourceLink']>): {
  to: '/sales-orders/$id' | '/job-work-orders/$id';
  id: string;
} {
  return link.type === 'so'
    ? { to: '/sales-orders/$id', id: link.salesOrderId }
    : { to: '/job-work-orders/$id', id: link.jobWorkOrderId };
}

// The sheet's columns (ADR-199 table standard): every row is ONE line, the
// fit engine sizes the columns to the screen and moves the rightmost
// unpinned ones into ▸ when it is too narrow. Centred by the standard; only
// the Item Name is left-aligned.
export function jobCardListColumns(
  firstRowNo: number,
  today: string,
): DataTableColumn<JobCardListItem>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      render: (_jc, i) => firstRowNo + i,
    },
    {
      id: 'jc_code',
      sortFilterField: 'jcCode',
      header: 'JC No.',
      nowrap: true,
      render: (jc) => (
        <Link
          to="/job-cards/$id"
          params={{ id: jc.id }}
          className="td-code"
          style={{ color: 'var(--blue)', fontWeight: 800 }}
          onClick={(e) => e.stopPropagation()}
        >
          {jc.code}
        </Link>
      ),
    },
    {
      id: 'image',
      minWidth: 64,
      header: 'Image',
      width: THUMBNAIL_COL_WIDTH,
      // The picture fills the cell edge to edge, the gridlines being its
      // frame (user decision 2026-09-22 — the thumbnail column sits before
      // the item code · name on every list). The negative margins cancel the
      // sheet's own cell padding so the box reaches the rules;
      // `position: relative` is what `fill` pins itself to. ItemImageBox
      // stops its own click, so opening the picture never opens the row.
      render: (jc) => (
        <div
          style={{
            position: 'relative',
            // Exactly one row high (28px Comfortable / 22px Compact); the
            // fit table gives this cell no vertical padding, and the
            // negative side margins cancel its horizontal padding.
            height: 'calc(var(--tbl-row-h, 28px) - 1px)',
            margin: '0 calc(var(--tbl-pad-x, var(--sp-2)) * -1)',
          }}
        >
          <ItemImageBox
            imagePath={jc.itemImagePath}
            size="row"
            alt={jc.itemName || itemCodeWithRev(jc.itemCode, jc.itemRevision)}
            fill
          />
        </div>
      ),
    },
    {
      // The CUSTOMER's PO line no. (never our SO line no.), beside CODE/REV.
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      header: 'POL',
      width: '4%',
      nowrap: true,
      render: (jc) =>
        jc.clientPoLineNo ? (
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {jc.clientPoLineNo}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    // Item Code and Item Name are two one-line columns (ADR-199 table
    // standard: every row one line) — the code no longer stacks over the
    // name. CODE/REV: the revision is the customer's drawing revision off the
    // SO line (null -> the bare code, never a trailing slash).
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      nowrap: true,
      render: (jc) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {itemCodeWithRev(jc.itemCode, jc.itemRevision)}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (jc) => jc.itemName?.trim() || '—',
      title: (jc) => jc.itemName ?? '',
    },
    {
      id: 'source_code',
      sortFilterField: 'sourceCode',
      header: 'SO / JWSO No.',
      nowrap: true,
      render: (jc) => {
        const s = jc.sourceLink;
        if (!s) return <span className="text3">—</span>;
        const route = sourceRoute(s);
        return (
          <Link
            to={route.to}
            params={{ id: route.id }}
            className="mono"
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--blue)',
              textDecoration: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {s.code}
            {s.lineNo !== 1 ? <span>/{s.lineNo}</span> : null}
          </Link>
        );
      },
    },
    {
      // ADR-207 — the office's own number, its OWN column beside the system
      // SO / JWSO No. (owner decision 2026-10-05). Empty for a JWSO-sourced
      // card and for the older orders that never had one.
      id: 'so_internal_no',
      sortFilterField: 'soInternalNo',
      header: 'Internal SO No.',
      nowrap: true,
      render: (jc) => {
        const s = jc.sourceLink;
        const internal = s?.type === 'so' ? s.internalSoNo?.trim() : null;
        return internal ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {internal}
          </span>
        ) : (
          <span className="text3">—</span>
        );
      },
    },
    {
      id: 'order_qty',
      sortFilterField: 'orderQty',
      filterType: 'num',
      header: 'Order Qty',
      align: 'right',
      nowrap: true,
      render: (jc) => (
        <>
          <span className="mono fw-700">{jc.orderQty}</span>{' '}
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            Nos
          </span>
        </>
      ),
    },
    {
      id: 'progress',
      minWidth: 150,
      header: 'Progress',
      // Completed pieces at the LAST operation over the order qty — the
      // same figure the card view's Completed box shows. Bar and figures
      // side by side on ONE line (ADR-199).
      render: (jc) => {
        const done = jc.lastOpCompletedQty;
        const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--sp-1)',
              whiteSpace: 'nowrap',
            }}
          >
            <ProgressBar
              value={pct}
              color="var(--green)"
              label={`${done} of ${jc.orderQty} Completed`}
              style={{ width: 48, flex: '0 0 48px' }}
            />
            <span className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>
              {done} / {jc.orderQty} · {pct}%
            </span>
          </span>
        );
      },
    },
    {
      id: 'jc_status',
      sortFilterField: 'status',
      filterOptions: JC_STATUS_OPTIONS,
      kind: 'badge',
      header: 'JC Status',
      nowrap: true,
      render: (jc) => <StatusBadge kind="jc" status={jc.computedStatus} />,
    },
    {
      id: 'jc_date',
      sortFilterField: 'jcDate',
      kind: 'date',
      header: 'JC Date',
      className: 'mono',
      nowrap: true,
      render: (jc) => fmtDate(jc.jcDate),
    },
    {
      id: 'due_date',
      sortFilterField: 'dueDate',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (jc) => fmtDate(jc.dueDate),
    },
    {
      id: 'days_left',
      header: 'Days Left',
      align: 'right',
      nowrap: true,
      render: (jc) => {
        const dLeft = daysLeftFor(jc, today);
        return (
          <span className="mono fw-700" style={{ color: daysLeftColor(dLeft) }}>
            {dLeft == null ? '—' : dLeft}
          </span>
        );
      },
    },
    {
      // The plan's Customer Dispatch Date — its own column now (it used to
      // be a second line under Due Date). Last, so it is the first column
      // to move into ▸ on a narrow screen.
      id: 'customer_dispatch_date',
      sortFilterField: 'customerDispatchDate',
      kind: 'date',
      header: 'Customer Dispatch Date',
      className: 'mono text3',
      nowrap: true,
      title: () => 'Customer Dispatch Date (from the plan)',
      render: (jc) => (jc.customerDispatchDate ? fmtDate(jc.customerDispatchDate) : '—'),
    },
    // ── Hidden by default (ADR-199) — these ride in the ▸ detail row and can
    // be switched on from the Columns menu. The analysis asked for them as
    // extra, off-by-default columns so the one-line sheet stays uncluttered.
    {
      id: 'priority',
      sortFilterField: 'priority',
      filterType: 'list',
      filterOptions: PRIORITY_OPTIONS,
      header: 'Priority',
      nowrap: true,
      render: (jc) => {
        const high = jc.priority === 'high';
        return <Badge tone={high ? 'amber' : 'grey'}>{high ? 'High' : 'Normal'}</Badge>;
      },
    },
    {
      id: 'production_order_code',
      sortFilterField: 'productionOrderCode',
      header: 'Production Order No.',
      nowrap: true,
      render: (jc) =>
        jc.productionOrderId && jc.productionOrderCode ? (
          <Link
            to="/production-orders/$id"
            params={{ id: jc.productionOrderId }}
            className="mono"
            style={{ color: 'var(--blue)', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {jc.productionOrderCode}
          </Link>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      // Qty still owed on the card — order qty less what the last op has made.
      id: 'pending',
      header: 'Pending',
      align: 'right',
      nowrap: true,
      render: (jc) => {
        const pending = Math.max(0, jc.orderQty - jc.lastOpCompletedQty);
        return (
          <>
            <span
              className="mono fw-700"
              style={{ color: pending > 0 ? 'var(--blue)' : 'var(--green)' }}
            >
              {pending}
            </span>{' '}
            <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              Nos
            </span>
          </>
        );
      },
    },
    {
      // Operations finished over the total in the routing (e.g. 2/5).
      id: 'ops',
      header: 'Ops',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (jc) => `${jc.doneOps}/${jc.totalOps}`,
    },
    {
      // Operations with a live running session right now.
      id: 'running',
      header: 'Running',
      align: 'right',
      nowrap: true,
      title: () => 'Operations running now',
      render: (jc) =>
        jc.runningCount > 0 ? (
          <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
            ▶{jc.runningCount}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      // When the Job Card record was entered (IST day) — Sort & Filter can
      // pick a range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (jc) => fmtDate(jc.createdAt),
    },
    {
      id: 'remarks',
      sortFilterField: 'remarks',
      header: 'Remarks',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (jc) => jc.remarks?.trim() || '—',
      title: (jc) => jc.remarks ?? '',
    },
  ];
}

/** Columns off by default on the Job Cards sheet (ADR-199) — passed to the
 *  DataTable's `defaultHidden`. They stay reachable in ▸ / the Columns menu. */
export const JC_LIST_HIDDEN_COLUMNS = [
  'priority',
  'production_order_code',
  'pending',
  'ops',
  'running',
  'created_on',
  'remarks',
] as const;
