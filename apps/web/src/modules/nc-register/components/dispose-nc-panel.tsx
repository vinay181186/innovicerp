// Dispose-NC inline panel (UI-003-06). Mirrors legacy `_disposeNC` modal L22618.
// Inline (not a modal) — project doesn't have a Dialog primitive yet.
//
// QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §1, §3, §8): a disposition now
// covers a QTY (default = all open pieces; less splits the remainder into a
// sibling NC), `repair` sits beside `rework`, and both raise a CHILD job card
// instead of bumping an op in the parent route — so the old "rework to op"
// picker only appears on a legacy row that already carries `reworkOpSeq`.

import {
  type DisposeNcInput,
  type DisposeNcResult,
  NC_DISPOSITION_LABELS,
  type NcDisposition,
  type NcRegister,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { ncOpenQty } from '../nc-qty';
import { Note } from './nc-note';

export interface JcOpOption {
  opSeq: number;
  operation: string;
}

interface Props {
  nc: NcRegister;
  // Human JC code (the NC read shape only carries jobCardId) for the context
  // block. Resolved upstream from the JC's loaded ops.
  jcCode?: string | null;
  // Full op list of the NC's JC (legacy `_disposeNC` renders every op). Only
  // used by the legacy in-route rework picker now. Empty = fall back to a free
  // number input / the NC's own op_seq.
  jcOps: JcOpOption[];
  // Money right for `nc_dispose` (QC starts at L3 — see priceStartTier). False
  // for an L1/L2 QC hand, who must not be asked to type a cost the API then
  // blanks on read-back via `hideNcMoney`.
  canSeePrice: boolean;
  onSubmit: (input: DisposeNcInput) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
  // Set once the server has answered: the panel swaps its form for the
  // outcome (child JC / remainder NC links) so the user can jump straight on.
  result: DisposeNcResult | null;
}

// The document's order (§3): the two recovery routes first, then the vendor
// route, then the terminal ones. NC_DISPOSITIONS (the enum) is in storage
// order, which is not the order a QC hand reads them in.
const ACTION_ORDER: readonly NcDisposition[] = [
  'rework',
  'repair',
  'return_to_vendor',
  'scrap',
  'use_as_is',
  'make_fresh',
];

export function DisposeNcPanel(props: Props): React.JSX.Element {
  const { nc, jcCode, jcOps, canSeePrice, onSubmit, onCancel, pending, error, result } = props;

  const openQty = ncOpenQty(nc);
  const [action, setAction] = useState<NcDisposition | ''>('');
  // The ONE pre-filled field. "All of them" is the normal case; the interlock
  // on this box (§3, interlock 2) is a ceiling, not a blank to fill in.
  const [qty, setQty] = useState<number | ''>(openQty);
  const [reworkOpSeq, setReworkOpSeq] = useState<number | ''>(nc.reworkOpSeq ?? nc.opSeq ?? '');
  const [scrapCost, setScrapCost] = useState<number | ''>('');
  const [remarks, setRemarks] = useState<string>('');

  // Legacy in-route rework: only a row that ALREADY carries rework_op_seq
  // keeps the op picker. A fresh rework/repair raises a child JC and the
  // server ignores reworkOpSeq — so it is never sent for those.
  const isLegacyRework = nc.reworkOpSeq != null;
  const isRecovery = action === 'rework' || action === 'repair';

  const reworkOps = useMemo<JcOpOption[]>(() => {
    if (jcOps.length > 0) return jcOps;
    return nc.opSeq != null ? [{ opSeq: nc.opSeq, operation: '' }] : [];
  }, [jcOps, nc.opSeq]);

  const qtyNum = qty === '' ? 0 : Number(qty);
  const qtyValid = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= openQty;
  const remainder = qtyValid ? openQty - qtyNum : 0;
  // The qty the notes talk about: the typed value while it is valid, else
  // the default, so the sentence never reads "for 0 pcs" mid-edit.
  const noteQty = qtyValid ? qtyNum : openQty;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!action || !qtyValid) return;
    const payload: DisposeNcInput = { action, qty: qtyNum };
    if (remarks.trim().length > 0) payload.remarks = remarks.trim();
    if (action === 'rework' && isLegacyRework && reworkOpSeq !== '') {
      payload.reworkOpSeq = Number(reworkOpSeq);
    }
    // Only sent when the user could actually see and type it. A blinded user
    // leaves `scrapCost` at '' and the key is omitted from the payload entirely
    // — never sent as 0/null over a value they were not shown.
    if (action === 'scrap' && canSeePrice && scrapCost !== '') {
      payload.scrapCost = Number(scrapCost);
    }
    void onSubmit(payload);
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">✏ Disposition — {nc.code}</div>
        <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
          Open qty: <b style={{ color: 'var(--text)' }}>{openQty}</b> of {Number(nc.rejectedQty)}{' '}
          rejected
        </span>
      </div>
      <div className="panel-body">
        {/* Context block — legacy `_disposeNC` header (HTML L22621-22628). */}
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 14,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <CtxField label="JC">
            <span className="mono" style={{ color: 'var(--cyan)' }}>
              {jcCode ?? '—'}
            </span>
          </CtxField>
          <CtxField label="ITEM">
            {/* Whoever disposes an NC is deciding against a drawing, so this
                context field shows the live item code with its revision — the
                same joined pair the list and the detail header show. It falls
                back to itemCodeText, the reporter's typed snapshot, bare. */}
            {nc.itemCode ? itemCodeWithRev(nc.itemCode, nc.itemRevision) : nc.itemCodeText}
            {nc.itemNameText ? ` ${nc.itemNameText}` : ''}
          </CtxField>
          <CtxField label="OPERATION">
            {nc.opSeq != null ? `Op${nc.opSeq}` : ''}
            {nc.opSeq != null && (nc.operationText ?? nc.qcOperationText) ? ': ' : ''}
            {nc.operationText ?? nc.qcOperationText ?? (nc.opSeq == null ? '—' : '')}
          </CtxField>
          <CtxField label="REJECTED QTY">
            <span className="red">{Number(nc.rejectedQty)} pcs</span>
          </CtxField>
          <CtxField label="REASON">
            {nc.reasonCategory.replaceAll('_', ' ')}
            {nc.reason ? ` — ${nc.reason}` : ''}
          </CtxField>
        </div>

        {result ? (
          <DisposeOutcome result={result} onClose={onCancel} />
        ) : (
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label" htmlFor="dispAction">
                  Disposition<span className="req">★</span>
                </label>
                <select
                  id="dispAction"
                  className="innovic-select"
                  value={action}
                  onChange={(e) => setAction(e.target.value as NcDisposition | '')}
                  required
                >
                  <option value="">-- Select Action --</option>
                  {ACTION_ORDER.map((a) => (
                    <option key={a} value={a}>
                      {NC_DISPOSITION_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-grp">
                <label className="form-label" htmlFor="dispQty">
                  Qty<span className="req">★</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    id="dispQty"
                    type="number"
                    min={1}
                    max={openQty}
                    step={1}
                    className="innovic-input"
                    style={{ width: 110 }}
                    value={qty === '' ? '' : qty}
                    onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                    required
                  />
                  <span className="text3" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    of {openQty} open
                  </span>
                </div>
                {qty !== '' && !qtyValid ? (
                  <div className="form-error">Enter a whole number from 1 to {openQty}.</div>
                ) : null}
                {qtyValid && remainder > 0 ? (
                  <div className="form-help">
                    The remaining {remainder} pcs stay as a separate pending NC.
                  </div>
                ) : null}
              </div>

              {action === 'rework' && isLegacyRework ? (
                <div className="form-grp form-full">
                  <label className="form-label" htmlFor="dispReworkOp">
                    Rework to Operation
                  </label>
                  {reworkOps.length > 0 ? (
                    <select
                      id="dispReworkOp"
                      className="innovic-select"
                      value={reworkOpSeq === '' ? '' : String(reworkOpSeq)}
                      onChange={(e) =>
                        setReworkOpSeq(e.target.value === '' ? '' : Number(e.target.value))
                      }
                    >
                      <option value="">
                        {nc.opSeq != null ? `Defaults to op ${nc.opSeq}` : '— pick op —'}
                      </option>
                      {reworkOps.map((o) => (
                        <option key={o.opSeq} value={o.opSeq}>
                          Op{o.opSeq}
                          {o.operation ? `: ${o.operation}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="dispReworkOp"
                      type="number"
                      min={1}
                      className="innovic-input"
                      value={reworkOpSeq === '' ? '' : reworkOpSeq}
                      onChange={(e) =>
                        setReworkOpSeq(e.target.value === '' ? '' : Number(e.target.value))
                      }
                    />
                  )}
                  <div className="form-help">
                    Legacy in-route rework: increments{' '}
                    <span className="mono">jc_ops.rework_qty</span> for the picked op.
                  </div>
                </div>
              ) : null}

              {action === 'scrap' ? (
                canSeePrice ? (
                  <div className="form-grp form-full">
                    <label className="form-label" htmlFor="dispScrapCost">
                      Scrap Cost (₹)
                    </label>
                    <input
                      id="dispScrapCost"
                      type="number"
                      min={0}
                      step="0.01"
                      className="innovic-input"
                      value={scrapCost === '' ? '' : scrapCost}
                      onChange={(e) =>
                        setScrapCost(e.target.value === '' ? '' : Number(e.target.value))
                      }
                    />
                  </div>
                ) : (
                  <div className="form-grp form-full">
                    <div className="form-help">
                      Scrap cost is hidden for your access level — this NC will be saved with no
                      scrap cost recorded.
                    </div>
                  </div>
                )
              ) : null}

              <div className="form-grp form-full">
                <label className="form-label" htmlFor="dispRemarks">
                  Remarks
                </label>
                <textarea
                  id="dispRemarks"
                  className="innovic-textarea"
                  rows={2}
                  placeholder="Additional notes..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>

            {/* What each choice will DO — the user reads this before Save. */}
            {isRecovery && !isLegacyRework ? (
              <Note tone="blue">
                A child {action === 'rework' ? 'Rework' : 'Repair'} Job Card will be raised for{' '}
                {noteQty} pcs. Define its operations on that card; it ends in QC.
              </Note>
            ) : null}

            {action === 'scrap' ? (
              <Note tone="amber">Requires approve rights on NC Register.</Note>
            ) : null}

            {action === 'return_to_vendor' ? (
              <Note tone="blue">
                After disposition, issue the return challan from this NC (Create DC).
              </Note>
            ) : null}

            {action === 'use_as_is' && (nc.opSeq == null || nc.jcOpId == null) ? (
              <Note tone="amber">
                ⚠ Use-As-Is needs the NC to have a resolved op_seq + jc_op_id. This NC has none —
                server will reject.
              </Note>
            ) : null}

            {action === 'make_fresh' ? (
              <Note tone="blue">
                A supplementary JC will be created with qty {noteQty} and the origin&apos;s source
                SO/JW link inherited. Code: <span className="mono">&lt;origin&gt;-S&lt;n&gt;</span>.
              </Note>
            ) : null}

            {error ? <Note tone="red">{error}</Note> : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || !action || !qtyValid}
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : null}
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// After Save: where the pieces went. A child JC and/or a remainder NC are the
// two things the user must act on next, so both are links.
function DisposeOutcome(props: {
  result: DisposeNcResult;
  onClose: () => void;
}): React.JSX.Element {
  const { result, onClose } = props;
  const { nc, remainderNc, childJobCardId, childJobCardCode } = result;
  return (
    <div>
      <Note tone="green">
        Disposition saved — {nc.code} is now{' '}
        <b>{nc.disposition ? NC_DISPOSITION_LABELS[nc.disposition] : nc.status}</b> for{' '}
        {Number(nc.rejectedQty)} pcs.
      </Note>
      {childJobCardId && childJobCardCode ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <span className="text3">Child Job Card raised:</span>{' '}
          <Link
            to="/job-cards/$id"
            params={{ id: childJobCardId }}
            className="mono fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            title="Open the child job card to define its operations"
          >
            {childJobCardCode}
          </Link>{' '}
          <span className="text3">— define its operations there; it ends in QC.</span>
        </div>
      ) : null}
      {remainderNc ? (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <span className="text3">
            Remainder NC ({Number(remainderNc.rejectedQty)} pcs, pending):
          </span>{' '}
          <Link
            to="/nc-register/$id"
            params={{ id: remainderNc.id }}
            className="mono fw-700"
            style={{ color: 'var(--red)', textDecoration: 'none' }}
          >
            {remainderNc.code}
          </Link>
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function CtxField(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{props.label}</span>
      <br />
      <b>{props.children}</b>
    </div>
  );
}
