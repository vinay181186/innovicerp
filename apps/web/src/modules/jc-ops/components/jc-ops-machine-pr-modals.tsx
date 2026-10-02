// JC Operations board — the Change Machine and Raise PR dialogs. Moved
// verbatim out of routes/list.tsx (which was past the 400-line rule) when the
// board went to 25-row server pages (ADR-201).

import {
  type ChangeJcOpMachineInput,
  type GenerateOspPrResult,
  type JcOpsBoardRow,
  opSrNo,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
// The system OSP PR path Op Entry uses — do not build a parallel one.
import { useGenerateOspPr } from '@/modules/op-entry/api';
import { useMachinesList } from '../../machines/api';
import { jcOpsBoardKeys, useChangeJcOpMachine } from '../api';

export function ChangeMachineModal({
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

// Raise the Purchase Request for a pending outsource op. Routed through the
// SYSTEM OSP PR path (POST /op-entry/osp-pr → generateOspPr), the same one Op
// Entry uses (2026-09-28 form audit). The old hand form POSTed to
// /purchase-requests with sourceJcOpId, which the server refuses for every
// hand-raised request ("a Job Work OSP request is raised by the system"), so
// the op never got its PR from this board. The system path numbers the PR
// itself (IN-JWPR-#####), takes the vendor from System Settings → OSP
// Processes and the qty from the Job Card, and stamps the op pr_raised — so
// there is nothing to type: this is a confirm box that shows the number after.
export function CreatePrModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const generate = useGenerateOspPr();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateOspPrResult | null>(null);

  const onSave = (): void => {
    setErr(null);
    generate.mutate(
      { jcOpId: row.jcOpId },
      {
        onSuccess: (res) => {
          // Reflect the op's new pr_raised state on the board immediately.
          void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
          setResult(res);
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not raise PR. Try again.'),
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
            </span>{' '}
            · PR Qty <b style={{ color: 'var(--text)' }}>{row.jcOrderQty}</b> (the Job Card&apos;s
            Order Qty)
          </div>
        </div>

        {result ? (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              background: 'var(--green3)',
              border: '1px solid var(--green)',
              color: 'var(--green2)',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            PR <b className="mono">{result.prCode}</b> raised
            {result.vendorName ? (
              <>
                {' '}
                for <b>{result.vendorName}</b>
              </>
            ) : null}
            {result.autoPoCreated && result.poCode ? (
              <>
                {' '}
                · draft PO <b className="mono">{result.poCode}</b> created
              </>
            ) : null}
            . It now waits for approval on the Purchase Request list.
          </div>
        ) : (
          <div className="text3" style={{ fontSize: 12 }}>
            The system numbers this request (IN-JWPR-#####), takes the vendor from System Settings →
            OSP Processes for &ldquo;{row.operation}&rdquo;, and shows the number here once saved.
          </div>
        )}

        {err ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: 8,
              background: 'var(--red3)',
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
            {result ? 'Close' : 'Cancel'}
          </button>
          {result ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <>
                  <Loader2 size={14} className="inline animate-spin" /> Raising…
                </>
              ) : (
                'Raise PR'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
