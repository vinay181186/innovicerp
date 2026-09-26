// Receive-back route (T-059b). Loads the parent DC → renders per-line input
// for received qty only → submits a receipt. Received qty lands on an auto-GRN
// as pending QC; the accept/reject (OK/not-OK) decision is made later at
// Incoming QC, which is the single place a reject raises a defect record. On
// full reconcile the DC status flips to received and any outsource-op-driven
// JC cascade fires server-side.

import type { CreateDeliveryChallanReceiptInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useDeliveryChallan, useReceiveDeliveryChallan } from '../api';
import { computeReceivedByLine } from '../lib/receipt-math';

export const deliveryChallanReceiveRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id/receive',
  component: DeliveryChallanReceivePage,
});

const RECEIVE_FORM_ID = 'dc-receive-form';

interface LineDraft {
  dcLineId: string;
  lineNo: number;
  itemCodeText: string;
  /** The customer's drawing revision, carried through so the code on this
   *  screen reads the same as on the challan it is booking back. Null on every
   *  line the API could not prove is the customer's part — raw material and
   *  bought-in lines — and those show the bare code. */
  itemRevision: string | null;
  /** The CUSTOMER's PO line number off the SO line behind this challan line. */
  clientPoLineNo: string | null;
  itemNameText: string | null;
  sentQty: number;
  /** ADR-189 — good pieces back so far; rejects are their own column, as on
   *  the DC detail page, so "Received" means one thing on both screens. */
  alreadyReceived: number;
  alreadyRejected: number;
  remaining: number;
  receivedQty: string;
}

