// JC Operations — mirrors legacy renderJCOps (HTML L11349).

import {
  type ChangeJcOpMachineInput,
  type CreatePurchaseRequestInput,
  type JcOpsBoardRow,
  type OutsourceOpBalanceInput,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { MachineChip, MachineSplitLines } from '@/components/shared/machine-split';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
// Reuse the existing PR create hook — do not build a parallel one.
import { useCreatePurchaseRequest } from '@/modules/purchase-requests/api';
import { useVendorsList } from '@/modules/vendors/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachinesList } from '../../machines/api';
import {
  jcOpsBoardKeys,
  useChangeJcOpMachine,
  useJcOpsBoard,
  useOutsourceOpBalance,
} from '../api';

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
  const [prRow, setPrRow] = useState<JcOpsBoardRow | null>(null);
  const [outsourceRow, setOutsourceRow] = useState<JcOpsBoardRow | null>(null);

  const { data, isLoading, isError, error } = useJcOpsBoard({
    jcCode: jcCode || undefined,
    limit: 1000,
    offset: 0,
  });

  // Legacy L11400 "+ Add Operation" opened a modal to pick a JC, then added an
  // op to it. Ops are edited on the Job Card edit page, so we link there.
  // When a JC is selected in the filter we deep-link to that card; otherwise we
  // send the user to the Job Cards list to pick one first.
  const selectedJc = (data?.jcOptions ?? []).find((j) => j.jcCode === jcCode);

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
          {canWrite ? (
            selectedJc ? (
              <Link
                to="/job-cards/$id/edit"
                params={{ id: selectedJc.jcId }}
                className="btn btn-primary"
              >
                + Add Operation
              </Link>
            ) : (
              <Link to="/job-cards" className="btn btn-primary">
                + Add Operation
              </Link>
            )
          ) : null}
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
                  <th className="td-ctr">Order Qty</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Completed Qty
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                    Pending Qty
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
                  <Row
                    key={o.jcOpId}
                    o={o}
                    canWrite={canWrite}
                    onEdit={() => setEditRow(o)}
                    onCreatePr={() => setPrRow(o)}
                    onOutsource={() => setOutsourceRow(o)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {editRow ? (
        <ChangeMachineModal row={editRow} onClose={() => setEditRow(null)} />
      ) : null}

      {prRow ? <CreatePrModal row={prRow} onClose={() => setPrRow(null)} /> : null}

      {outsourceRow ? (
        <OutsourceBalanceModal row={outsourceRow} onClose={() => setOutsourceRow(null)} />
      ) : null}
    </div>
  );
}

// Legacy L11359/L11363/L11368 render the outsource sub-status in Title Case
// (`o.outsourceStatus||'Pending'`); our enum values are snake_case.
const OUTSOURCE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  sent: 'Sent',
  received: 'Received',
};

