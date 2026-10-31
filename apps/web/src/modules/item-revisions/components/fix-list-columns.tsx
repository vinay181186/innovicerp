// Columns of the three Drawing Rev Fix List tabs (Phase D). Every code that
// has a page is a real link; a row click never fires through a link or a
// button (ItemRevLink / the action cell stop it).

import type {
  FixListLine,
  FixListRouteCard,
  FixListStock,
  RouteCardApprovalStatus,
} from '@innovic/shared';
import { ROUTE_CARD_APPROVAL_LABEL } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { RcApprovalBadge } from '@/modules/route-cards/components/rc-approval-badge';
import type { DataTableColumn } from '@/ui/data';

const dash = <span className="text3">—</span>;

const strong = (code: string): React.JSX.Element => (
  <span className="mono fw-700" style={{ color: 'var(--text)' }}>
    {code}
  </span>
);

function isRcStatus(s: string): s is RouteCardApprovalStatus {
  return s in ROUTE_CARD_APPROVAL_LABEL;
}

export function routeCardColumns(canEditRc: boolean): DataTableColumn<FixListRouteCard>[] {
  return [
    {
      id: 'rc_no',
      header: 'RC No.',
      kind: 'code',
      nowrap: true,
      render: (r) =>
        canEditRc ? (
          <Link
            to="/route-cards/$id/edit"
            params={{ id: r.routeCardId }}
            className="mono fw-700"
            title="Set Drawing Rev"
            onClick={(e) => e.stopPropagation()}
          >
            {r.routeCardCode}
          </Link>
        ) : (
          strong(r.routeCardCode)
        ),
    },
    { id: 'item_code', header: 'Item Code', nowrap: true, render: (r) => strong(r.itemCode) },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (r) => r.itemName ?? dash,
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'rc_status',
      header: 'RC Status',
      nowrap: true,
      render: (r) =>
        isRcStatus(r.approvalStatus) ? (
          <RcApprovalBadge status={r.approvalStatus} />
        ) : (
          r.approvalStatus
        ),
    },
    {
      // The Drawing Revs live order lines of this item carry — the hint for
      // which Rev the old card should get.
      id: 'line_revs',
      header: 'Drawing Rev on Order Lines',
      nowrap: true,
      className: 'mono',
      render: (r) => (r.lineRevs.length ? r.lineRevs.join(', ') : dash),
    },
    {
      id: 'action',
      header: '',
      nowrap: true,
      render: (r) =>
        canEditRc ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Link to="/route-cards/$id/edit" params={{ id: r.routeCardId }} className="btn btn-sm">
              Set Drawing Rev
            </Link>
          </div>
        ) : null,
    },
  ];
}

const REASON_LABEL: Record<FixListLine['reason'], string> = {
  conflict: 'Conflict',
  rev_zero: 'Rev 0',
};

export function lineColumns(): DataTableColumn<FixListLine>[] {
  return [
    { id: 'item_code', header: 'Item Code', nowrap: true, render: (r) => strong(r.itemCode) },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (r) => r.itemName ?? dash,
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'order_no',
      header: 'SO / JWSO No.',
      kind: 'code',
      nowrap: true,
      render: (r) =>
        r.source === 'SO' ? (
          <Link
            to="/sales-orders/$id"
            params={{ id: r.docId }}
            className="mono fw-700"
            onClick={(e) => e.stopPropagation()}
          >
            {r.docCode}
          </Link>
        ) : (
          <Link
            to="/job-work-orders/$id"
            params={{ id: r.docId }}
            className="mono fw-700"
            onClick={(e) => e.stopPropagation()}
          >
            {r.docCode}
          </Link>
        ),
    },
    {
      id: 'ln',
      header: 'Ln',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.lineNo,
    },
    { id: 'line_status', header: 'Order Status', nowrap: true, render: (r) => r.status },
    {
      id: 'drawing_rev',
      header: 'Drawing Rev',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => r.drawingRev,
    },
    {
      id: 'drawing',
      header: 'Drawing',
      nowrap: true,
      render: (r) => (r.hasDrawing ? 'Yes' : <span className="text3">No</span>),
    },
    {
      id: 'rc_no',
      header: 'RC No.',
      nowrap: true,
      className: 'mono',
      render: (r) => r.routeCardCode ?? dash,
    },
    {
      id: 'reason',
      header: 'Fix Reason',
      nowrap: true,
      render: (r) => REASON_LABEL[r.reason],
    },
  ];
}

export function stockColumns(
  canSetRev: boolean,
  onSetRev: (row: FixListStock) => void,
): DataTableColumn<FixListStock>[] {
  return [
    { id: 'item_code', header: 'Item Code', nowrap: true, render: (r) => strong(r.itemCode) },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (r) => r.itemName ?? dash,
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'on_hand',
      header: 'On Hand (no Rev)',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => r.onHandQty,
    },
    {
      id: 'known_revs',
      header: 'Known Drawing Revs',
      nowrap: true,
      className: 'mono',
      render: (r) => (r.knownRevs.length ? r.knownRevs.map((k) => k.drawingRev).join(', ') : dash),
    },
    {
      id: 'action',
      header: '',
      nowrap: true,
      render: (r) =>
        canSetRev ? (
          <div onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={r.knownRevs.length === 0}
              title={
                r.knownRevs.length === 0
                  ? 'No Drawing Rev is known for this item yet — name one on its SO line or Route Card first.'
                  : undefined
              }
              onClick={() => onSetRev(r)}
            >
              Set Rev
            </button>
          </div>
        ) : null,
    },
  ];
}
