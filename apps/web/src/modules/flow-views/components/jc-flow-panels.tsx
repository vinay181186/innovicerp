// Job Card page — two READ-ONLY flow panels (requirement 3.5, Problems 2.1/2.2):
//
//   Op Qty Flow   one reconciled row per op (ADR-212): Input · Done · Accepted ·
//                 Deviated (NC) · Reworked · Rejected · Pending · Sent · Received ·
//                 At Vendor · Check ✓, plus notes for NCs, rework loops and
//                 reversed entries. (Passed On removed: Accepted is what moves on.)
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
import type { OpFlowResponse, OpFlowRow, ReworkTreeNode } from '../types';

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

/** ADR-212 — the Op Qty Flow table. One reconciled row per op:
 *  Accepted + Rejected (final) + Deviated still open + At vendor + In QC +
 *  Pending = Input, so every row shows a Check ✓ (figures from the server; the
 *  screen only displays them). Vertical separators mark the logical groups. */
const SEP = 'vsep';
const doneLabel = (o: OpFlowRow): string =>
  o.opType === 'qc'
    ? 'Done = inspected'
    : o.opType === 'outsource'
      ? 'Done = received back'
      : 'Done = made';
const doneIcon = (o: OpFlowRow): string =>
  o.opType === 'qc' ? '🔬' : o.opType === 'outsource' ? '🚚' : '🏭';
const checkText = (o: OpFlowRow): string =>
  `${o.inputQty} in = ${o.acceptedQty} accepted + ${o.rejectedFinalQty} rejected + ` +
  `${o.deviatedOpenQty} deviated, NC open + ${o.atVendorQty} at vendor + ` +
  `${o.inQcQty} in QC + ${o.pendingQty} pending` +
  (o.unaccountedQty === 0 ? ' ✓' : ` — ${o.unaccountedQty} not accounted for`);

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
    title: (o) => o.operation,
    render: (o) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.operation}</div>
        <div className="text3" style={{ fontSize: 11 }}>
          {doneIcon(o)} {doneLabel(o)}
        </div>
      </div>
    ),
  },
  {
    header: 'Input',
    align: 'right',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    title: () => 'What the previous op passed on (Order Qty on the first op)',
    render: (o) => <Qty v={o.inputQty} />,
  },
  {
    header: 'Done',
    align: 'right',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    title: doneLabel,
    render: (o) => <Qty v={o.doneQty} />,
  },
  {
    header: 'Accepted',
    align: 'right',
    nowrap: true,
    headColor: 'var(--green)',
    className: 'fw-700',
    title: () => 'Good pieces that move on to the next op',
    render: (o) => <Qty v={o.acceptedQty} tone="var(--green2)" />,
  },
  {
    header: 'Deviated (NC)',
    align: 'right',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    headColor: 'var(--amber2)',
    title: (o) =>
      `Failed inspection → NC for a decision. Production ${o.productionRejectedQty} · QC ${o.qcRejectedQty}` +
      (o.hasOsp ? ` · Incoming QC ${o.vendorRejectedQty}` : ''),
    render: (o) => <Qty v={o.deviatedQty} tone="var(--amber2)" />,
  },
  {
    header: 'Reworked',
    align: 'right',
    nowrap: true,
    title: () =>
      'Deviated pieces an NC recovered (rework / repair / use as is / return to vendor) and that were accepted',
    render: (o) => <Qty v={o.reworkedQty} tone="var(--cyan)" />,
  },
  {
    header: 'Rejected',
    align: 'right',
    nowrap: true,
    headColor: 'var(--red)',
    title: () => 'Final NC decision: scrap / make fresh, or failed rework / repair',
    render: (o) => <Qty v={o.rejectedFinalQty} tone="var(--red2)" />,
  },
  {
    header: 'Pending',
    align: 'right',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    title: (o) =>
      o.opType === 'qc'
        ? 'Still to inspect at this QC op'
        : o.opType === 'outsource'
          ? 'Not yet sent to the vendor'
          : 'Still to make at this op' +
            (o.qcRequired ? ' (plus made pieces waiting for its QC)' : ''),
    render: (o) => <Qty v={o.pendingQty} tone="var(--amber2)" />,
  },
  {
    header: 'Sent',
    align: 'right',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    title: (o) =>
      o.returnedToVendorQty > 0
        ? `${o.vendorSentQty - o.returnedToVendorQty} on outward DCs + ${o.returnedToVendorQty} re-sent for rework`
        : 'Sent on outward DCs',
    render: (o) => <Qty v={o.vendorSentQty} na={!o.hasOsp} />,
  },
  {
    header: 'Received',
    align: 'right',
    nowrap: true,
    title: (o) =>
      `Received back incl. re-received lots${o.inQcQty > 0 ? ` · ${o.inQcQty} waiting incoming QC` : ''}`,
    render: (o) => <Qty v={o.vendorReceivedQty} na={!o.hasOsp} />,
  },
  {
    header: 'At Vendor',
    align: 'right',
    nowrap: true,
    title: () => 'Pieces with the vendor right now',
    render: (o) => <Qty v={o.atVendorQty} na={!o.hasOsp} />,
  },
  {
    header: 'Check',
    align: 'center',
    nowrap: true,
    className: SEP,
    headClassName: SEP,
    title: checkText,
    render: (o) =>
      o.unaccountedQty === 0 ? (
        <span className="fw-700" style={{ color: 'var(--green2)' }}>
          ✓
        </span>
      ) : (
        <span className="fw-700 mono" style={{ color: 'var(--red2)' }}>
          ⚠ {o.unaccountedQty}
        </span>
      ),
  },
  {
    header: 'Op Status',
    nowrap: true,
    render: (o) => <StatusBadge kind="jcop" status={o.status} />,
  },
];