function Row({
  o,
  canWrite,
  onEdit,
  onCreatePr,
  onOutsource,
}: {
  o: JcOpsBoardRow;
  canWrite: boolean;
  onEdit: () => void;
  onCreatePr: () => void;
  onOutsource: () => void;
}): React.JSX.Element {
  const isOutsource = o.opType === 'outsource';
  const outsourceStatus = o.outsourceStatus || 'pending';
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
          <>
            <span style={{ fontSize: 11 }}>{o.machineCode ?? '—'}</span>
            {/* ADR-126 — this column is the machine the REMAINING qty runs on.
                Once an op has run on more than one machine it stops matching
                the Done figure beside it, so say so instead of implying the
                current machine made everything. One machine (the norm) renders
                exactly as before — MachineChip returns null. */}
            <MachineChip machines={o.machines} />
          </>
        )}
      </td>
      <td>
        {o.operation}
        {isOutsource ? (
          <>
            {' '}
            {/* Legacy L11379 [OSP] tag — marks the row as outside-processing. */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: '#7c3aed',
                background: 'rgba(124,58,237,0.12)',
                padding: '1px 6px',
                borderRadius: 3,
              }}
            >
              [OSP]
            </span>
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
            <div
              style={{
                fontSize: 9,
                color:
                  outsourceStatus === 'pending'
                    ? 'var(--text3)'
                    : outsourceStatus === 'pr_raised'
                      ? 'var(--amber)'
                      : outsourceStatus === 'po_created'
                        ? 'var(--blue)'
                        : outsourceStatus === 'sent'
                          ? 'var(--purple)'
                          : outsourceStatus === 'received'
                            ? 'var(--cyan)'
                            : 'var(--green)',
                fontWeight: 600,
              }}
            >
              {OUTSOURCE_STATUS_LABELS[outsourceStatus] ?? outsourceStatus.replace(/_/g, ' ')}
            </div>
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
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {o.completed}
        {/* The per-machine breakdown of that total (ADR-126). Renders nothing
            unless the op ran on more than one machine. */}
        <MachineSplitLines machines={o.machines} />
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
        {isOutsource ? (
          outsourceStatus === 'pending' ? (
            // Legacy L11369 — raise a PR from a pending outsource op. The
            // server-side cascade (purchase-requests service) stamps this op
            // as pr_raised + links the new PR; the board then reflects it.
            canWrite ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'var(--amber)',
                  color: '#000',
                  fontSize: 10,
                  fontWeight: 700,
                }}
                onClick={onCreatePr}
              >
                📋 Create PR
              </button>
            ) : null
          ) : outsourceStatus === 'pr_raised' ? (
            <span style={{ fontSize: 10, color: 'var(--amber)' }}>
              ⏳ PR: {o.outsourcePrCode ?? ''}
            </span>
          ) : outsourceStatus === 'po_created' ? (
            o.outsourcePoId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: o.outsourcePoId }}
                style={{
                  fontSize: 10,
                  color: 'var(--blue)',
                  textDecoration: 'underline dotted',
                }}
              >
                PO: {o.outsourcePoCode ?? ''}
              </Link>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--blue)' }}>
                PO: {o.outsourcePoCode ?? ''}
              </span>
            )
          ) : outsourceStatus === 'sent' ? (
            <span style={{ fontSize: 10, color: 'var(--purple)' }}>
              📦 At Vendor ({o.sentQty} pcs)
            </span>
          ) : null
        ) : (
          // In-house process op — the existing machine/status action, plus the
          // ADR-081 "Outsource balance" action when there's remaining qty to
          // send out (op_type='process', available > 0, not yet complete).
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* ADR-125 — a half-done op CAN now change machine: since 0095 each
                op_log row carries the machine that made its qty, so the switch
                only routes the REMAINING pieces and rewrites no history. Only
                two cases stay blocked, matching changeJcOpMachine exactly:
                'complete' (nothing left to run) and an open running session
                (stop first, so the pieces already made are recorded against the
                current machine). */}
            {canWrite && o.status !== 'complete' && o.status !== 'running' ? (
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
            {canWrite && o.opType === 'process' && o.available > 0 && o.status !== 'complete' ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(124,58,237,0.15)',
                  color: '#7c3aed',
                  fontSize: 10,
                  fontWeight: 700,
                }}
                onClick={onOutsource}
              >
                🏭 Outsource balance
              </button>
            ) : null}
          </div>
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
          {/* ADR-125 — this used to read "only ... operations that have not yet
              started", which 0095 made false. Spell out what actually happens
              instead: the switch routes the REMAINING qty only, and the pieces
              already made keep their own machine on every report. */}
          {row.machines.length > 1 ? (
            // ADR-126 — after a second swap the completed total spans several
            // machines, so naming only the current one would be a lie. List them.
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Already made:{' '}
              {row.machines.map((m, i) => (
                <span key={m.machineCode}>
                  {i > 0 ? ' · ' : ''}
                  <b style={{ color: 'var(--text2)' }}>{m.machineCode}</b> {m.qty}
                </span>
              ))}
              . Each stays recorded against its own machine. The new machine takes the
              remaining <b style={{ color: 'var(--amber)' }}>{row.available}</b> pcs.
            </div>
          ) : row.completed > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {row.completed} pcs already made stay recorded against{' '}
              <b style={{ color: 'var(--text2)' }}>
                {row.machines[0]?.machineCode ?? row.machineCode ?? 'the current machine'}
              </b>
              . The new machine takes the remaining{' '}
              <b style={{ color: 'var(--amber)' }}>{row.available}</b> pcs.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Nothing logged yet — the new machine takes all{' '}
              <b style={{ color: 'var(--amber)' }}>{row.available}</b> pcs.
            </div>
          )}
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

