// Drawing Register (ADR-290) — the fit table's columns and the row ⋯ menu.
// One row per Item + Drawing Rev ("ABC/1"). Item Code carries the ABC/1 label,
// dark mono bold (item-code rule), and links to the drawing page. Sort &
// Filter field names are the row's own field names (server column map).

import {
  REV_RELEASE_STATUSES,
  REV_RELEASE_STATUS_LABELS,
  type DrawingRegisterRow,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ItemRevLink } from './item-rev-link';
import { RevStatusBadge } from './rev-status-badge';
import {
  revActionsFor,
  type RevActionChoice,
  type RevActionRights,
  type RevActionTarget,
} from './rev-status-actions';

const STATUS_OPTIONS = REV_RELEASE_STATUSES.map((v) => ({
  value: v,
  label: REV_RELEASE_STATUS_LABELS[v],
}));

const dash = <span className="text3">—</span>;

export function drawingRegisterColumns(firstRowNo: number): DataTableColumn<DrawingRegisterRow>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      filterable: false,
      render: (_r, i) => firstRowNo + i,
    },
    {
      // ADR-312 — every live SO / JWSO naming this Rev, newest first. The
      // first number opens its order; "+N" when there are more (all in the tooltip).
      id: 'so_no',
      header: 'SO No.',
      kind: 'code',
      nowrap: true,
      sortFilterField: 'orders',
      filterValue: (r) => r.orders.map((o) => o.code).join(', '),
      title: (r) => r.orders.map((o) => o.code).join(', '),
      render: (r) => {
        const first = r.orders[0];
        if (!first) return dash;
        const more = r.orders.length - 1;
        return (
          <>
            {first.kind === 'so' ? (
              <Link to="/sales-orders/$id" params={{ id: first.id }} className="td-code">
                {first.code}
              </Link>
            ) : (
              <Link to="/job-work-orders/$id" params={{ id: first.id }} className="td-code">
                {first.code}
              </Link>
            )}
            {more > 0 ? <span className="text3"> +{more}</span> : null}
          </>
        );
      },
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      sortFilterField: 'itemCode',
      filterValue: (r) => r.label,
      render: (r) => <ItemRevLink itemRevisionId={r.id} label={r.label} />,
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      ellipsis: true,
      sortFilterField: 'itemName',
      title: (r) => r.itemName ?? '',
      render: (r) => r.itemName ?? dash,
    },
    {
      id: 'customer_part_no',
      header: 'Customer Part No.',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      sortFilterField: 'customerPartNo',
      render: (r) => r.customerPartNo ?? dash,
    },
    {
      id: 'drawing_no',
      header: 'Drawing No.',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      sortFilterField: 'drawingNo',
      render: (r) => r.drawingNo ?? dash,
    },
    {
      id: 'drawing_file',
      header: 'Drawing File',
      kind: 'badge',
      nowrap: true,
      filterable: false,
      render: (r) =>
        r.hasFile ? (
          <span className="green fw-700" title="Drawing on file">
            ✓
          </span>
        ) : (
          <span className="text3" title="Not uploaded">
            —
          </span>
        ),
    },
    {
      id: 'release_status',
      header: 'Drawing Rev Status',
      kind: 'badge',
      nowrap: true,
      sortFilterField: 'releaseStatus',
      filterType: 'list',
      filterOptions: STATUS_OPTIONS,
      filterValue: (r) => REV_RELEASE_STATUS_LABELS[r.releaseStatus],
      render: (r) => <RevStatusBadge status={r.releaseStatus} />,
    },
    {
      id: 'released_on',
      header: 'Released On',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      sortFilterField: 'releasedAt',
      render: (r) => fmtDate(r.releasedAt),
    },
    {
      id: 'released_by',
      header: 'Released By',
      kind: 'text',
      ellipsis: true,
      sortFilterField: 'releasedByName',
      title: (r) => r.releasedByName ?? '',
      render: (r) => r.releasedByName ?? dash,
    },
    {
      id: 'open_lines',
      header: 'Open Lines',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      sortFilterField: 'openLines',
      filterType: 'num',
      render: (r) => r.openLines,
    },
    {
      id: 'open_job_cards',
      header: 'Open Job Cards',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      sortFilterField: 'openJobCards',
      filterType: 'num',
      render: (r) => r.openJobCards,
    },
    {
      id: 'pending_correction',
      header: 'Correction Waiting',
      kind: 'badge',
      nowrap: true,
      filterable: false,
      render: (r) =>
        r.pendingCorrection ? (
          <span className="amber fw-700" title="A drawing correction waits for approval">
            ● Waiting
          </span>
        ) : (
          dash
        ),
    },
  ];
}

export function registerRowTarget(r: DrawingRegisterRow): RevActionTarget {
  return {
    id: r.id,
    label: r.label,
    releaseStatus: r.releaseStatus,
    updatedAt: r.updatedAt,
    hasFile: r.hasFile,
  };
}

/** The row's ⋯ menu — only what this user may do and the status allows. */
export function drawingRegisterRowMenu(
  r: DrawingRegisterRow,
  opts: {
    rights: RevActionRights;
    onAction: (row: DrawingRegisterRow, choice: RevActionChoice) => void;
    onReplace: (row: DrawingRegisterRow) => void;
  },
): RowMenuItem[] {
  const { rights, onAction, onReplace } = opts;
  const danger = (c: RevActionChoice): boolean => c.action === 'reject' || c.action === 'obsolete';
  return [
    { key: 'open', label: 'Open drawing page', icon: 'eye', to: `/drawings/${r.id}` },
    ...revActionsFor(registerRowTarget(r), rights).map<RowMenuItem>((c) => ({
      key: c.action,
      label: c.label,
      group: danger(c) ? 'danger' : 'workflow',
      disabledReason: c.disabledReason,
      onSelect: () => onAction(r, c),
    })),
    {
      key: 'replace',
      label: 'Replace drawing…',
      icon: 'upload',
      hidden: !rights.replace || !r.hasFile || r.releaseStatus === 'obsolete',
      onSelect: () => onReplace(r),
    },
  ];
}
