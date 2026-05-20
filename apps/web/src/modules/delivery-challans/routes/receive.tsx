// Receive-back route (T-059b). Loads the parent DC → renders per-line input
// for received + rejected qty + reject reason → submits a receipt. On full
// reconcile the DC status flips to received, auto-NCs are emitted for any
// rejected qty, and any outsource-op-driven JC cascade fires server-side.

import type { CreateDeliveryChallanReceiptInput, DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeliveryChallan, useReceiveDeliveryChallan } from '../api';

export const deliveryChallanReceiveRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id/receive',
  component: DeliveryChallanReceivePage,
});

interface LineDraft {
  dcLineId: string;
  lineNo: number;
  itemCodeText: string;
  itemNameText: string | null;
  sentQty: number;
  alreadyReceived: number;
  remaining: number;
  receivedQty: string;
  rejectedQty: string;
  rejectReason: string;
}

function DeliveryChallanReceivePage(): React.JSX.Element {
  const { id } = deliveryChallanReceiveRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useDeliveryChallan(id);
  const receive = useReceiveDeliveryChallan();

  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorInvoiceText, setVendorInvoiceText] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const receivedByLine = computeReceivedByLine(detail);
    setLineDrafts(
      detail.lines.map((l) => {
        const already = receivedByLine.get(l.id) ?? 0;
        const sent = Number(l.qty);
        return {
          dcLineId: l.id,
          lineNo: l.lineNo,
          itemCodeText: l.itemCodeText,
          itemNameText: l.itemNameText,
          sentQty: sent,
          alreadyReceived: already,
          remaining: Math.max(0, sent - already),
          receivedQty: '',
          rejectedQty: '',
          rejectReason: '',
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
      const rej = Number(d.rejectedQty || '0');
      if (recv < 0 || rej < 0) return false;
      if (recv + rej > d.remaining) return false;
      if (recv > 0 || rej > 0) anyQty = true;
      if (rej > 0 && d.rejectReason.trim() === '') return false;
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
          rejectedQty: Number(d.rejectedQty || '0'),
          rejectReason: d.rejectReason.trim() === '' ? null : d.rejectReason.trim(),
        }))
        .filter((l) => l.receivedQty > 0 || l.rejectedQty > 0);

      const input: CreateDeliveryChallanReceiptInput = {
        receiptDate,
        vendorInvoiceText: vendorInvoiceText.trim() === '' ? null : vendorInvoiceText.trim(),
        remarks: remarks.trim() === '' ? null : remarks.trim(),
        lines: linesPayload,
      };
      await receive.mutateAsync({ dcId: id, input });
      void navigate({ to: '/delivery-challans/$id', params: { id } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to record receipt.');
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Delivery challan not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/delivery-challans/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to DC
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Receive against {detail.vendorName ?? detail.vendorCodeText}
            </div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Record qty received + rejected per line. Rejected qty auto-creates an NC; only the
              received qty goes back to stock.
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Receipt header</div>
          </div>
          <div className="panel-body">
            <div className="form-grid form-grid-3">
              <div className="form-grp">
                <label className="form-label" htmlFor="receiptDate">
                  Receipt date<span className="req">★</span>
                </label>
                <input
                  id="receiptDate"
                  type="date"
                  className="innovic-input"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="vendorInvoice">
                  Vendor invoice
                </label>
                <input
                  id="vendorInvoice"
                  type="text"
                  className="innovic-input"
                  placeholder="optional"
                  value={vendorInvoiceText}
                  onChange={(e) => setVendorInvoiceText(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="remarks">
                  Remarks
                </label>
                <input
                  id="remarks"
                  type="text"
                  className="innovic-input"
                  placeholder="optional"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hdr">
            <div>
              <div className="panel-title">Lines</div>
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                Each row shows what was sent and what's still outstanding. Enter the qty just
                received. Reject reason is required when rejected qty &gt; 0.
              </div>
            </div>
          </div>
          <div className="panel-body">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th className="td-right">Sent</th>
                    <th className="td-right">Already recv</th>
                    <th className="td-right">Remaining</th>
                    <th>Receive now</th>
                    <th>Reject now</th>
                    <th>Reject reason</th>
                  </tr>
                </thead>
                <tbody>
                  {lineDrafts.map((d, idx) => (
                    <tr key={d.dcLineId}>
                      <td className="td-ctr mono">{d.lineNo}</td>
                      <td>
                        <span className="mono">{d.itemCodeText}</span>
                        {d.itemNameText ? (
                          <div className="text3" style={{ fontSize: 11 }}>
                            {d.itemNameText}
                          </div>
                        ) : null}
                      </td>
                      <td className="td-right mono">{d.sentQty.toFixed(0)}</td>
                      <td className="td-right mono">{d.alreadyReceived.toFixed(0)}</td>
                      <td className="td-right mono fw-700">{d.remaining.toFixed(0)}</td>
                      <td>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={d.remaining}
                          className="innovic-input"
                          value={d.receivedQty}
                          onChange={(e) => updateDraft(idx, { receivedQty: e.target.value })}
                          disabled={d.remaining === 0}
                          style={{ width: 90, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={d.remaining}
                          className="innovic-input"
                          value={d.rejectedQty}
                          onChange={(e) => updateDraft(idx, { rejectedQty: e.target.value })}
                          disabled={d.remaining === 0}
                          style={{ width: 90, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <textarea
                          rows={2}
                          className="innovic-textarea"
                          value={d.rejectReason}
                          onChange={(e) => updateDraft(idx, { rejectReason: e.target.value })}
                          placeholder={
                            Number(d.rejectedQty || '0') > 0 ? 'Required' : 'Only if rejecting'
                          }
                          disabled={Number(d.rejectedQty || '0') === 0}
                          style={{ minWidth: 180 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {submitError ? (
          <div
            style={{
              color: 'var(--red)',
              background: 'var(--red3)',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {submitError}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Link
            to="/delivery-challans/$id"
            params={{ id }}
            className="btn btn-ghost"
          >
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {submitting ? 'Recording…' : 'Record receipt'}
          </button>
        </div>
      </form>
    </div>
  );
}

function computeReceivedByLine(detail: DeliveryChallanWithLines): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of detail.receipts) {
    for (const rl of r.lines) {
      const prev = out.get(rl.deliveryChallanLineId) ?? 0;
      out.set(rl.deliveryChallanLineId, prev + Number(rl.receivedQty) + Number(rl.rejectedQty));
    }
  }
  return out;
}
