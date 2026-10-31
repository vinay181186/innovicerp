// Multi-Level Plan list columns (ADR-225 phase 3, ADR-199 fit table). Same
// shape as ml-bom/components/ml-bom-list-columns.tsx. Server Sort & Filter
// fields are the contract's: code, soCode, itemCode, itemName, planQty,
// status, mlBomCode, levels, nodeCount — a column outside that list has no ▾.

import { ML_PLAN_STATUSES, ML_PLAN_STATUS_LABEL, type MlPlanListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/ui/core';
import { leadColumns, type DataTableColumn } from '@/ui/data';

const STATUS_OPTIONS = ML_PLAN_STATUSES.map((v) => ({ value: v, label: ML_PLAN_STATUS_LABEL[v] }));

export function mlPlanListColumns(offset = 0): DataTableColumn<MlPlanListItem>[] {
  return [
    // Owner rule 2026-10-31 — the six lead columns first; Sr No, MLP No. and
    // every other fact follow Item Name.
    ...leadColumns<MlPlanListItem>({
      soNo: (p) => p.soCode,
      internalSoNo: (p) => p.soInternalNo,
      pol: (p) => p.clientPoLineNo,
      createdOn: (p) => p.createdAt,
      itemCode: (p) => p.itemCode,
      itemRev: (p) => p.itemRevision,
      itemName: (p) => p.itemName,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          render: (p) => (
            <Link
              to="/sales-orders/$id"
              params={{ id: p.salesOrderId }}
              className="mono"
              style={{ color: 'var(--blue)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              {p.soCode}
            </Link>
          ),
        },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      align: 'right',
      render: (_p, i) => offset + i + 1,
    },
    {
      id: 'code',
      sortFilterField: 'code',
      header: 'MLP No.',
      nowrap: true,
      render: (p) => (
        <Link
          to="/ml-plans/$id"
          params={{ id: p.id }}
          className="td-code"
          onClick={(e) => e.stopPropagation()}
        >
          {p.code}
        </Link>
      ),
    },
    {
      id: 'plan_qty',
      sortFilterField: 'planQty',
      filterType: 'num',
      header: 'Plan Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (p) => p.planQty,
    },
    {
      id: 'ml_bom_code',
      sortFilterField: 'mlBomCode',
      header: 'BOM No.',
      nowrap: true,
      render: (p) => (
        <Link
          to="/ml-boms/$id"
          params={{ id: p.mlBomId }}
          className="td-code"
          onClick={(e) => e.stopPropagation()}
        >
          {p.mlBomCode}
        </Link>
      ),
    },
    {
      id: 'ml_bom_revision',
      header: 'BOM Rev',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (p) => <span style={{ color: 'var(--cyan)' }}>{p.mlBomRevision}</span>,
    },
    {
      id: 'levels',
      sortFilterField: 'levels',
      filterType: 'num',
      header: 'Levels',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (p) => p.levels,
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'Status',
      nowrap: true,
      render: (p) => (
        <StatusBadge kind="doc" status={p.status} label={ML_PLAN_STATUS_LABEL[p.status]} />
      ),
    },
  ];
}
