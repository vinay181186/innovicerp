// Job Card page — two READ-ONLY flow panels (requirement 3.5, Problems 2.1/2.2):
//
//   Op Qty Flow   one row per op: Input · Completed · Accepted · Rejected ·
//                 Reworked Back · Lost · Sent to Vendor · Vendor Accepted ·
//                 Returned to Vendor · Re-received · At Vendor (ADR-206) ·
//                 Passed On · Available, plus which rule gives Passed On and
//                 where every reworked-back piece came from ("from rework NC-…").
//   Rework Tree   the card's top parent → -RW / -RP children → grandchildren,
//                 with the qty sent to each child, cleared and rejected again, and every
//                 NC raised on each card. Hidden when the card has no NC and no
//                 recovery child.
//
// Every figure comes from GET /flow-views/job-cards/:id/… — the server reads
// v_jc_op_status / op_log / nc_register; nothing is computed here.
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { StatusBadge } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { SectionBar } from '@/modules/job-cards/components/jc-view-summary';
import { useOpFlow, useReworkTree } from '../api';
import type { OpFlowRow, ReworkTreeNode } from '../types';

const LINK_STYLE: React.CSSProperties = { color: 'var(--cyan)', textDecoration: 'none' };

/** A qty cell: the number, or a quiet dash where the fact does not apply. */
function Qty({
  v,
  na = false,
  tone,
}: {
  v: number;
  na?: boolean;
  tone?: string;
}): React.JSX.Element {
  if (na) return <span className="text3">—</span>;
  return (
    <span
      className="mono"
      style={v === 0 ? { color: 'var(--text3)' } : tone ? { color: tone } : undefined}
    >
      {v}
    </span>
  );
}

function NcLink({ id, code }: { id: string; code: string }): React.JSX.Element {
  return (
    <Link to="/nc-register/$id" params={{ id }} className="mono fw-700" style={LINK_STYLE}>
      {code}
    </Link>
  );
}

const isQcOp = (o: OpFlowRow): boolean => o.qcRequired || o.opType === 'qc';

const OP_FLOW_COLUMNS: DataTableColumn<OpFlowRow>[] = [
  {
    header: 'Op',
    nowrap: true,
    className: 'mono fw-700',
    render: (o) => fmtOpSrNo(o.opSeq),
  },
  {
    header: 'Operation',
    align: 'left',
    ellipsis: true,
    render: (o) => o.operation,
    title: (o) => o.operation,
  },
  {
    header: 'Input',
    align: 'right',
    nowrap: true,
    title: () => 'What the previous op passed on (Order Qty on the first op)',
    render: (o) => <Qty v={o.inputQty} />,
  },
  {
    header: 'Completed',
    align: 'right',
    nowrap: true,
    render: (o) => <Qty v={o.completedQty} na={o.opType === 'qc'} />,
  },
  {
    header: 'Accepted',
    align: 'right',
    nowrap: true,
    headColor: 'var(--green)',
    render: (o) => <Qty v={o.qcAcceptedQty} na={!isQcOp(o)} tone="var(--green2)" />,
  },
  {
    header: 'Rejected',
    align: 'right',
    nowrap: true,
    headColor: 'var(--red)',
    title: (o) =>
      `Production Rejected ${o.productionRejectedQty} · QC Rejected ${o.qcRejectedQty}` +
      (o.hasOsp ? ` · Rejected at Incoming QC ${o.vendorRejectedQty}` : ''),
    render: (o) => (
      <Qty v={o.productionRejectedQty + o.qcRejectedQty + o.vendorRejectedQty} tone="var(--red2)" />
    ),
  },
  {
    header: 'Reworked Back',
    align: 'right',
    nowrap: true,
    title: (o) =>
      o.reworkedBackFrom.length > 0 ? `From rework ${o.reworkedBackFrom.join(', ')}` : 'None',
    render: (o) => <Qty v={o.reworkedBackQty} tone="var(--cyan)" />,
  },
  {
    header: 'Lost',
    align: 'right',
    nowrap: true,
    title: () =>
      'Written off on this op: scrap / make fresh, and pieces that failed rework or repair',
    render: (o) => <Qty v={o.lostQty} tone="var(--red2)" />,
  },
  {
    header: 'Sent to Vendor',
    align: 'right',
    nowrap: true,
    render: (o) => <Qty v={o.sentToVendorQty} na={!o.hasOsp} />,
  },
  {
    header: 'Vendor Accepted',
    align: 'right',
    nowrap: true,
    render: (o) => <Qty v={o.vendorAcceptedQty} na={!o.hasOsp} tone="var(--green2)" />,
  },
  {
    header: 'Returned to Vendor',
    align: 'right',
    nowrap: true,
    title: () => 'Rejected pieces sent back to the vendor on a return-to-vendor challan',
    render: (o) => <Qty v={o.returnedToVendorQty} na={!o.hasOsp} tone="var(--amber2)" />,
  },
  {
    header: 'Re-received',
    align: 'right',
    nowrap: true,
    title: () => 'Of the returned pieces, how many the vendor has sent back again',
    render: (o) => <Qty v={o.reReceivedQty} na={!o.hasOsp} />,
  },
  {
    header: 'At Vendor',
    align: 'right',
    nowrap: true,
    title: () => 'Pieces with the vendor right now',
    render: (o) => <Qty v={o.atVendorQty} na={!o.hasOsp} />,
  },
  {
    header: 'Passed On',
    align: 'right',
    nowrap: true,
    className: 'fw-700',
    title: (o) => o.passedOnRule,
    render: (o) => <Qty v={o.passedOnQty} />,
  },
  {
    header: 'Available',
    align: 'right',
    nowrap: true,
    title: (o) =>
      o.opType === 'qc'
        ? 'Pieces still to inspect at this QC op'
        : 'Pieces this op can work on now',
    render: (o) => <Qty v={o.availableQty} />,
  },
  {
    header: 'Op Status',
    nowrap: true,
    render: (o) => <StatusBadge kind="jcop" status={o.status} />,
  },
];