// Raise a Purchase Request from a pending outsource op (legacy createPR modal,
// HTML L6180-6213). Collects the same fields the legacy modal did — Qty, Est.
// Cost/pc, Required By Date, Remarks — plus a PR No. (legacy auto-generated it
// via _nextPRNo(); this app assigns PR codes manually, consistent with the
// standalone New PR form). Submitting POSTs to /purchase-requests with
// sourceJcOpId; the server-side cascade stamps the op as pr_raised.
function CreatePrModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const create = useCreatePurchaseRequest();
  const [code, setCode] = useState('');
  const [qty, setQty] = useState<number>(row.available > 0 ? row.available : row.jcOrderQty);
  const [cost, setCost] = useState<string>('');
  const [reqDate, setReqDate] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const vendorText = row.outsourceVendorCode ?? row.outsourceVendorName ?? '';
  const itemText = row.jcItemCode ?? '';

  const onSave = (): void => {
    setErr(null);
    if (!code.trim()) {
      setErr('PR No. is required');
      return;
    }
    if (qty <= 0) {
      setErr('Qty must be > 0'); // legacy L6194
      return;
    }
    if (!vendorText.trim()) {
      setErr('This op has no outsource vendor — set a vendor on the operation first');
      return;
    }
    const input: CreatePurchaseRequestInput = {
      code: code.trim(),
      prDate: todayLocal(), // legacy today()
      status: 'open',
      qty,
      estCost: cost ? Number(cost) : 0,
      vendorCodeText: vendorText,
      itemCodeText: itemText || undefined,
      itemName: row.jcItemName ?? undefined,
      operation: row.operation,
      requiredDate: reqDate || undefined,
      remarks: remarks || undefined,
      sourceJcOpId: row.jcOpId,
    };
    create.mutate(input, {
      onSuccess: () => {
        // Reflect the op's new pr_raised state on the board immediately.
        void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
        onClose();
      },
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create PR'),
    });
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
          width: 'min(560px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Create Purchase Request — {row.jcCode} Op{row.opSeq}
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
            Vendor: {row.outsourceVendorName ?? row.outsourceVendorCode ?? '—'} · Item:{' '}
            {row.jcItemCode ?? '—'}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
            PR No. ★
          </div>
          <input
            className="innovic-select"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. PR-00001"
            style={{ width: '100%', fontSize: 12 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4, color: 'var(--amber)' }}
            >
              Qty Required ★
            </div>
            <input
              type="number"
              min={1}
              className="innovic-select"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
              Est. Cost / pc (₹)
            </div>
            <input
              type="number"
              min={0}
              step="0.01"
              className="innovic-select"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
              Required By Date
            </div>
            <input
              type="date"
              className="innovic-select"
              value={reqDate}
              onChange={(e) => setReqDate(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
            Remarks
          </div>
          <input
            className="innovic-select"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Any special instructions"
            style={{ width: '100%', fontSize: 12 }}
          />
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
            disabled={create.isPending}
          >
            {create.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Creating…
              </>
            ) : (
              'Create PR'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Outsource the remaining qty of an in-house PROCESS op (ADR-081 dual-lane).
// Prefills qty to the op's `available` (also the max) and resolves the vendor
// against the vendors master. Submitting POSTs to /jc-ops/:id/outsource-balance
// which validates qty ≤ available, stamps the op's outsource vendor, and raises
// a jw_osp PR; the existing OSP PR→PO→DC→GRN→QC flow reconciles the balance.
function OutsourceBalanceModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const outsource = useOutsourceOpBalance();
  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const [qty, setQty] = useState<number>(row.available);
  const [vendorCode, setVendorCode] = useState<string>(row.outsourceVendorCode ?? '');
  const [err, setErr] = useState<string | null>(null);

  const onSave = (): void => {
    setErr(null);
    if (qty <= 0 || qty > row.available) {
      setErr(`Qty must be between 1 and ${row.available}`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required');
      return;
    }
    const input: OutsourceOpBalanceInput = { qty, vendorCode: vendorCode.trim() };
    outsource.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to outsource balance'),
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
          width: 'min(480px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Outsource Balance — {row.jcCode} Op{row.opSeq}
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
            Item: {row.jcItemCode ?? '—'} · Available:{' '}
            <b style={{ color: 'var(--amber)' }}>{row.available}</b> pcs. Sends the balance to a
            vendor as a JW OSP purchase request.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div
              className="text3"
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                marginBottom: 4,
                color: 'var(--amber)',
              }}
            >
              Qty to outsource ★
            </div>
            <input
              type="number"
              min={1}
              max={row.available}
              className="innovic-select"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
            >
              Vendor ★
            </div>
            <input
              className="innovic-select"
              list="outsource-balance-vendors"
              value={vendorCode}
              onChange={(e) => setVendorCode(e.target.value)}
              placeholder="Vendor code"
              style={{ width: '100%', fontSize: 12 }}
            />
            <datalist id="outsource-balance-vendors">
              {(vendorsData?.vendors ?? []).map((v) => (
                <option key={v.id} value={v.code}>
                  {v.code} — {v.name}
                </option>
              ))}
            </datalist>
          </div>
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
            disabled={outsource.isPending}
          >
            {outsource.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Outsourcing…
              </>
            ) : (
              'Outsource balance'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
