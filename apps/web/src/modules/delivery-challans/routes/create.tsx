// New DC route (T-059a). Pick a JW PO → load its lines → enter ship qty per
// line → submit. On success → redirect to detail. Mirrors PO from-pr pattern.

import type { CreateDeliveryChallanInput, Uom } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { usePurchaseOrder } from '@/modules/purchase-orders/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateDeliveryChallan } from '../api';

const newSearchSchema = z.object({
  poId: z.string().uuid().optional(),
});

export const deliveryChallanNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/new',
  validateSearch: newSearchSchema,
  component: DeliveryChallanNewPage,
});

interface LineDraft {
  purchaseOrderLineId: string;
  itemId: string;
  itemCodeText: string;
  itemNameText: string | null;
  uom: Uom;
  poLineQty: number;
  shipQty: string;
  materialText: string;
  dcRemarks: string;
}

function DeliveryChallanNewPage(): React.JSX.Element {
  const { poId } = deliveryChallanNewRoute.useSearch();
  const navigate = useNavigate();
  const { data: po, isLoading: poLoading, isError: poError } = usePurchaseOrder(poId);
  const create = useCreateDeliveryChallan();

  const [code, setCode] = useState('');
  const [codeValid, setCodeValid] = useState(false);
  const [dcDate, setDcDate] = useState(new Date().toISOString().slice(0, 10));
  const [transport, setTransport] = useState('');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!po) return;
    setLineDrafts(
      po.lines.map((l) => ({
        purchaseOrderLineId: l.id,
        itemId: l.itemId ?? '',
        itemCodeText: l.itemCodeText ?? l.itemCode ?? '',
        itemNameText: l.itemName ?? null,
        uom: 'NOS',
        poLineQty: Number(l.qty ?? 0),
        shipQty: '',
        materialText: '',
        dcRemarks: '',
      })),
    );
  }, [po]);

  const canSubmit = useMemo(
    () =>
      Boolean(po) &&
      codeValid &&
      lineDrafts.some((l) => Number(l.shipQty) > 0) &&
      lineDrafts.every((l) => {
        const q = Number(l.shipQty);
        if (l.shipQty === '') return true;
        return !Number.isNaN(q) && q > 0 && q <= l.poLineQty;
      }),
    // codeValid flips asynchronously (the doc-number duplicate check); it MUST be
    // a dependency or the Save button's enabled state lags the real validity.
    [po, codeValid, lineDrafts],
  );

  if (!poId) {
    return (
      <div>
        <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> Back to Delivery Challans
        </Link>
        <div className="panel">
          <div className="panel-hdr">
            <div>
              <div className="panel-title">Pick a JW PO first</div>
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                The new-DC form needs a purchase order to source line items from. Go to the PO list
                and click "New DC" on a JW PO.
              </div>
            </div>
          </div>
          <div className="panel-body">
            <Link to="/purchase-orders" className="btn btn-primary">
              <ArrowLeft size={14} /> Go to purchase orders
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (poLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }

  if (poError || !po) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
          Could not load PO.
        </div>
      </div>
    );
  }

  const onSubmit = async (): Promise<void> => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const lines = lineDrafts
        .filter((l) => Number(l.shipQty) > 0)
        .map((l) => ({
          itemId: l.itemId || null,
          itemCodeText: l.itemCodeText.trim(),
          itemNameText: l.itemNameText,
          qty: Number(l.shipQty),
          uom: l.uom,
          purchaseOrderLineId: l.purchaseOrderLineId,
          materialText: l.materialText.trim() || null,
          dcRemarks: l.dcRemarks.trim() || null,
        }));
      // Guard the one field that silently fails server validation: a PO line with
      // no item code would send an empty itemCodeText (rejected as min length 1).
      // Catch it here with a clear message instead of an opaque validation error.
      if (lines.some((l) => l.itemCodeText === '')) {
        setSubmitError(
          'An item to send has no item code. Set the item code on the source PO line, then reopen this DC.',
        );
        setSubmitting(false);
        return;
      }
      const input: CreateDeliveryChallanInput = {
        header: {
          code: code.trim() || undefined,
          dcDate,
          purchaseOrderId: po.id,
          poCodeText: po.code,
          vendorId: po.vendorId ?? null,
          vendorCodeText: po.vendorCodeText ?? po.code,
          transport: transport.trim() || null,
        },
        lines,
      };
      const created = await create.mutateAsync(input);
      void navigate({ to: '/delivery-challans/$id', params: { id: created.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create DC.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📦 OSP Delivery Challan &amp; Outward
      </div>

      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)', marginBottom: 12 }}>
          ➕ Create OSP Delivery Challan
        </div>

        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            margin: '14px 0',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
            }}
          >
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>PO NO.</span>
              <br />
              <b className="mono" style={{ color: 'var(--cyan)' }}>
                {po.code}
              </b>
            </div>
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>VENDOR</span>
              <br />
              <b>{po.vendorName ?? po.vendorCodeText ?? '—'}</b>
            </div>
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>PROCESS</span>
              <br />
              <b style={{ color: 'var(--purple)' }}>{po.remarks || ''}</b>
            </div>
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>LINES</span>
              <br />
              <b>{po.lines.length}</b>
            </div>
          </div>
        </div>

        <div className="form-grid">
          <DocNumberInput
            type="delivery_challan"
            value={code}
            onChange={setCode}
            required
            id="dc-code"
            onValidityChange={setCodeValid}
          />
          <div className="form-grp">
            <label className="form-label" htmlFor="dc-date">
              DC Date
            </label>
            <input
              id="dc-date"
              type="date"
              className="innovic-input"
              value={dcDate}
              onChange={(e) => setDcDate(e.target.value)}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="dc-transport">
              Transporter
            </label>
            <input
              id="dc-transport"
              className="innovic-input"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Transport name"
            />
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '14px 0 6px' }}>
          Items to Send
        </div>
        <div className="tbl-wrap" style={{ marginBottom: 14 }}>
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Code</th>
                <th>Name</th>
                <th style={{ textAlign: 'right' }}>PO Qty</th>
                <th style={{ textAlign: 'right', color: 'var(--green)' }}>Send Now ★</th>
                <th>Material</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {lineDrafts.map((l, idx) => (
                <tr key={l.purchaseOrderLineId}>
                  <td className="mono">{idx + 1}</td>
                  <td className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                    {l.itemCodeText}
                  </td>
                  <td>{l.itemNameText}</td>
                  <td className="td-right mono">{l.poLineQty}</td>
                  <td className="td-right">
                      <input
                        type="number"
                        step="1"
                        min={0}
                        max={l.poLineQty}
                        className="innovic-input"
                      value={l.shipQty}
                      onChange={(e) =>
                        setLineDrafts((prev) => {
                          const next = prev.slice();
                          next[idx] = { ...next[idx]!, shipQty: e.target.value };
                          return next;
                        })
                      }
                      style={{
                        width: 80,
                        textAlign: 'right',
                        fontWeight: 700,
                        color: 'var(--green)',
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      value={l.materialText}
                      onChange={(e) =>
                        setLineDrafts((prev) => {
                          const next = prev.slice();
                          next[idx] = { ...next[idx]!, materialText: e.target.value };
                          return next;
                        })
                      }
                      placeholder="optional"
                      style={{ width: 130 }}
                    />
                  </td>
                  <td>
                    <textarea
                      rows={1}
                      className="innovic-textarea"
                      value={l.dcRemarks}
                      onChange={(e) =>
                        setLineDrafts((prev) => {
                          const next = prev.slice();
                          next[idx] = { ...next[idx]!, dcRemarks: e.target.value };
                          return next;
                        })
                      }
                      placeholder="optional"
                      style={{ width: 200 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-success"
            style={{ fontSize: 14, padding: '10px 24px' }}
            onClick={() => void onSubmit()}
            disabled={!canSubmit || submitting}
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {submitting ? 'Creating…' : '✔ Save DC'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void navigate({ to: '/delivery-challans' })}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
