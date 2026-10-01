// Machine-wise Pending Work (legacy L3670-3714 + L3780-3788). One card per
// machine; pending ops grouped from the machine-loading `ops` list (already
// server-sorted priority → due → op_seq, preserved within each group).
//
// Kept as a look-only WIDGET under ADR-199 ("widgets are look-only exceptions"):
// these per-machine mini-tables are NOT the main Ready-to-process list, so they
// stay as cards rather than becoming a fit table. Split out of routes/index.tsx
// (file-size rule); no behaviour change.

import type { MachineLoadOp } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { addDaysLocal, fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { OpStatusBadge } from './op-status-badge';

// IST today + 3 days (not the UTC date, which is a day behind before 05:30 IST).
const DUE_SOON_ISO = addDaysLocal(todayIst(), 3);

export function MachinePendingPanel({
  machines,
  ops,
  isLoading,
}: {
  machines: { machineId: string; machineCode: string; name: string }[];
  ops: MachineLoadOp[];
  isLoading: boolean;
}): React.JSX.Element {
  const opsByMachine = new Map<string, MachineLoadOp[]>();
  for (const op of ops) {
    if (!op.machineId) continue;
    const list = opsByMachine.get(op.machineId);
    if (list) list.push(op);
    else opsByMachine.set(op.machineId, [op]);
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Machine-wise Pending Work</span>
        <Link to="/job-queue" className="btn btn-ghost btn-sm">
          Full Queue →
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 12,
          padding: 14,
        }}
      >
        {isLoading && machines.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machine load…
          </div>
        ) : machines.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            No Machines yet.
          </div>
        ) : (
          machines.map((m) => (
            <MachineCard key={m.machineId} machine={m} ops={opsByMachine.get(m.machineId) ?? []} />
          ))
        )}
      </div>
    </div>
  );
}

function MachineCard({
  machine,
  ops,
}: {
  machine: { machineId: string; machineCode: string; name: string };
  ops: MachineLoadOp[];
}): React.JSX.Element {
  const label = (
    <div>
      <span className="mono fw-700 cyan" style={{ fontSize: 12 }}>
        {machine.machineCode}
      </span>
      {machine.name ? (
        <span className="text3" style={{ fontSize: 11, marginLeft: 6 }}>
          {machine.name}
        </span>
      ) : null}
    </div>
  );

  if (ops.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 14,
          background: 'var(--bg2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          {label}
          <span className="badge b-grey">Idle</span>
        </div>
        <div className="text3" style={{ fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
          No pending work
        </div>
      </div>
    );
  }

  const runCount = ops.filter((o) => o.computedStatus === 'running').length;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        background: 'var(--bg2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        {label}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="text3" style={{ fontSize: 11 }}>
            {ops.length} op{ops.length !== 1 ? 's' : ''}
          </span>
          {runCount > 0 ? (
            <span className="badge b-green">Running</span>
          ) : (
            <span className="badge b-amber">Pending</span>
          )}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>JC No.</th>
              <th>Item Code</th>
              <th>Operation</th>
              <th>Op Status</th>
              <th style={{ color: 'var(--amber2)' }}>Available</th>
              <th>Due Date</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const dueSoon = o.dueDate != null && o.dueDate <= DUE_SOON_ISO;
              return (
                <tr key={o.jcOpId}>
                  {/* The JC number opens that card. Colour and mono face are
                      inherited from the cell so the code looks exactly as it
                      did before it became reachable. */}
                  <td className="mono cyan" style={{ fontSize: 11 }}>
                    <Link
                      to="/job-cards/$id"
                      params={{ id: o.jobCardId }}
                      title="View job card status"
                      style={{
                        color: 'inherit',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {o.jobCardCode}
                    </Link>
                  </td>
                  <td
                    style={{
                      fontSize: 11,
                      maxWidth: 110,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {/* The cell is capped at 110px and ellipsised, so it holds one
                        token and no more. The code carries the drawing revision
                        the operator is being asked to check, so the code leads
                        and the name is only the fallback for a card with none. */}
                    {itemCodeWithRev(o.itemCode, o.itemRevision, o.itemName ?? '')}
                  </td>
                  <td style={{ fontSize: 11 }}>{o.operation}</td>
                  <td className="td-ctr">
                    <OpStatusBadge status={o.computedStatus} />
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--amber2)' }}>
                    {o.available}
                  </td>
                  <td
                    className="td-ctr"
                    style={{ fontSize: 11, color: dueSoon ? 'var(--red)' : 'var(--text3)' }}
                  >
                    {fmtDate(o.dueDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