function DeliveryChallanReceivePage(): React.JSX.Element {
  const { id } = deliveryChallanReceiveRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useDeliveryChallan(id);
  const receive = useReceiveDeliveryChallan();
  // Booking material back is `entry` on ospdc_create (Purchase) — the same right
  // that raised the DC. Checked here too because the route is reachable by URL.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  // Where the Cancel link goes, and where ESC -> Exit goes. Every other way
  // off the screen (Back link, breadcrumb, browser Back) gets "Are you sure?".
  const goBack = useCallback(
    () => void navigate({ to: '/delivery-challans/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const [receiptDate, setReceiptDate] = useState(todayLocal());
  const [vendorInvoiceText, setVendorInvoiceText] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const receivedByLine = computeReceivedByLine(detail);
    const rejectedByLine = new Map<string, number>();
    for (const r of detail.receipts) {
      for (const rl of r.lines) {
        rejectedByLine.set(
          rl.deliveryChallanLineId,
          (rejectedByLine.get(rl.deliveryChallanLineId) ?? 0) + Number(rl.rejectedQty ?? 0),
        );
      }
    }
    setLineDrafts(
      detail.lines.map((l) => {
        // Everything back so far (good + rejected) — what Pending subtracts.
        const already = receivedByLine.get(l.id) ?? 0;
        const rejected = rejectedByLine.get(l.id) ?? 0;
        const sent = Number(l.qty);
        return {
          dcLineId: l.id,
          lineNo: l.lineNo,
          itemCodeText: l.itemCodeText,
          itemRevision: l.itemRevision,
          clientPoLineNo: l.clientPoLineNo,
          itemNameText: l.itemNameText,
          sentQty: sent,
          alreadyReceived: already - rejected,
          alreadyRejected: rejected,
          remaining: Math.max(0, sent - already),
          receivedQty: '',
        };
      }),
    );
  }, [detail]);

  const updateDraft = (idx: number, patch: Partial<LineDraft>): void => {
    setLineDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const canSubmit = useMemo(() => {
    if (!receiptDate) return false;
    let anyQty = false;
    for (const d of lineDrafts) {
      const recv = Number(d.receivedQty || '0');
      if (recv < 0) return false;
      if (recv > d.remaining) return false;
      if (recv > 0) anyQty = true;
    }
    return anyQty && !submitting;
  }, [lineDrafts, receiptDate, submitting]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const linesPayload = lineDrafts
        .map((d) => ({
          deliveryChallanLineId: d.dcLineId,
          receivedQty: Number(d.receivedQty || '0'),
        }))
        .filter((l) => l.receivedQty > 0);

      const input: CreateDeliveryChallanReceiptInput = {
        receiptDate,
        vendorInvoiceText: vendorInvoiceText.trim() === '' ? null : vendorInvoiceText.trim(),
        remarks: remarks.trim() === '' ? null : remarks.trim(),
        lines: linesPayload,
      };
      await receive.mutateAsync({ dcId: id, input });
      exit.leave(() => void navigate({ to: '/delivery-challans/$id', params: { id } }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save receipt. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitForm = useCallback(() => {
    const el = document.getElementById(RECEIVE_FORM_ID);
    if (el instanceof HTMLFormElement) el.requestSubmit();
  }, []);
  useSaveShortcut(submitForm, canSubmit && perms.entry);
  const dirty =
    vendorInvoiceText !== '' || remarks !== '' || lineDrafts.some((d) => d.receivedQty !== '');

  // FLOW HELPER (frontend only): put each line's Pending into its Receive Now
  // box. Lines with nothing pending stay blank. Every box stays editable;
  // nothing is filled until this is clicked.
  const fillAllPending = (): void => {
    setLineDrafts((prev) =>
      prev.map((d) => ({ ...d, receivedQty: d.remaining > 0 ? String(d.remaining) : '' })),
    );
  };

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          ⛔ You do not have entry access to receive against a delivery challan.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading delivery challan…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/delivery-challans" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Delivery challan not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title={`Receive against ${detail.vendorName ?? detail.vendorCodeText}`}
        subtitle={
          <>
            <span className="td-code">{detail.code}</span> · Received qty goes to Incoming QC.
          </>
        }
        backLabel="Back to DC"
        onBack={goBack}
        dirty={dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="submit"
              form={RECEIVE_FORM_ID}
              className="btn btn-primary"
              disabled={!canSubmit}
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
              {submitting ? 'Recording…' : 'Record receipt'}
            </button>
          </>
        }
      />

      {/* Save error right under the header's Save. */}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}

      <form id={RECEIVE_FORM_ID} onSubmit={(e) => void onSubmit(e)}>
        <div className="panel">
          <div className="panel-hdr">
            <h2 className="panel-title">Receipt header</h2>
          </div>
          <div className="panel-body">
            {/* 12-column grid: Receipt date · Vendor invoice · Remarks (3 + 3 + 6). */}
            <FormGrid>
              <FormField label="Receipt date" required size="sm" htmlFor="receiptDate">
                <input
                  id="receiptDate"
                  type="date"
                  className="innovic-input"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Vendor invoice" size="sm" htmlFor="vendorInvoice">
                <input
                  id="vendorInvoice"
                  type="text"
                  className="innovic-input"
                  placeholder="optional"
                  value={vendorInvoiceText}
                  onChange={(e) => setVendorInvoiceText(e.target.value)}
                />
              </FormField>
              <FormField label="Remarks" size="lg" htmlFor="remarks">
                <input
                  id="remarks"
                  type="text"
                  className="innovic-input"
                  placeholder="optional"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </FormField>
            </FormGrid>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hdr">
            <h2 className="panel-title">Lines</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={fillAllPending}>
              Fill all pending
            </button>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Ln</th>
                  {/* POL = the CUSTOMER's own PO line number off the SO line
                      behind this challan line. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Item Code · Name</th>
                  <th className="th-num">Sent</th>
                  <th className="th-num">Received</th>
                  <th className="th-num">Rejected</th>
                  <th className="th-num">Pending</th>
                  <th className="th-num">Receive Now</th>
                </tr>
              </thead>
              <tbody>
                {lineDrafts.map((d, idx) => (
                  <tr key={d.dcLineId}>
                    <td className="mono">{d.lineNo}</td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {d.clientPoLineNo ?? '—'}
                    </td>
                    <td>
                      <span className="mono fw-700">
                        {itemCodeWithRev(d.itemCodeText, d.itemRevision)}
                      </span>
                      {d.itemNameText ? (
                        <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                          {d.itemNameText}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono td-num">{d.sentQty.toFixed(0)}</td>
                    <td className="mono td-num">{d.alreadyReceived.toFixed(0)}</td>
                    <td className="mono td-num">{d.alreadyRejected.toFixed(0)}</td>
                    <td className="mono td-num fw-700">{d.remaining.toFixed(0)}</td>
                    <td className="td-num">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={d.remaining}
                        className="innovic-input"
                        value={d.receivedQty}
                        onChange={(e) => updateDraft(idx, { receivedQty: e.target.value })}
                        disabled={d.remaining === 0}
                        style={{ width: 90 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </div>
  );
}
