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
  NC_STATUS_LABELS,
  type NcDisposition,
  type NcRegister,
  opSrNo,
  QTY_STEP,
  hasQtyPrecision,
  roundQty,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/shared/searchable-select';
import { fmtDate } from '@/lib/date';
import { useNcSourceChallanCandidates } from '../api';
import { ncOpenQty } from '../nc-qty';
import { Note } from './nc-note';

export interface JcOpOption {
  opSeq: number;
  operation: string;
}

interface Props {
  nc: NcRegister;
  // Full op list of the NC's JC (legacy `_disposeNC` renders every op). Only
  // used by the legacy in-route rework picker now. Empty = fall back to a free
  // number input / the NC's own op_seq.
  jcOps: JcOpOption[];
  // Money right for `nc_dispose` (QC starts at L3 — see priceStartTier). False
  // for an L1/L2 QC hand, who must not be asked to type a cost the API then
  // blanks on read-back via `hideNcMoney`.
  canSeePrice: boolean;
  // Scrap needs the approve tier on NC Register (server gate) — the option is
  // not offered to a user who lacks it.
  canApprove: boolean;
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
  const { nc, jcOps, canSeePrice, canApprove, onSubmit, onCancel, pending, error, result } = props;

  const openQty = ncOpenQty(nc);
  const [action, setAction] = useState<NcDisposition | ''>('');
  // The ONE pre-filled field. "All of them" is the normal case; the interlock
  // on this box (§3, interlock 2) is a ceiling, not a blank to fill in.
  const [qty, setQty] = useState<number | ''>(openQty);
  const [reworkOpSeq, setReworkOpSeq] = useState<number | ''>(nc.reworkOpSeq ?? nc.opSeq ?? '');
  const [scrapCost, setScrapCost] = useState<number | ''>('');
  const [remarks, setRemarks] = useState<string>('');
  // ADR-217 phase 3 — which OUTWARD challan the rejected pieces went out on.
  // ASKED, never computed: this system has no piece, lot or batch tracking, so
  // when one order went out on two challans NO query can say which one carried
  // these pieces — only the person who packed them. Never mandatory.
  const [sourceDcId, setSourceDcId] = useState<string | null>(null);

  // Legacy in-route rework: only a row that ALREADY carries rework_op_seq
  // keeps the op picker. A fresh rework/repair raises a child JC and the
  // server ignores reworkOpSeq — so it is never sent for those.
  const isLegacyRework = nc.reworkOpSeq != null;
  const isRecovery = action === 'rework' || action === 'repair';
  const isRtv = action === 'return_to_vendor';

  // The candidate challans, loaded only once Return to Vendor is the chosen
  // action. An empty list (nothing resolvable, or the request failed) renders no
  // picker at all and blocks nothing — an NC raised at the machine with nothing
  // behind it is normal and must still be disposable.
  const sourceDcQuery = useNcSourceChallanCandidates(nc.id, isRtv);
  // One option reads "IN-DC-00002/R1 — 06-Oct-2026 · Qty 12 · IN-JWPO-00002/R1":
  // the challan number, the day it left, how much of this order's line went out
  // on it and the order itself — the four facts a storekeeper recognises a
  // despatch by. No unit word: a bought-material deviation can be in KGS or MTR
  // and the NC read model carries no unit, so "pcs" would be a guess. The order
  // code is also hidden search text, so typing the PO number finds its challans.
  const sourceDcOptions = useMemo<SearchableOption[]>(
    () =>
      (sourceDcQuery.data?.items ?? []).map((c) => {
        const sent = Number(c.sentQty);
        const parts = [
          fmtDate(c.dcDate, ''),
          Number.isFinite(sent) && sent > 0 ? `Qty ${sent}` : '',
          c.poCode ?? '',
        ].filter((part) => part !== '');
        return {
          id: c.sourceDeliveryChallanId,
          code: c.sourceDeliveryChallanCode,
          // Never an empty label: with no date and nothing sent the dropdown
          // would read "IN-DC-00002/R1 — " with a dangling dash.
          name: parts.length > 0 ? parts.join(' · ') : c.sourceDeliveryChallanCode,
          searchText: c.poCode,
        };
      }),
    [sourceDcQuery.data],
  );

