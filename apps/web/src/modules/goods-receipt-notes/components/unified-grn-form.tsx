// Unified GRN (Inward) create shell — the create screen for BOTH
// /goods-receipt-notes/new and (port-only) /goods-receipt-notes/$id/edit.
//
// Canonical source: legacy `addGRN()` — legacy/InnovicERP_v82_12_3_DataLossFix
// _29-04-2026.html L26515, reached from the list's "+ New GRN" button (renderGRN
// L26481) and from createGRNfromPO() L26730. It builds its modal body as an
// INLINE literal (L26530-26565) — there is no shared GRN body builder — and
// passes it to showModalLg(title, body, onSave, 'Create GRN') at L26567.
// Legacy has NO editGRN/viewGRN: zero row-level edit affordance on any status.
//
// The GRN Type dropdown below replaces legacy's 3-button selector (L26530-26536,
// _grnSetMode L26627). Legacy offered 📦 Against PO / 🏭 Against JWPO / DC /
// ✍ Manual; Manual is not ported (GRN_INWARD_TYPES in packages/shared has no
// 'manual' member — see ISSUE-205). In its place is the NC return (ADR-161).
//
// The three types — every one reuses an endpoint that already exists; no new
// GRN write path was added for any of them:
//   Against PO        → <GrnAgainstPoForm>: pick an approved buying PO, its
//                       pending lines load, save via POST /goods-receipt-notes.
//                       The server auto-numbers the GRN (nextGrnCode).
//   Against JWPO / DC → <GrnAgainstDcForm>: pick the job-work PO and/or one of
//                       its OSP delivery challans still out at the vendor, and
//                       save via POST /delivery-challans/:id/receive — the same
//                       path the DC Receive page uses, so the GRN is auto-raised
//                       and linked to the DC and the PO's received qty moves.
//   Against NC        → <GrnAgainstNcForm>: pick an NC whose "return to vendor"
//                       challan is still out (ADR-161 — one challan per NC, no
//                       PO behind it). The challan IS the source, so this is the
//                       SAME receive call as the DC tab: the server raises the
//                       GRN with nc_id, bumps the NC's rtv_received_qty and sets
//                       it received_qc_pending for Incoming QC to credit.
// No type carries QC fields; QC happens later at Incoming QC. The old
// <GoodsReceiptNoteForm> still serves /goods-receipt-notes/$id/edit only.

import {
  GRN_INWARD_TYPES,
  type CreateGoodsReceiptNoteInput,
  type GrnInwardType,
} from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { FormField } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useCreateGoodsReceiptNote } from '../api';
import { GrnAgainstDcForm } from './grn-against-dc-form';
import { GrnAgainstNcForm } from './grn-against-nc-form';
import { GrnAgainstPoForm } from './grn-against-po-form';
import { GRN_CREATE_FORM_ID, type GrnFormStatus } from './grn-create-contract';

// Option text — the first two verbatim from legacy addGRN() L26533-26534.
const TYPE_META: Record<GrnInwardType, { label: string }> = {
  purchase: { label: 'Against PO' },
  job_work_return: { label: 'Against JW PO / DC' },
  nc_return: { label: 'Against NC' },
};

function isInwardType(v: string): v is GrnInwardType {
  return (GRN_INWARD_TYPES as readonly string[]).includes(v);
}

const IDLE: GrnFormStatus = { submitting: false, blocked: false, dirty: false };

export function UnifiedGrnForm({
  initialPurchaseOrderId,
}: {
  initialPurchaseOrderId?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  // A `?poId=` preselect is always a buying PO, so the type starts (and stays
  // unless the user changes it) on Against PO.
  const [inwardType, setInwardType] = useState<GrnInwardType>('purchase');
  // What the active type form last reported: drives the header's Create
  // button (disabled while saving / blocked) and the "Not saved" pill.
  const [status, setStatus] = useState<GrnFormStatus>(IDLE);
  // ONE exit guard for the whole inward screen, every type. Where Cancel goes
  // is where ESC → Exit goes; every other way off the screen (Back link,
  // breadcrumb, browser Back) gets "Are you sure?". The DC and NC forms live
  // inside this component, so they are handed `exit.leave` (as `onLeave`) for
  // their save rather than a second guard.
  const goBack = useCallback(() => void navigate({ to: '/goods-receipt-notes' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Purchase branch — the existing create endpoint; the form is the new
  // PO-driven one (lines come from the PO, never typed by hand).
  const createPurchase = useCreateGoodsReceiptNote();
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);
  const onPurchaseSubmit = async (values: CreateGoodsReceiptNoteInput): Promise<void> => {
    setPurchaseErr(null);
    try {
      const created = await createPurchase.mutateAsync(values);
      exit.leave(
        () =>
          void navigate({
            to: '/goods-receipt-notes/$id',
            params: { id: created.id },
            replace: true,
          }),
      );
    } catch (e) {
      setPurchaseErr(e instanceof Error ? e.message : 'Could not save GRN. Try again.');
    }
  };

  // Save lives in the sticky header; the active type form owns the handler.
  // The button reaches it through the HTML `form` attribute, and Ctrl+S
  // submits the same form, so both paths run the form's own checks.
  const canSave = !status.submitting && !status.blocked;
  const submitActiveForm = useCallback(() => {
    const el = document.getElementById(GRN_CREATE_FORM_ID);
    if (el instanceof HTMLFormElement) el.requestSubmit();
  }, []);
  useSaveShortcut(submitActiveForm, canSave);

  // GRN Type — rendered by the type form as the first field of its header
  // grid, so it sits with the other header fields instead of alone on a row.
  const typeField = (
    <FormField label="GRN Type" required size="sm" htmlFor="grnInwardType">
      <select
        id="grnInwardType"
        className="innovic-select"
        value={inwardType}
        onChange={(e) => {
          const v = e.target.value;
          if (isInwardType(v)) {
            setStatus(IDLE);
            setInwardType(v);
          }
        }}
      >
        {GRN_INWARD_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_META[t].label}
          </option>
        ))}
      </select>
    </FormField>
  );

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        icon="📥"
        title="New GRN"
        backLabel="Back to GRN list"
        onBack={goBack}
        dirty={status.dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="submit"
              form={GRN_CREATE_FORM_ID}
              className="btn btn-primary"
              disabled={!canSave}
            >
              {status.submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : (
                'Create GRN'
              )}
            </button>
          </>
        }
      />

      {/* Switching type unmounts the other form, so its picks and lines
          are dropped — no stale state crosses over. */}
      {inwardType === 'purchase' ? (
        <GrnAgainstPoForm
          {...(initialPurchaseOrderId ? { initialPurchaseOrderId } : {})}
          typeField={typeField}
          onStatusChange={setStatus}
          onSubmit={onPurchaseSubmit}
          submitError={purchaseErr}
        />
      ) : null}
      {inwardType === 'job_work_return' ? (
        <GrnAgainstDcForm typeField={typeField} onStatusChange={setStatus} onLeave={exit.leave} />
      ) : null}
      {inwardType === 'nc_return' ? (
        <GrnAgainstNcForm typeField={typeField} onStatusChange={setStatus} onLeave={exit.leave} />
      ) : null}
    </div>
  );
}
