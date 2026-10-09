// Multi-Level Plan list columns (ADR-225 phase 3, ADR-199 fit table). Same
// shape as ml-bom/components/ml-bom-list-columns.tsx. Server Sort & Filter
// fields are the contract's: code, soCode, itemCode, itemName, planQty,
// status, mlBomCode, levels, nodeCount — a column outside that list has no ▾.

import { ML_PLAN_STATUSES, ML_PLAN_STATUS_LABEL, type MlPlanListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

const dash = <span className="text3">—</span>;

const STATUS_OPTIONS = ML_PLAN_STATUSES.map((v) => ({ value: v, label: ML_PLAN_STATUS_LABEL[v] }));

export function mlPlanListColumns(offset = 0): DataTableColumn<MlPlanListItem>[] {
  return [
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
      id: 'so_code',
      sortFilterField: 'soCode',
      header: 'SO No.',
      nowrap: true,
      render: (p) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: p.salesOrderId }}
          className="mono"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--blue)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {p.soCode}
        </Link>
      ),
    },
    {
      // ADR-207 — the office's own number, its own column beside the SO No.
      id: 'so_internal_no',
      header: 'Internal SO No.',
      nowrap: true,
      render: (p) =>
        p.soInternalNo?.trim() ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {p.soInternalNo}
          </span>
        ) : (
          dash
        ),
    },
    {
      // The CUSTOMER's PO line no. (never our SO line no.).
      id: 'client_po_line_no',
      header: 'POL',
      width: '4%',
      nowrap: true,
      render: (p) =>
        p.clientPoLineNo ? (
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {p.clientPoLineNo}
          </span>
        ) : (
          dash
        ),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      nowrap: true,
      // The item code is THE main thing on the row — strong, never --text3.
      render: (p) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {p.itemCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (p) => p.itemName ?? '—',
      title: (p) => p.itemName ?? '',
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
