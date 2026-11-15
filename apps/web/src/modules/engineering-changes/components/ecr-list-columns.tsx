// Engineering Change list columns (ADR-291, ADR-199 fit table). Server Sort &
// Filter fields (the /ecrs sf column map): code, itemCode, fromLabel, toLabel,
// classification, status, approvalsDone, heldOps, createdAt, createdByName —
// a column outside that list has no ▾.

import {
  ECR_CLASSIFICATIONS,
  ECR_CLASSIFICATION_LABELS,
  ECR_STATUSES,
  ECR_STATUS_LABELS,
  type EcrListRow,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { createdByColumn, createdOnColumn, srNoColumn, type DataTableColumn } from '@/ui/data';
import { EcrStatusBadge } from './ecr-status-badge';

const dash = <span className="text3">—</span>;

const STATUS_OPTIONS = ECR_STATUSES.map((v) => ({ value: v, label: ECR_STATUS_LABELS[v] }));
const TYPE_OPTIONS = ECR_CLASSIFICATIONS.map((v) => ({
  value: v,
  label: ECR_CLASSIFICATION_LABELS[v],
}));

export function ecrListColumns(offset = 0): DataTableColumn<EcrListRow>[] {
  return [
    srNoColumn<EcrListRow>(offset + 1),
    {
      id: 'code',
      sortFilterField: 'code',
      kind: 'code',
      header: 'ECR No.',
      nowrap: true,
      render: (r) => (
        <Link
          to="/ecrs/$id"
          params={{ id: r.id }}
          className="td-code"
          onClick={(e) => e.stopPropagation()}
        >
          {r.code}
        </Link>
      ),
    },
    createdOnColumn<EcrListRow>((r) => r.createdAt, { sortFilterField: 'createdAt' }),
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }} title={r.itemName ?? ''}>
          {r.itemCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'from_rev',
      sortFilterField: 'fromLabel',
      kind: 'code',
      header: 'From Drawing Rev',
      className: 'mono',
      nowrap: true,
      render: (r) => r.fromLabel,
    },
    {
      id: 'to_rev',
      sortFilterField: 'toLabel',
      kind: 'code',
      header: 'To Drawing Rev / Replacement Item',
      className: 'mono',
      nowrap: true,
      render: (r) =>
        r.classification === 'non_interchangeable'
          ? (r.replacementItemCode ?? dash)
          : (r.toLabel ?? dash),
    },
    {
      id: 'change_type',
      sortFilterField: 'classification',
      filterType: 'list',
      filterOptions: TYPE_OPTIONS,
      kind: 'text',
      header: 'Change Type',
      nowrap: true,
      render: (r) => ECR_CLASSIFICATION_LABELS[r.classification],
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'ECR Status',
      nowrap: true,
      render: (r) => <EcrStatusBadge status={r.status} />,
    },
    {
      id: 'approvals',
      sortFilterField: 'approvalsDone',
      filterType: 'num',
      kind: 'num',
      header: 'Approvals',
      className: 'mono',
      nowrap: true,
      render: (r) => `${r.approvalsDone}/3`,
    },
    {
      id: 'held_ops',
      sortFilterField: 'heldOps',
      filterType: 'num',
      kind: 'num',
      header: 'Held Ops',
      className: 'mono',
      nowrap: true,
      render: (r) => r.heldOps,
    },
    createdByColumn<EcrListRow>({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdByName' },
    }),
  ];
}
