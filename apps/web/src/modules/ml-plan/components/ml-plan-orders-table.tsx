// The Multi-Level Plan detail page's Orders tab (ADR-225 phase 4): every Plan /
// PR raised from the plan's rows, newest first as the server sends them.
// A deleted plan / cancelled PR stays listed with Live —.

import type { MlPlanNode, MlPlanOrder } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDateTime } from '@/lib/date';
import { StatusBadge } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';

const dash = <span className="text3">—</span>;

interface Props {
  orders: MlPlanOrder[];
  nodes: MlPlanNode[];
}

export function MlPlanOrdersTable({ orders, nodes }: Props): React.JSX.Element {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const columns: DataTableColumn<MlPlanOrder>[] = [
    {
      header: 'Doc No.',
      nowrap: true,
      render: (o) =>
        o.kind === 'plan' ? (
          <Link to="/plans/$id" params={{ id: o.docId }} className="td-code">
            {o.docCode}
          </Link>
        ) : (
          <Link to="/purchase-requests/$id" params={{ id: o.docId }} className="td-code">
            {o.docCode}
          </Link>
        ),
    },
    {
      header: 'Item Code',
      nowrap: true,
      render: (o) => {
        const code = byId.get(o.nodeId)?.itemCode;
        return code ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {code}
          </span>
        ) : (
          dash
        );
      },
    },
    {
      header: 'Level',
      align: 'right',
      className: 'mono',
      render: (o) => byId.get(o.nodeId)?.depth ?? dash,
    },
    {
      header: 'Qty',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (o) => String(Number(o.qty)),
    },
    {
      header: 'Status',
      nowrap: true,
      render: (o) => <StatusBadge kind={o.kind === 'plan' ? 'plan' : 'pr'} status={o.docStatus} />,
    },
    { header: 'Live', nowrap: true, render: (o) => (o.live ? '✓' : dash) },
    {
      header: 'Created',
      nowrap: true,
      className: 'mono',
      render: (o) => fmtDateTime(o.createdAt),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={orders}
      rowKey={(o) => `${o.kind}-${o.docId}`}
      density="compact"
      autoWidth
      emptyText="No orders."
    />
  );
}
