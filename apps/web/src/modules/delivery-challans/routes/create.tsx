// New DC route (T-059a). Pick a JW PO → load its lines → enter ship qty per
// line → submit. On success → redirect to detail. Mirrors PO from-pr pattern.

import type { CreateDeliveryChallanInput, Uom } from '@innovic/shared';
import { poSendsMaterialOut } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useDebounce } from '@/lib/use-debounce';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
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
  // Raising a DC is `entry` on ospdc_create (Purchase). Checked here too, not
  // just on the list button — the route is reachable by URL, and without this
  // an L1 Viewer got the whole form and failed only at the API.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');

  const [code, setCode] = useState('');
  const [codeValid, setCodeValid] = useState(false);
  const [dcDate, setDcDate] = useState(todayLocal());
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
        // T13: fall back to the item name so a PO line missing a code doesn't
        // send an empty itemCodeText (the schema requires min length 1).
        itemCodeText: l.itemCodeText ?? l.itemCode ?? l.itemName ?? '',
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
      // T13: a blank DC date sends dcDate:'' which fails the server's YYYY-MM-DD
      // regex → opaque "Request validation failed". Require it up front.
      Boolean(dcDate) &&
      codeValid &&
      lineDrafts.some((l) => Number(l.shipQty) > 0) &&
      lineDrafts.every((l) => {
        const q = Number(l.shipQty);
        if (l.shipQty === '') return true;
        return !Number.isNaN(q) && q > 0 && q <= l.poLineQty;
      }),
    // codeValid flips asynchronously (the doc-number duplicate check); it MUST be
    // a dependency or the Save button's enabled state lags the real validity.
    [po, dcDate, codeValid, lineDrafts],
  );

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ You do not have entry access to create an OSP delivery challan.
        </div>
      </div>
    );
  }

  // Step 1 of the same form: the DC needs a PO to source lines from, so when
  // none was passed the form asks for it here instead of bouncing the user to
  // the PO list. Picking a PO sets ?poId= and the form continues below.
  if (!poId) return <PoPickerStep />;

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
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 12 }}>
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
              <b className="mono" style={{ color: 'var(--blue)' }}>
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

        <div className="form-grid-3">
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
              DC Date<span className="req">★</span>
            </label>
            <input
              id="dc-date"
              type="date"
              className="innovic-input"
              value={dcDate}
              onChange={(e) => setDcDate(e.target.value)}
              required
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

        <div
          style={{
            fontSize: 11,
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            margin: '14px 0 6px',
          }}
        >
          Items to Send
        </div>
        <div className="tbl-wrap" style={{ marginBottom: 14 }}>
          <table className="innovic-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '15%' }}>Item Code</th>
                <th style={{ width: '22%' }}>Name</th>
                <th style={{ width: '8%' }}>PO Qty</th>
                <th style={{ width: '12%', color: 'var(--green)' }}>Send Now ★</th>
                <th style={{ width: '17%' }}>Material</th>
                <th style={{ width: '21%' }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {lineDrafts.map((l, idx) => (
                <tr key={l.purchaseOrderLineId}>
                  <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {idx + 1}
                  </td>
                  <td className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                    {l.itemCodeText}
                  </td>
                  <td>{l.itemNameText}</td>
                  <td className="mono">{l.poLineQty}</td>
                  <td>
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
                      style={{ width: '100%', fontWeight: 700, color: 'var(--green)' }}
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
                      style={{ width: '100%' }}
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
                      style={{ width: '100%' }}
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

// ─── Step 1: pick the PO this DC ships against ─────────────────────────────
// Lives in its own component so its list query only runs when there is no
// poId — the main form must not fire a PO-list fetch it never uses.
//
// Only POs that actually send material out are offered (job work + service,
// per poSendsMaterialOut). A draft PO is excluded because material cannot
// leave against an unissued order, and cancelled ones are dead.
function PoPickerStep(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const { data, isLoading, isError } = usePurchaseOrdersList({
    search: debounced || undefined,
    limit: 200,
    offset: 0,
  });

  const eligible = useMemo(
    () =>
      (data?.items ?? []).filter(
        (p) => poSendsMaterialOut(p.poType) && p.status !== 'draft' && p.status !== 'cancelled',
      ),
    [data],
  );

  return (
    <div>
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📦 OSP Delivery Challan &amp; Outward
      </div>

      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>
          ➕ Create OSP Delivery Challan — Step 1: choose the PO
        </div>
        <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
          The challan ships against a purchase order that sends material out (Job Work / Service).
          Pick one and its lines load into the challan.
        </div>

        <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
          <label className="form-label" htmlFor="dc-po-search">
            Search PO
          </label>
          <input
            id="dc-po-search"
            className="innovic-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO no. / vendor / PR no."
          />
        </div>

        {isLoading ? (
          <div className="empty-state">
            <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase orders…
          </div>
        ) : isError ? (
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            Could not load purchase orders.
          </div>
        ) : eligible.length === 0 ? (
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            No Job Work / Service PO is open for dispatch
            {debounced ? ' for this search' : ''}. Raise or issue one first.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>PO No.</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {eligible.map((p) => (
                  <tr key={p.id}>
                    <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                      {p.code}
                    </td>
                    <td className="mono">{p.poDate}</td>
                    <td>{p.vendorName ?? p.vendorCodeText ?? '—'}</td>
                    <td style={{ color: 'var(--purple)' }}>
                      {p.poType === 'service' ? 'Service' : 'Job Work'}
                    </td>
                    <td className="mono">{p.status}</td>
                    <td className="mono">{p.lineCount}</td>
                    <td>
                      <Link
                        to="/delivery-challans/new"
                        search={{ poId: p.id }}
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: 11 }}
                      >
                        Select
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
