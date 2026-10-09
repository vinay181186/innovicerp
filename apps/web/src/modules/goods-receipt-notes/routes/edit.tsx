// GRN new + edit routes (UI-003-05).

import type { GoodsReceiptNoteDetail, UpdateGoodsReceiptNoteInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { isStagedResult } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useFetchGoodsReceiptNote, useGoodsReceiptNote, useUpdateGoodsReceiptNote } from '../api';
import { GoodsReceiptNoteForm } from '../components/goods-receipt-note-form';
import { grnLinesDigest } from '../lib/grn-lines-digest';

const GRN_EDIT_FORM_ID = 'grn-edit-form';
import { UnifiedGrnForm } from '../components/unified-grn-form';

// ADR-226 — the HEADER fields this screen can edit, plus `lines` as one unit.
//
// The payload is `{ header, lines }`, so the diff runs against `values.header`
// and these are keys of the GRN itself. Written out rather than inferred because
// the GRN record carries far more than this form touches.
//
// `purchaseOrderId` is deliberately NOT here: on a saved GRN the source document
// is a read-only fact (the form shows `PO No.` as a ClusterFact, or the legacy
// `PO No. (not linked)` text box, which writes `poCodeText`). No input on this
// screen writes it, so it must never be sent as an edit.
//
// `lines` IS in the list, as ONE value: the record the hook compares against
// carries `lines` as a digest string (grn-lines-digest.ts) instead of the array,
// because the lines are all-or-nothing on this document and the most ordinary
// GRN edit of all — a Received Qty correction with no header change — would
// otherwise be refused as "nothing changed". A line is never sent on its own.
//
// Labels come from docs/NAMING.md, so the notice says "Vendor Challan No.",
// never `dcNo`.
const GRN_EDITABLE = [
  'grnDate',
  'poCodeText',
  'vendorId',
  'vendorCodeText',
  'invoiceNo',
  'dcNo',
  'remarks',
  'lines',
] as const;

const GRN_LABELS: Record<string, string> = {
  grnDate: 'GRN Date',
  poCodeText: 'PO No.',
  vendorId: 'Vendor',
  vendorCodeText: 'Vendor Code',
  invoiceNo: 'Vendor Invoice No.',
  dcNo: 'Vendor Challan No.',
  remarks: 'GRN Remarks',
  lines: 'The received lines',
};

/** The GRN as the conflict hook compares it: the same record, with the line
 *  ARRAY replaced by one digest string. Keeping the key name means the notice
 *  and the clash check read it as the single fact it behaves like. */
type GrnConflictRecord = Omit<GoodsReceiptNoteDetail, 'lines'> & { lines: string };

function toConflictRecord(detail: GoodsReceiptNoteDetail): GrnConflictRecord {
  return { ...detail, lines: grnLinesDigest(detail.lines) };
}

const newSearchSchema = z.object({
  poId: z.string().uuid().optional(),
});

export const goodsReceiptNoteNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/new',
  validateSearch: newSearchSchema,
  component: GoodsReceiptNoteNewPage,
});

export const goodsReceiptNoteEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id/edit',
  component: GoodsReceiptNoteEditPage,
});

function GoodsReceiptNoteNewPage(): React.JSX.Element {
  const { poId } = goodsReceiptNoteNewRoute.useSearch();
  // Tier-driven, per department (Store). The + New GRN button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the live inward form (an L1 Viewer, an
  // L4 Approver). `new` and `edit` share this file but not this gate.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading GRN…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to GRN list
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to create GRNs. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  // Unified inward shell: type selector + per-type sections. The Purchase tab
  // reuses the same create form/endpoint this page used before (unchanged).
  return <UnifiedGrnForm {...(poId ? { initialPurchaseOrderId: poId } : {})} />;
}