  // Dependent-field sync (house rule): the challan belongs to the return-to-
  // vendor branch alone, so switching the action away clears it; exactly ONE
  // candidate selects itself — visibly, in the field, so the user reads what is
  // about to be recorded instead of it happening silently; and an id that is no
  // longer among the candidates is dropped rather than sent. The effect only
  // runs when the action or the candidate list changes, so a user who clears the
  // single auto-filled candidate on purpose keeps it cleared.
  useEffect(() => {
    if (!isRtv) {
      setSourceDcId(null);
      return;
    }
    if (sourceDcOptions.length === 1) {
      const only = sourceDcOptions[0]?.id ?? null;
      setSourceDcId((prev) => (prev === null ? only : prev));
      return;
    }
    setSourceDcId((prev) =>
      prev !== null && !sourceDcOptions.some((o) => o.id === prev) ? null : prev,
    );
  }, [isRtv, sourceDcOptions]);

  // The chosen challan, for the text the field SHOWS. SearchableSelect only
  // fills its box by itself when the user clicks an option, so without this the
  // one auto-selected candidate would be recorded with an empty-looking field —
  // the silent default the decision rules out.
  const selectedDc = sourceDcOptions.find((o) => o.id === sourceDcId);

  // Mirror the server guard (§3) so the operator never picks an action the API
  // will refuse. `sourceVendorId` is the read model's single signal for where
  // the rejected material came from:
  //   • vendor-sourced (GRN / OSP reject) → no in-house op to rework/repair, so
  //     those two are hidden; return_to_vendor stays.
  //   • in-house        → no vendor to return to, so return_to_vendor is hidden.
  // scrap needs the approve tier; use_as_is needs the NC's operation (it puts
  // the pieces back on it); make_fresh is always valid.
  const isVendorSourced = nc.sourceVendorId != null;
  const hasOp = nc.opSeq != null && nc.jcOpId != null;
  // ADR-189 — a bought-material reject (no job card) can only be scrapped or
  // returned to the vendor; the server refuses anything else.
  const isMaterialNc = nc.jobCardId == null;
  const availableActions = useMemo<readonly NcDisposition[]>(
    () =>
      ACTION_ORDER.filter((a) => {
        if (isMaterialNc && a !== 'scrap' && a !== 'return_to_vendor') return false;
        if (a === 'scrap' && !canApprove) return false;
        if (a === 'use_as_is' && !hasOp) return false;
        return isVendorSourced ? a !== 'rework' && a !== 'repair' : a !== 'return_to_vendor';
      }),
    [isVendorSourced, canApprove, hasOp, isMaterialNc],
  );

  const reworkOps = useMemo<JcOpOption[]>(() => {
    if (jcOps.length > 0) return jcOps;
    return nc.opSeq != null ? [{ opSeq: nc.opSeq, operation: '' }] : [];
  }, [jcOps, nc.opSeq]);