function OpFlowNotes({ ops }: { ops: OpFlowRow[] }): React.JSX.Element | null {
  const notes: React.ReactNode[] = [];
  for (const o of ops) {
    const op = `Op ${fmtOpSrNo(o.opSeq)}`;
    if (o.reworkedBackQty !== 0) {
      notes.push(
        <li key={`rw-${o.jcOpId}`}>
          {op}: {o.reworkedBackQty} pcs came back from rework{' '}
          {o.reworkedBackFrom.map((c, i) => (
            <span key={c} className="mono fw-700">
              {i > 0 ? ', ' : ''}
              {c}
            </span>
          ))}{' '}
          (entry LOG-NC-…) — counted in Completed{isQcOp(o) ? ' / Accepted' : ''}.
        </li>,
      );
    }
    if (o.ncs.length > 0) {
      notes.push(
        <li key={`nc-${o.jcOpId}`}>
          {op}: NC{' '}
          {o.ncs.map((n, i) => (
            <span key={n.id}>
              {i > 0 ? ', ' : ''}
              <NcLink id={n.id} code={n.code} /> <span className="mono">({n.qty})</span>
            </span>
          ))}
        </li>,
      );
    }
    if (o.reversedEntries > 0) {
      notes.push(
        <li key={`rv-${o.jcOpId}`}>
          {op}: {o.reversedEntries} reversed {o.reversedEntries === 1 ? 'entry' : 'entries'} —
          already taken out of every figure above.
        </li>,
      );
    }
  }
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 12, color: 'var(--text2)' }}>
      <div style={{ marginBottom: notes.length > 0 ? 'var(--sp-1)' : 0 }}>
        <b>Passed On</b> is what the next op receives as its Input: Accepted on a QC op or an op
        with QC · Vendor Accepted on an outsource op · Completed on a plain op. Hover a figure for
        its make-up.
      </div>
      {notes.length > 0 ? <ul style={{ margin: 0, paddingLeft: 18 }}>{notes}</ul> : null}
    </div>
  );
}

function OpFlowPanel({ jobCardId }: { jobCardId: string }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const { data, isLoading, isError, error } = useOpFlow(jobCardId, open);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <SectionBar title="Op Qty Flow" open={open} onToggle={() => setOpen((v) => !v)} />
      {open ? (
        isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load the op qty flow.'}
          </div>
        ) : (
          <>
            <DataTable<OpFlowRow>
              columns={OP_FLOW_COLUMNS}
              rows={data?.ops ?? []}
              rowKey={(o) => o.jcOpId}
              density="compact"
              autoWidth
              loading={isLoading}
              emptyText="No operations yet."
            />
            {data && data.ops.length > 0 ? <OpFlowNotes ops={data.ops} /> : null}
          </>
        )
      ) : null}
    </div>
  );
}