function GoodsReceiptNoteEditPage(): React.JSX.Element {
  const { id } = goodsReceiptNoteEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
  const update = useUpdateGoodsReceiptNote(id);
  const fetchGrn = useFetchGoodsReceiptNote();
  const conflictRecord = useMemo(() => (detail ? toConflictRecord(detail) : undefined), [detail]);
  // ADR-226 / §20.4 — sends only the header fields that changed, merges onto
  // someone else's save instead of overwriting it, and raises the 3-second
  // notice. Also subscribes to this one GRN, so the storekeeper is told the
  // moment Incoming QC or another clerk saves it rather than after typing into
  // a stale form.
  const conflict = useEditConflict({
    table: 'goods_receipt_notes',
    id,
    record: conflictRecord,
    refetch: async () => toConflictRecord(await fetchGrn(id)),
    editableKeys: GRN_EDITABLE,
    label: (f) => GRN_LABELS[f] ?? f,
    noun: 'GRN',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE GRN is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  // Tier-driven, per department (Store). This screen had no gate at all —
  // typing the URL handed the form to anyone, including an L1 Viewer and an
  // L2 Data Entry clerk, who deliberately cannot change a saved record.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');
  // Where Cancel goes, and where ESC → Exit goes. Every other way off the
  // screen (Back link, breadcrumb, browser Back) gets "Are you sure?".
  const goBack = useCallback(
    () => void navigate({ to: '/goods-receipt-notes/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
  // Save lives in the sticky header; the form reports whether it can submit.
  const [formStatus, setFormStatus] = useState({
    submitting: false,
    canSubmit: true,
    dirty: false,
  });
  const submitForm = useCallback(() => {
    const el = document.getElementById(GRN_EDIT_FORM_ID);
    if (el instanceof HTMLFormElement) el.requestSubmit();
  }, []);
  useSaveShortcut(submitForm, formStatus.canSubmit && Boolean(detail) && perms.edit);

  const onSubmit = async (values: UpdateGoodsReceiptNoteInput): Promise<void> => {
    setSubmitError(null);
    if (!detail) return;
    // `current` is what the form holds; the hook reduces it to just the changed
    // keys. `lines` is the DIGEST, so a lines-only edit still counts as a change
    // (the header diff would be empty, and the hook refuses an empty save) and a
    // header-only edit leaves the array out of the request entirely — the GRN
    // update reads an absent `lines` key as "leave the lines alone".
    const outgoing = values.lines;
    const current = {
      ...values.header,
      // No lines in the submission at all (the form always sends them, so this
      // is belt and braces) must read as "untouched", never as an empty set —
      // an empty array would soft-delete every line on the GRN.
      lines: grnLinesDigest(outgoing ?? detail.lines),
    };
    try {
      const saved = await conflict.save(current, (payload, expectedUpdatedAt) => {
        const { lines, ...header } = payload;
        return update.mutateAsync({
          header,
          // The digest in the payload only says WHETHER the lines moved; the
          // array itself is what the server needs. NOT merged per line: a GRN
          // line can be added and removed, so on a retry the whole set goes
          // back as it stood when the screen opened, and the orange notice says
          // so when the other person had changed the lines too.
          ...(lines !== undefined && outgoing ? { lines: outgoing } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
      });
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (saved === null) return;
      if (isStagedResult(saved)) {
        // The edit-approval gate is on and this GRN is live: nothing was changed
        // on the GRN — the edit is now waiting for approval. Say so, then return
        // to the GRN (its fields now carry the pending-change chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(
          () => void navigate({ to: '/goods-receipt-notes/$id', params: { id }, replace: true }),
        );
        return;
      }
      exit.leave(
        () => void navigate({ to: '/goods-receipt-notes/$id', params: { id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save GRN. Try again.');
    }
  };

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading GRN…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to GRN
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to edit GRNs. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'GRN not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <PageHeader
        sticky
        title="Edit GRN"
        /* No subtitle: the form's identity line carries the GRN No. (and the
           type, the source document and the vendor) — layout rule 7. One
           number, in one place. */
        backLabel="Back to GRN"
        onBack={goBack}
        dirty={formStatus.dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="submit"
              form={GRN_EDIT_FORM_ID}
              className="btn btn-primary"
              disabled={!formStatus.canSubmit}
            >
              {formStatus.submitting ? <Loader2 size={13} className="animate-spin" /> : null}
              Save Changes
            </button>
          </>
        }
      />
      <GoodsReceiptNoteForm
        mode="edit"
        detail={detail}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
        formId={GRN_EDIT_FORM_ID}
        onStatusChange={setFormStatus}
      />
    </div>
  );
}