  // S9 — decimals: a bought-material (KG) reject may be split to 3 places; a
  // disposition that works on the job card (rework / repair / make fresh /
  // use as is) counts whole pieces. The item's own unit rule is the server's.
  const needsWhole = !isMaterialNc && action !== '' && action !== 'scrap';
  const qtyStep = needsWhole ? '1' : QTY_STEP;
  const qtyNum = qty === '' ? 0 : Number(qty);
  const qtyValid =
    qtyNum > 0 &&
    qtyNum <= openQty &&
    hasQtyPrecision(qtyNum) &&
    (!needsWhole || Number.isInteger(qtyNum));
  const remainder = qtyValid ? roundQty(openQty - qtyNum) : 0;
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
    // ADR-217 phase 3 — only for a return to vendor, and only when a challan was
    // actually chosen. Nobody is forced to answer, so the key is omitted (never
    // sent as null) when it was left blank, and never sent at all by any other
    // disposition.
    if (action === 'return_to_vendor' && sourceDcId !== null) {
      payload.sourceDeliveryChallanId = sourceDcId;
    }
    void onSubmit(payload);
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Disposition</div>
      </div>
      <div className="panel-body">
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
                  <option value="">-- Select Disposition --</option>
                  {availableActions.map((a) => (
                    <option key={a} value={a}>
                      {NC_DISPOSITION_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-grp">
                <label className="form-label" htmlFor="dispQty">
                  Disposition Qty<span className="req">★</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    id="dispQty"
                    type="number"
                    min={qtyStep}
                    max={openQty}
                    step={qtyStep}
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
                  <div className="form-error">
                    {needsWhole
                      ? `Enter a whole number from 1 to ${openQty} — this disposition works in whole pieces.`
                      : `Enter a qty more than 0 and up to ${openQty} (at most 3 decimals).`}
                  </div>
                ) : null}
                {qtyValid && remainder > 0 ? (
                  <div className="form-help">New NC for the other {remainder} pcs.</div>
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
                        {nc.opSeq != null
                          ? `Defaults to Op ${opSrNo(nc.opSeq)}`
                          : '-- Select Op --'}
                      </option>
                      {reworkOps.map((o) => (
                        <option key={o.opSeq} value={o.opSeq}>
                          Op {opSrNo(o.opSeq)}
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
                </div>
              ) : null}

              {/* ADR-217 phase 3 — `Sent on DC No.` (docs/NAMING.md row 205).
                  Rendered only for a return to vendor, and only when there is
                  at least one candidate: with none the field does not exist, so
                  it can never stand in the way of a disposition. Optional by
                  decision — a storekeeper who genuinely does not know which
                  challan carried the pieces must still be able to dispose. */}
              {isRtv && sourceDcOptions.length > 0 ? (
                <div className="form-grp form-full">
                  <label className="form-label" htmlFor="dispSourceDc">
                    Sent on DC No.
                  </label>
                  <SearchableSelect
                    id="dispSourceDc"
                    value={sourceDcId}
                    onChange={setSourceDcId}
                    options={sourceDcOptions}
                    valueLabel={
                      selectedDc
                        ? selectedDc.code
                          ? `${selectedDc.code} — ${selectedDc.name}`
                          : selectedDc.name
                        : undefined
                    }
                    onSearch={() => {}}
                    loading={sourceDcQuery.isFetching}
                    placeholder="Click to browse the outward challans…"
                    emptyText="No outward challan matches"
                  />
                  <div className="form-help">
                    {sourceDcOptions.length === 1
                      ? 'The one outward challan behind this deviation — change it if the pieces went out on another.'
                      : 'Nothing in the records says which of these challans carried the rejected pieces, so only you can. Leave it blank if you are not sure.'}
                  </div>
                </div>
              ) : null}

              {action === 'scrap' && canSeePrice ? (
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
              ) : null}

              <div className="form-grp form-full">
                <label className="form-label" htmlFor="dispRemarks">
                  Remarks
                </label>
                <textarea
                  id="dispRemarks"
                  className="innovic-textarea"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>

            {/* What each choice will DO — the user reads this before Save. */}
            {isRecovery && !isLegacyRework ? (
              <Note tone="blue">
                Creates a {action === 'rework' ? 'Rework' : 'Repair'} JC for {noteQty} pcs. Add its
                operations there.
              </Note>
            ) : null}

            {action === 'return_to_vendor' ? (
              <Note tone="blue">
                Next: raise the return challan from this deviation, to send the pieces back. (The
                field above records the challan they originally went OUT on.)
              </Note>
            ) : null}

            {action === 'make_fresh' ? (
              <Note tone="blue">Creates a new JC for {noteQty} pcs on the same SO.</Note>
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
                Save Disposition
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
        Saved — {nc.code}:{' '}
        <b>
          {nc.disposition ? NC_DISPOSITION_LABELS[nc.disposition] : NC_STATUS_LABELS[nc.status]}
        </b>{' '}
        for {Number(nc.rejectedQty)} pcs.
      </Note>
      {childJobCardId && childJobCardCode ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <span className="text3">{nc.disposition === 'repair' ? 'Repair' : 'Rework'} JC:</span>{' '}
          <Link
            to="/job-cards/$id"
            params={{ id: childJobCardId }}
            className="mono fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {childJobCardCode}
          </Link>
        </div>
      ) : null}
      {remainderNc ? (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <span className="text3">New NC for the other {Number(remainderNc.rejectedQty)} pcs:</span>{' '}
          <Link
            to="/nc-register/$id"
            params={{ id: remainderNc.id }}
            className="mono fw-700"
            style={{ color: 'var(--red2)', textDecoration: 'none' }}
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