// ─── Rework tree ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { rework: 'Rework', repair: 'Repair' };

function reworkColumns(currentId: string): DataTableColumn<ReworkTreeNode>[] {
  return [
    {
      header: 'Job Card No',
      align: 'left',
      nowrap: true,
      render: (n) => (
        <span style={{ paddingLeft: n.depth * 18 }}>
          {n.depth > 0 ? <span className="text3">└ </span> : null}
          {n.jobCardId === currentId ? (
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {n.code} <span className="text3">(this card)</span>
            </span>
          ) : (
            <Link
              to="/job-cards/$id"
              params={{ id: n.jobCardId }}
              className="mono fw-700"
              style={LINK_STYLE}
            >
              {n.code}
            </Link>
          )}
        </span>
      ),
    },
    {
      header: 'Card Kind',
      nowrap: true,
      render: (n) => (n.recoveryKind ? (KIND_LABEL[n.recoveryKind] ?? n.recoveryKind) : 'Main'),
    },
    {
      header: 'From NC',
      nowrap: true,
      render: (n) =>
        n.fromNc ? (
          <>
            <NcLink id={n.fromNc.id} code={n.fromNc.code} />
            {n.originOpSeq != null ? (
              <span className="text3"> · Op {fmtOpSrNo(n.originOpSeq)}</span>
            ) : null}
          </>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      header: 'Sent',
      align: 'right',
      nowrap: true,
      title: () => 'Pieces sent to this card (its Order Qty)',
      render: (n) => <Qty v={n.fromNc?.sentQty ?? n.orderQty} />,
    },
    {
      header: 'Cleared',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      title: () => 'Accepted at QC after recovery — returned to the parent card',
      render: (n) => <Qty v={n.fromNc?.clearedQty ?? 0} na={!n.fromNc} tone="var(--green2)" />,
    },
    {
      header: 'Rejected Again',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      title: () => 'Rejected again at QC after recovery',
      render: (n) => <Qty v={n.fromNc?.failedQty ?? 0} na={!n.fromNc} tone="var(--red2)" />,
    },
    {
      header: 'JC Status',
      nowrap: true,
      render: (n) => <StatusBadge kind="jc" status={n.status} />,
    },
    {
      header: 'NCs on this card',
      align: 'left',
      render: (n) =>
        n.ncs.length === 0 ? (
          <span className="text3">—</span>
        ) : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {n.ncs.map((c) => (
              <span key={c.id} style={{ whiteSpace: 'nowrap' }}>
                <NcLink id={c.id} code={c.code} /> <span className="mono">{c.qty}</span>
                {c.opSeq != null ? (
                  <span className="text3"> · Op {fmtOpSrNo(c.opSeq)}</span>
                ) : null}{' '}
                <StatusBadge kind="ncdisp" status={c.disposition} />
              </span>
            ))}
          </span>
        ),
    },
  ];
}

function ReworkTreePanel({ jobCardId }: { jobCardId: string }): React.JSX.Element | null {
  const [open, setOpen] = useState(true);
  const { data } = useReworkTree(jobCardId);
  const nodes = data?.nodes ?? [];
  // Nothing to draw on a plain card with no NC and no recovery child.
  if (nodes.length <= 1 && nodes.every((n) => n.ncs.length === 0)) return null;
  const children = nodes.length - 1;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <SectionBar
        title={`Rework Tree${children > 0 ? ` (${children} rework / repair ${children === 1 ? 'card' : 'cards'})` : ''}`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open ? (
        <DataTable<ReworkTreeNode>
          columns={reworkColumns(jobCardId)}
          rows={nodes}
          rowKey={(n) => n.jobCardId}
          density="compact"
          autoWidth
        />
      ) : null}
    </div>
  );
}

/** Both panels, mounted once on the Job Card view (jc-status-view.tsx). */
export function JcFlowPanels({ jobCardId }: { jobCardId: string }): React.JSX.Element {
  return (
    <>
      <OpFlowPanel jobCardId={jobCardId} />
      <ReworkTreePanel jobCardId={jobCardId} />
    </>
  );
}
