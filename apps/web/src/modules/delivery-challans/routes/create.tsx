// New DC route (T-059a). Pick a JW PO → load its lines → enter ship qty per
// line → submit. On success → redirect to detail. Mirrors PO from-pr pattern.

import type { CreateDeliveryChallanInput, Uom } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
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
      code.trim().length > 0 &&
      lineDrafts.some((l) => Number(l.shipQty) > 0) &&
      lineDrafts.every((l) => {
        const q = Number(l.shipQty);
        if (l.shipQty === '') return true;
        return !Number.isNaN(q) && q > 0 && q <= l.poLineQty;
      }),
    [po, code, lineDrafts],
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
          itemId: l.itemId,
          itemCodeText: l.itemCodeText,
          itemNameText: l.itemNameText,
          qty: Number(l.shipQty),
          uom: l.uom,
          purchaseOrderLineId: l.purchaseOrderLineId,
          materialText: l.materialText.trim() || null,
          dcRemarks: l.dcRemarks.trim() || null,
        }));
      const input: CreateDeliveryChallanInput = {
        header: {
          code: code.trim(),
          dcDate,
          purchaseOrderId: po.id,
          poCodeText: po.code,
          vendorId: po.vendorId!,
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
      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">New delivery challan</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Issuing material against PO <span className="mono">{po.code}</span> — vendor{' '}
              <b style={{ color: 'var(--text)' }}>{po.vendorName ?? po.vendorCodeText ?? '—'}</b>.
              Submit will flip linked outsource ops to <span className="mono">sent</span> and write a
              stock OUT ledger row per item.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid form-grid-3">
            <div className="form-grp">
              <label className="form-label" htmlFor="dc-code">
                DC code<span className="req">★</span>
              </label>
              <input
                id="dc-code"
                className="innovic-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="DC-NNNNN"
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="dc-date">
                DC date
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
                Transport / vehicle
              </label>
              <input
                id="dc-transport"
                className="innovic-input"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder="optional"
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
              Enter ship qty per PO line. Lines with qty 0 are skipped.
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
                  <th className="td-right">PO qty</th>
                  <th className="td-right">Ship qty</th>
                  <th>Material</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {lineDrafts.map((l, idx) => (
                  <tr key={l.purchaseOrderLineId}>
                    <td className="td-ctr mono">{idx + 1}</td>
                    <td>
                      <span className="mono">{l.itemCodeText}</span>
                      {l.itemNameText ? (
                        <div className="text3" style={{ fontSize: 11 }}>
                          {l.itemNameText}
                        </div>
                      ) : null}
                    </td>
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
                        style={{ width: 90, textAlign: 'right' }}
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
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void navigate({ to: '/delivery-challans' })}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onSubmit()}
          disabled={!canSubmit || submitting}
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
          {submitting ? 'Creating…' : 'Create DC'}
        </button>
      </div>
    </div>
  );
}
