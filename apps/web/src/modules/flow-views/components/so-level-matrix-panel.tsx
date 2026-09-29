// SO detail page — the Level Matrix (requirement 3.5, Problem 2.4). READ-ONLY.
//
// One row per SO line (Order Qty · Dispatched · Billed · status); ▸ opens the
// line through every level below it:
//   Plan(s)              Plan Qty · Covered · Pending · status
//   Production Order(s)  Order Qty · Credited Qty · Lost Qty · Pending · status
//   Job Card(s)          status · each op's Input → Passed On · the OSP PR /
//                        PO / DC / GRN codes with their status
// Every code is a link. The figures come from GET /flow-views/sales-orders/:id/
// level-matrix, which reads the same plan-coverage fragments and production
// order rule the Plans and Production Order screens use.
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatusBadge, type StatusKind } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useLevelMatrix } from '../api';
import type {
  LevelJobCard,
  LevelOspDoc,
  LevelPlan,
  LevelProductionOrder,
  LevelSoLine,
} from '../types';

const LINK_STYLE: React.CSSProperties = { color: 'var(--cyan)', textDecoration: 'none' };
const LINK_CLASS = 'mono fw-700';

function N({ v, tone }: { v: number; tone?: string }): React.JSX.Element {
  return (
    <span
      className="mono"
      style={v === 0 ? { color: 'var(--text3)' } : tone ? { color: tone } : undefined}
    >
      {v}
    </span>
  );
}

const OSP_LABEL: Record<LevelOspDoc['kind'], string> = { pr: 'PR', po: 'PO', dc: 'DC', grn: 'GRN' };
const OSP_BADGE: Record<LevelOspDoc['kind'], StatusKind> = {
  pr: 'pr',
  po: 'po',
  dc: 'dc',
  grn: 'grnqc',
};

function OspLink({ d }: { d: LevelOspDoc }): React.JSX.Element {
  const p = { params: { id: d.id }, className: LINK_CLASS, style: LINK_STYLE };
  switch (d.kind) {
    case 'pr':
      return (
        <Link to="/purchase-requests/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'po':
      return (
        <Link to="/purchase-orders/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'dc':
      return (
        <Link to="/delivery-challans/$id" {...p}>
          {d.code}
        </Link>
      );
    default:
      return (
        <Link to="/goods-receipt-notes/$id" {...p}>
          {d.code}
        </Link>
      );
  }
}

// ─── Level tables (inside an opened SO line) ────────────────────────────────

const PLAN_COLUMNS: DataTableColumn<LevelPlan>[] = [
  {
    header: 'Plan No',
    nowrap: true,
    render: (p) => (
      <Link to="/plans/$id" params={{ id: p.id }} className={LINK_CLASS} style={LINK_STYLE}>
        {p.code}
      </Link>
    ),
  },
  { header: 'Plan Qty', align: 'right', nowrap: true, render: (p) => <N v={p.planQty} /> },
  {
    header: 'Covered',
    align: 'right',
    nowrap: true,
    title: () => 'Qty of the plan already on Production Orders',
    render: (p) => <N v={p.coveredQty} />,
  },
  {
    header: 'Pending',
    align: 'right',
    nowrap: true,
    headColor: 'var(--red)',
    render: (p) => <N v={p.pendingQty} tone="var(--red2)" />,
  },
  {
    header: 'Plan Status',
    nowrap: true,
    render: (p) =>
      p.derivedStatus ? (
        <StatusBadge kind="planderived" status={p.derivedStatus} />
      ) : (
        <StatusBadge kind="plan" status={p.planStatus} />
      ),
  },
];

function orderColumns(planCode: Map<string, string>): DataTableColumn<LevelProductionOrder>[] {
  return [
    {
      header: 'Production Order No',
      nowrap: true,
      render: (o) => (
        <Link
          to="/production-orders/$id"
          params={{ id: o.id }}
          className={LINK_CLASS}
          style={LINK_STYLE}
        >
          {o.code}
        </Link>
      ),
    },
    {
      header: 'Plan No',
      nowrap: true,
      className: 'mono',
      render: (o) => planCode.get(o.planId) ?? '—',
    },
    { header: 'Order Qty', align: 'right', nowrap: true, render: (o) => <N v={o.orderQty} /> },
    {
      header: 'Credited Qty',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (o) => <N v={o.creditedQty} tone="var(--green2)" />,
    },
    {
      header: 'Lost Qty',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      render: (o) => <N v={o.lostQty} tone="var(--red2)" />,
    },
    {
      header: 'Pending',
      align: 'right',
      nowrap: true,
      title: () => 'Order Qty − Credited Qty while the order is open; 0 once it is closed',
      render: (o) => <N v={o.pendingQty} />,
    },
    {
      header: 'Order Status',
      nowrap: true,
      render: (o) => <StatusBadge kind="prodorder" status={o.status} />,
    },
  ];
}

function jobCardColumns(orderCode: Map<string, string>): DataTableColumn<LevelJobCard>[] {
  return [
    {
      header: 'Job Card No',
      nowrap: true,
      render: (j) => (
        <Link to="/job-cards/$id" params={{ id: j.id }} className={LINK_CLASS} style={LINK_STYLE}>
          {j.code}
        </Link>
      ),
    },
    {
      header: 'Production Order No',
      nowrap: true,
      className: 'mono',
      render: (j) => (j.productionOrderId ? (orderCode.get(j.productionOrderId) ?? '—') : '—'),
    },
    { header: 'Order Qty', align: 'right', nowrap: true, render: (j) => <N v={j.orderQty} /> },
    {
      header: 'JC Status',
      nowrap: true,
      render: (j) => <StatusBadge kind="jc" status={j.status} />,
    },
    {
      header: 'Operations (Input → Passed On)',
      align: 'left',
      render: (j) =>
        j.ops.length === 0 ? (
          <span className="text3">No operations</span>
        ) : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {j.ops.map((o) => (
              <span key={o.opSeq} style={{ whiteSpace: 'nowrap' }} title={o.operation}>
                <span className="mono fw-700">{fmtOpSrNo(o.opSeq)}</span>{' '}
                <span className="mono">
                  {o.inputQty} → {o.passedOnQty}
                </span>{' '}
                <StatusBadge kind="jcop" status={o.status} />
              </span>
            ))}
          </span>
        ),
    },
    {
      header: 'OSP Documents',
      align: 'left',
      render: (j) =>
        j.ospDocs.length === 0 ? (
          <span className="text3">—</span>
        ) : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {j.ospDocs.map((d) => (
              <span key={`${d.kind}-${d.id}`} style={{ whiteSpace: 'nowrap' }}>
                <span className="text3">{OSP_LABEL[d.kind]}</span> <OspLink d={d} />{' '}
                <StatusBadge kind={OSP_BADGE[d.kind]} status={d.status} />
              </span>
            ))}
          </span>
        ),
    },
  ];
}

function LevelHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="fw-700"
      style={{ fontSize: 12, color: 'var(--blue2)', margin: 'var(--sp-2) 0 var(--sp-1)' }}
    >
      {children}
    </div>
  );
}

function LineLevels({ line }: { line: LevelSoLine }): React.JSX.Element {
  const planCode = useMemo(() => new Map(line.plans.map((p) => [p.id, p.code])), [line.plans]);
  const orderCode = useMemo(
    () => new Map(line.productionOrders.map((o) => [o.id, o.code])),
    [line.productionOrders],
  );
  return (
    <div style={{ padding: 'var(--sp-1) var(--sp-3) var(--sp-3)' }}>
      <LevelHeading>Plans ({line.plans.length})</LevelHeading>
      <DataTable<LevelPlan>
        columns={PLAN_COLUMNS}
        rows={line.plans}
        density="compact"
        autoWidth
        emptyText="No plan on this line yet."
      />
      <LevelHeading>Production Orders ({line.productionOrders.length})</LevelHeading>
      <DataTable<LevelProductionOrder>
        columns={orderColumns(planCode)}
        rows={line.productionOrders}
        density="compact"
        autoWidth
        emptyText="No Production Order yet."
      />
      <LevelHeading>Job Cards ({line.jobCards.length})</LevelHeading>
      <DataTable<LevelJobCard>
        columns={jobCardColumns(orderCode)}
        rows={line.jobCards}
        density="compact"
        autoWidth
        emptyText="No Job Card yet."
      />
    </div>
  );
}

// ─── The SO-line sheet ───────────────────────────────────────────────────────

function lineColumns(
  expanded: Set<string>,
  toggle: (id: string) => void,
): DataTableColumn<LevelSoLine>[] {
  return [
    {
      header: '',
      nowrap: true,
      stopRowClick: true,
      render: (l) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={expanded.has(l.id)}
          title={expanded.has(l.id) ? 'Hide levels' : 'Show every level of this line'}
          onClick={() => toggle(l.id)}
        >
          {expanded.has(l.id) ? '▾' : '▸'}
        </button>
      ),
    },
    {
      header: 'Ln',
      nowrap: true,
      className: 'mono',
      render: (l) => <span style={{ color: 'var(--blue)' }}>{l.lineNo}</span>,
    },
    {
      header: 'POL',
      nowrap: true,
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.clientPoLineNo ?? '—'}</span>,
    },
    {
      header: 'Item Code',
      nowrap: true,
      align: 'left',
      render: (l) => (
        <span>
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {l.itemCode ?? '—'}
          </span>{' '}
          <span className="text3">{l.partName}</span>
        </span>
      ),
    },
    { header: 'Order Qty', align: 'right', nowrap: true, render: (l) => <N v={l.orderQty} /> },
    {
      header: 'Dispatched',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (l) => <N v={l.dispatchedQty} tone="var(--green2)" />,
    },
    { header: 'Billed', align: 'right', nowrap: true, render: (l) => <N v={l.billedQty} /> },
    {
      header: 'Plans / Orders / JCs',
      nowrap: true,
      className: 'mono',
      render: (l) => `${l.plans.length} / ${l.productionOrders.length} / ${l.jobCards.length}`,
    },
    {
      header: 'Line Status',
      nowrap: true,
      render: (l) =>
        l.shortClosedAt ? (
          <StatusBadge kind="doc" status="short_closed" label="Short Closed" />
        ) : (
          <StatusBadge kind="so" status={l.status} />
        ),
    },
  ];
}

export function SoLevelMatrixPanel({ salesOrderId }: { salesOrderId: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useLevelMatrix(salesOrderId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const lines = data?.lines ?? [];
  const allOpen = lines.length > 0 && lines.every((l) => expanded.has(l.id));
  return (
    <Panel
      title="Level Matrix"
      bodyPadding="none"
      actions={
        lines.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(lines.map((l) => l.id)))}
          >
            {allOpen ? '⤡ Collapse All' : '⤢ Expand All'}
          </button>
        ) : null
      }
    >
      {isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load the level matrix.'}
        </div>
      ) : (
        <DataTable<LevelSoLine>
          columns={lineColumns(expanded, toggle)}
          rows={lines}
          loading={isLoading}
          autoWidth
          emptyText="No lines on this SO yet."
          renderExpanded={(l) => (expanded.has(l.id) ? <LineLevels line={l} /> : null)}
        />
      )}
    </Panel>
  );
}