const OP_FLOW_GROUPS = [
  { span: 2 },
  { span: 7, label: 'At this operation', className: SEP },
  { span: 3, label: 'With vendor (outsource)', color: 'var(--purple2)', className: SEP },
  { span: 2, className: SEP },
];

function OpFlowNotes({
  ops,
  check,
}: {
  ops: OpFlowRow[];
  check?: OpFlowResponse['jobCardCheck'] | undefined;
}): React.JSX.Element | null {
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
          (entry LOG-NC-…) — counted in Done and Accepted.
        </li>,
      );
    }
    if (o.returnedToVendorQty > 0) {
      notes.push(
        <li key={`rtv-${o.jcOpId}`}>
          {op}: rework loop — sent {o.vendorSentQty - o.returnedToVendorQty}, {o.vendorRejectedQty}{' '}
          deviated at incoming QC, {o.returnedToVendorQty} re-sent to the vendor, {o.reReceivedQty}{' '}
          re-received · total sent {o.vendorSentQty}, received {o.vendorReceivedQty}, accepted{' '}
          {o.acceptedQty}.
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
      {check ? (
        <div style={{ marginBottom: 'var(--sp-1)' }}>
          <b>Job Card check:</b> {check.ordered} ordered ={' '}
          <b style={{ color: 'var(--green2)' }}>{check.finished} finished</b> + {check.pending}{' '}
          pending + {check.inQc} in QC + {check.atVendor} at vendor + {check.deviatedOpen} deviated
          (NC open) + {check.rejected} rejected{' '}
          {check.unaccounted === 0 ? (
            <b style={{ color: 'var(--green2)' }}>✓</b>
          ) : (
            <b style={{ color: 'var(--red2)' }}>⚠ {check.unaccounted} not accounted for</b>
          )}
        </div>
      ) : null}
      <div style={{ marginBottom: notes.length > 0 ? 'var(--sp-1)' : 0 }}>
        <b>Deviated</b> = failed inspection, sent to an NC for a decision · <b>Reworked</b> = the NC
        recovered it and it was accepted · <b>Rejected</b> = the final NC decision. Hover ✓ for the
        row&apos;s sum.
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
              headGroups={OP_FLOW_GROUPS}
              rows={data?.ops ?? []}
              rowKey={(o) => o.jcOpId}
              density="compact"
              autoWidth
              loading={isLoading}
              emptyText="No operations yet."
            />
            {data && data.ops.length > 0 ? (
              <OpFlowNotes ops={data.ops} check={data.jobCardCheck} />
            ) : null}
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
