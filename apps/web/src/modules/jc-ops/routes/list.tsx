// JC Operations — mirrors legacy renderJCOps (HTML L11349).

import {
  type ChangeJcOpMachineInput,
  type JcOpsBoardRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachinesList } from '../../machines/api';
import { useChangeJcOpMachine, useJcOpsBoard } from '../api';

export const jcOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jc-ops',
  component: JcOpsPage,
});

function JcOpsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [jcCode, setJcCode] = useState('');
  const [editRow, setEditRow] = useState<JcOpsBoardRow | null>(null);

  const { data, isLoading, isError, error } = useJcOpsBoard({
    jcCode: jcCode || undefined,
    limit: 1000,
    offset: 0,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">JC Operations</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="innovic-select"
            value={jcCode}
            onChange={(e) => setJcCode(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          >
            <option value="">All JC</option>
            {(data?.jcOptions ?? []).map((j) => (
              <option key={j.jcId} value={j.jcCode}>
                {j.jcCode}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">No operations defined</div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC No.</th>
                  <th>Item</th>
                  <th className="td-ctr">Op</th>
                  <th>Machine</th>
                  <th>Operation</th>
                  <th className="td-ctr">Cycle(h)</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    QC
                  </th>
                  <th className="td-ctr">Order</th>
                  <th className="td-ctr">Input</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Done
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                    Available
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>
                    Pend Hrs
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <Row key={o.jcOpId} o={o} canWrite={canWrite} onEdit={() => setEditRow(o)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {editRow ? (
        <ChangeMachineModal row={editRow} onClose={() => setEditRow(null)} />
      ) : null}
    </div>
  );
}

function Row({
  o,
  canWrite,
  onEdit,
}: {
  o: JcOpsBoardRow;
  canWrite: boolean;
  onEdit: () => void;
}): React.JSX.Element {
  const isOutsource = o.opType === 'outsource';
  const bg = isOutsource ? 'rgba(255,176,32,0.04)' : undefined;
  return (
    <tr style={{ background: bg }}>
      <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
        {o.jcCode}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {o.jcItemCode ?? ''}
      </td>
      <td className="td-ctr mono fw-700">{o.opSeq}</td>
      <td>
        {isOutsource ? (
          <span style={{ fontSize: 10, color: 'var(--amber)' }}>—</span>
        ) : (
          <span style={{ fontSize: 11 }}>{o.machineCode ?? '—'}</span>
        )}
      </td>
      <td>
        {o.operation}
        {isOutsource ? (
          <>
            <br />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--amber)',
                background: 'rgba(255,176,32,0.15)',
                padding: '2px 6px',
                borderRadius: 3,
                display: 'inline-block',
                marginTop: 2,
              }}
            >
              🏭 OUTSOURCE
            </span>
            {o.outsourceStatus ? (
              <div
                style={{
                  fontSize: 9,
                  color:
                    o.outsourceStatus === 'pending'
                      ? 'var(--text3)'
                      : o.outsourceStatus === 'pr_raised'
                        ? 'var(--amber)'
                        : o.outsourceStatus === 'po_created'
                          ? 'var(--blue)'
                          : o.outsourceStatus === 'sent'
                            ? 'var(--purple)'
                            : 'var(--green)',
                  fontWeight: 600,
                }}
              >
                {o.outsourceStatus.replace(/_/g, ' ').toUpperCase()}
              </div>
            ) : null}
            {o.outsourceVendorName ? (
              <div style={{ fontSize: 9, color: 'var(--text3)' }}>{o.outsourceVendorName}</div>
            ) : null}
          </>
        ) : null}
      </td>
      <td className="td-ctr mono">{o.cycleTime ? o.cycleTime.toFixed(3) : '—'}</td>
      <td className="td-ctr">
        {o.qcRequired ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--green)',
              background: 'rgba(34,197,94,0.15)',
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            YES
          </span>
        ) : (
          <span style={{ fontSize: 9, color: 'var(--text3)' }}>NO</span>
        )}
      </td>
      <td className="td-ctr">{o.jcOrderQty}</td>
      <td className="td-ctr text2">{o.inputAvail}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {o.completed}
        {o.qcRequired && o.qcPending > 0 ? (
          <div style={{ fontSize: 9, color: 'var(--amber)' }}>⏳{o.qcPending} QC</div>
        ) : null}
      </td>
      <td className="td-ctr">
        <span className="mono fw-700" style={{ fontSize: 15, color: 'var(--amber)' }}>
          {o.available}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono fw-700" style={{ color: 'var(--red)' }}>
          {o.pendingHrs.toFixed(1)}h
        </span>
      </td>
      <td>
        <StatusBadge status={o.status} />
      </td>
      <td>
        {canWrite && (o.status === 'waiting' || o.status === 'available') && !isOutsource ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={onEdit}
          >
            Change Machine
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
            {o.status === 'complete' ? '✓ Locked' : '🔒 Running'}
          </span>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const v = status.toLowerCase();
  const colors: Record<string, string> = {
    complete: 'var(--green)',
    qc_pending: 'var(--amber)',
    running: 'var(--blue)',
    in_progress: 'var(--blue)',
    available: 'var(--cyan)',
    waiting: 'var(--text3)',
    pr_raised: 'var(--amber)',
    po_created: 'var(--blue)',
    at_vendor: 'var(--purple)',
    received: 'var(--cyan)',
    ready_for_pr: 'var(--amber)',
    outsource: 'var(--text3)',
  };
  const c = colors[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        padding: '2px 9px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}30`,
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function ChangeMachineModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const [machineId, setMachineId] = useState(row.machineId ?? '');
  const [err, setErr] = useState<string | null>(null);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const mut = useChangeJcOpMachine();

  const onSave = (): void => {
    setErr(null);
    if (!machineId) {
      setErr('Select a machine');
      return;
    }
    const input: ChangeJcOpMachineInput = { machineId };
    mut.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Change Machine — {row.jcCode} Op{row.opSeq}
        </div>
        <div
          style={{
            background: 'var(--bg3)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Operation: <b>{row.operation}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Only the assigned machine can be changed for operations that have not yet started.
          </div>
        </div>
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Assign Machine ★
          </div>
          <select
            className="innovic-select"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            style={{ width: '100%', fontSize: 12 }}
          >
            <option value="">— Select machine —</option>
            {(machinesData?.machines ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </div>
        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--red)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
