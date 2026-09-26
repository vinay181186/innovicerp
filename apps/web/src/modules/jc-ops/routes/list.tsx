// JC Operations — mirrors legacy renderJCOps (HTML L11349).

import {
  type ChangeJcOpMachineInput,
  type CreatePurchaseRequestInput,
  type JcOpsBoardRow,
  type OutsourceOpBalanceInput,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
// Reuse the existing PR create hook — do not build a parallel one.
import { useCreatePurchaseRequest } from '@/modules/purchase-requests/api';
import { useVendorsList } from '@/modules/vendors/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { OP_STATUS } from '../../job-cards/lib/jc-op-labels';
import { useMachinesList } from '../../machines/api';
import { jcOpsBoardKeys, useChangeJcOpMachine, useJcOpsBoard, useOutsourceOpBalance } from '../api';

export const jcOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jc-ops',
  component: JcOpsPage,
});

function JcOpsPage(): React.JSX.Element {
  // Tier-driven, per department (jc_create sits in Production). Add Operation,
  // Change Machine and Outsource balance all rewrite a saved JC's routing → edit.
  // Create PR is a purchase action — it opens the PR create flow, so it uses the
  // SAME key as that page (pr_create entry), which the server also enforces.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  const canCreatePr = effectiveFormPerms(eff, 'pr_create').entry;
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view JC Operations. Ask an admin.
      </div>
    );
  }

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
            <option value="">All Job Cards</option>
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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load operations. Try again.'}
            </div>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">No Operations yet.</div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC No.</th>
                  {/* POL — the line number printed on the CUSTOMER's own
                      purchase order, not any line number of ours. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Item Code</th>
                  <th className="td-ctr">Op</th>
                  <th>Planned Machine</th>
                  <th>Actual Machine</th>
                  <th>Operation</th>
                  <th className="th-num">Cycle Time (h)</th>
                  <th className="td-ctr" style={{ color: 'var(--green2)' }}>
                    QC
                  </th>
                  <th className="th-num">JC Qty</th>
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    Completed
                  </th>
                  <th className="th-num" style={{ color: 'var(--amber2)' }}>
                    Available
                  </th>
                  <th className="th-num" style={{ color: 'var(--red2)' }}>
                    Pending Hrs
                  </th>
                  <th>Op Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <Row
                    key={o.jcOpId}
                    o={o}
                    canWrite={canWrite}
                    canCreatePr={canCreatePr}
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

      {editRow ? <ChangeMachineModal row={editRow} onClose={() => setEditRow(null)} /> : null}

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
  sent: 'At Vendor',
  received: 'Received',
};

function Row({
  o,
  canWrite,
  canCreatePr,
  onEdit,
  onCreatePr,
  onOutsource,
}: {
  o: JcOpsBoardRow;
  canWrite: boolean;
  canCreatePr: boolean;
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
        {/* The JC number opens that card. `jcId` is nullable on this board's row
            (jc-ops.ts) — an op can be listed whose job card is not resolvable,
            and /job-cards/$id with a missing id would be a dead link to a route
            that cannot load. So the code only becomes a link when there is a
            card to reach; otherwise it renders exactly as it always has. The
            link inherits the cell's colour and mono weight so a reachable code
            looks no different from an unreachable one. */}
        {o.jcId ? (
          <Link
            to="/job-cards/$id"
            params={{ id: o.jcId }}
            title="View job card status"
            style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            {o.jcCode}
          </Link>
        ) : (
          o.jcCode
        )}
      </td>
      {/* POL — the customer's own PO line number, immediately before the item
          code. '—' when no sales order sits behind this job card. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {o.clientPoLineNo ?? '—'}
      </td>
      {/* A job-card number says WHICH JOB, not WHICH PART, so the board names the
          item next to the code. `jcItemName` has always been on this row
          (packages/shared/src/schemas/jc-ops.ts) and was simply never drawn —
          the board asked an operator to pick an op by job number alone. The
          code keeps its own line; a long part name clips and carries the full
          text on hover, so one wordy item cannot stretch the board sideways. */}
      <td style={{ fontSize: 11 }}>
        {/* The code carries weight; the NAME under it stays muted. The cell used
            to be text2 throughout, which left the board reading fainter than the
            two modals it launches -- and the code is what someone scans this
            board for. */}
        <span className="mono fw-700" style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}>
          {itemCodeWithRev(o.jcItemCode, o.itemRevision, '')}
        </span>
        {o.jcItemName ? (
          <div
            className="text3"
            style={{
              fontSize: 11,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={o.jcItemName}
          >
            {o.jcItemName}
          </div>
        ) : null}
      </td>
      <td className="td-ctr mono fw-700">{opSrNo(o.opSeq)}</td>
      {/* ADR-164 — PLANNED (jc_ops machine, where the remaining qty runs) and
          ACTUAL (the machine(s) that made the Done qty, else the plan) each get
          their own column. Same value when nothing changed; the actual turns
          amber when it differs, with the per-machine breakdown for a 2+ machine
          split. */}
      <td>
        {isOutsource ? (
          <span style={{ fontSize: 11, color: 'var(--amber2)' }}>—</span>
        ) : (
          <PlannedMachineCell planned={o.machineCode} />
        )}
      </td>
      <td>
        {isOutsource ? (
          <span style={{ fontSize: 11, color: 'var(--amber2)' }}>—</span>
        ) : (
          <ActualMachineCell planned={o.machineCode} machines={o.machines} />
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
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--purple)',
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
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--amber2)',
                background: 'rgba(255,176,32,0.15)',
                padding: '2px 6px',
                borderRadius: 3,
                display: 'inline-block',
                marginTop: 2,
              }}
            >
              Outsource
            </span>
            <div
              style={{
                fontSize: 11,
                color:
                  outsourceStatus === 'pending'
                    ? 'var(--text3)'
                    : outsourceStatus === 'pr_raised'
                      ? 'var(--amber)'
                      : outsourceStatus === 'po_created'
                        ? 'var(--blue)'
                        : outsourceStatus === 'sent'
                          ? 'var(--amber)'
                          : outsourceStatus === 'received'
                            ? 'var(--cyan)'
                            : 'var(--green)',
                fontWeight: 600,
              }}
            >
              {OUTSOURCE_STATUS_LABELS[outsourceStatus] ?? outsourceStatus.replace(/_/g, ' ')}
            </div>
            {o.outsourceVendorName ? (
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.outsourceVendorName}</div>
            ) : null}
          </>
        ) : null}
      </td>
      <td className="mono td-num">{o.cycleTime ? o.cycleTime.toFixed(3) : '—'}</td>
      <td className="td-ctr">
        {o.qcRequired ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--green2)',
              background: 'rgba(34,197,94,0.15)',
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            Yes
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>No</span>
        )}
      </td>
      <td className="td-num">{o.jcOrderQty}</td>
      <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
        {o.completed}
        {/* The per-machine breakdown of that total lives in the Planned /
            Actual machine cell (ADR-164), so it is not repeated here. */}
        {o.qcRequired && o.qcPending > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--amber2)' }}>⏳{o.qcPending} QC</div>
        ) : null}
      </td>
      <td className="td-num">
        <span className="mono fw-700" style={{ fontSize: 15, color: 'var(--amber2)' }}>
          {o.available}
        </span>
      </td>
      <td className="td-num">
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
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
            canCreatePr ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'var(--amber)',
                  color: '#000',
                  fontSize: 11,
                  fontWeight: 700,
                }}
                onClick={onCreatePr}
              >
                📋 Create PR
              </button>
            ) : null
          ) : outsourceStatus === 'pr_raised' ? (
            <span style={{ fontSize: 11, color: 'var(--amber2)' }}>
              ⏳ PR: {o.outsourcePrCode ?? ''}
            </span>
          ) : outsourceStatus === 'po_created' ? (
            o.outsourcePoId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: o.outsourcePoId }}
                style={{
                  fontSize: 11,
                  color: 'var(--blue)',
                  textDecoration: 'underline dotted',
                }}
              >
                PO: {o.outsourcePoCode ?? ''}
              </Link>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--blue)' }}>
                PO: {o.outsourcePoCode ?? ''}
              </span>
            )
          ) : outsourceStatus === 'sent' ? (
            <span style={{ fontSize: 11, color: 'var(--amber2)' }}>
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
                  color: 'var(--purple)',
                  fontSize: 11,
                  fontWeight: 700,
                }}
                onClick={onOutsource}
              >
                🏭 Outsource Available
              </button>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  // One shared op-status map (job-cards/lib/jc-op-labels) — same words and
  // colours as the Job Card page.
  const s = OP_STATUS[status.toLowerCase()];
  return (
    <span className={`badge ${s?.cls ?? ''}`.trim()}>{s?.label ?? status.replace(/_/g, ' ')}</span>
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

  // A finished op has no remaining qty to route anywhere, so the server refuses
  // the swap. Say so as the dialog OPENS rather than after a pointless round
  // trip -- the user should not fill in a form that cannot be saved.
  const finished = row.status === 'complete';

  const onSave = (): void => {
    setErr(null);
    if (!machineId) {
      setErr('Machine is required.');
      return;
    }
    const input: ChangeJcOpMachineInput = { machineId };
    mut.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not change the machine. Try again.'),
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
          Change Machine — {row.jcCode} Op {opSrNo(row.opSeq)}
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
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
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
                  <b style={{ color: 'var(--text2)' }}>{m.machineCode}</b>: {m.qty} pcs
                </span>
              ))}
              . Each stays recorded against its own machine. The new machine takes the remaining{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          ) : row.completed > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {row.completed} pcs already made stay recorded against{' '}
              <b style={{ color: 'var(--text2)' }}>
                {row.machines[0]?.machineCode ?? row.machineCode ?? 'the planned machine'}
              </b>
              . The new machine takes the remaining{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Nothing logged yet — the new machine takes all{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          )}
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
            Assign Machine <span className="req">★</span>
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
        {finished || err ? (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid var(--red)',
              color: 'var(--red2)',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
              &#10007;
            </span>
            <span>
              {err ?? 'This operation is Completed — nothing is left to run on another machine.'}
            </span>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {finished ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={mut.isPending || finished}
          >
            {mut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Changes'
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
      setErr('PR No. is required.');
      return;
    }
    if (qty <= 0) {
      setErr('Qty must be more than 0.'); // legacy L6194
      return;
    }
    if (!vendorText.trim()) {
      setErr('Set an outsource vendor on this operation first.');
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not raise PR. Try again.'),
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
          Create Purchase Request — {row.jcCode} Op {opSrNo(row.opSeq)}
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
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Vendor: {row.outsourceVendorName ?? row.outsourceVendorCode ?? '—'} ·{' '}
            {/* POL — the CUSTOMER's own PO line number, ahead of the item code.
                Omitted when there is no sales order behind this job card. */}
            {row.clientPoLineNo ? (
              <>
                POL{' '}
                <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                  {row.clientPoLineNo}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            Item:{' '}
            {/* The code carries weight even on a muted context line -- it is the
                value someone checks before acting in this modal. */}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(row.jcItemCode, row.itemRevision)}
            </span>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
            PR No. <span className="req">★</span>
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
              style={{
                fontSize: 11,
                marginBottom: 4,
                color: 'var(--amber2)',
              }}
            >
              Qty Required <span className="req">★</span>
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
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
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
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
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
          <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
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
              color: 'var(--red2)',
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
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save PR'
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
      setErr(`Qty must be between 1 and Available (${row.available}).`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required.');
      return;
    }
    const input: OutsourceOpBalanceInput = { qty, vendorCode: vendorCode.trim() };
    outsource.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(
            e instanceof Error ? e.message : 'Could not outsource the pending qty. Try again.',
          ),
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
          Outsource Available Qty — {row.jcCode} Op {opSrNo(row.opSeq)}
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
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {/* POL — the CUSTOMER's own PO line number, ahead of the item code. */}
            {row.clientPoLineNo ? (
              <>
                POL{' '}
                <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                  {row.clientPoLineNo}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            Item:{' '}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(row.jcItemCode, row.itemRevision)}
            </span>{' '}
            · Available: <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs. Sends this
            qty to a vendor as an OSP purchase request.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div
              className="text3"
              style={{
                fontSize: 11,
                marginBottom: 4,
                color: 'var(--amber2)',
              }}
            >
              Qty to Outsource <span className="req">★</span>
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
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
              Vendor <span className="req">★</span>
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
              color: 'var(--red2)',
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
              'Outsource Available'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
