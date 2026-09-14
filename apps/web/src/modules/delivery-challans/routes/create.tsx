// New DC route (T-059a). Two sources for the SAME OSP/return challan:
//   • Against PO (?poId=) — the original flow: pick a JW/Service PO → load its
//     lines → enter ship qty per line → submit via createDeliveryChallan.
//   • Against NC (?ncId=) — the return-to-vendor challan, added as a SECOND way
//     to reach what the NC detail page already does. It MUST call the NC challan
//     endpoint (useCreateNcDc → POST /nc-register/:id/create-dc), never
//     createDeliveryChallan: only createNcDc sets the NC linkage (ncId,
//     jobCardId, rtvSentQty, nc.deliveryChallanId, status→sent_to_vendor) and
//     holds the one-challan-per-NC double-consumption lock. A DC made the PO way
//     for an NC would silently break receiving/QC/auto-close. Reuse, not
//     duplicate (QC-NC-HANDLING-DESIGN.md §5).
//
// Which source is live is decided purely by which search param is set, so the
// PO path is byte-for-byte the same as before when nobody switches.

import type { CreateDeliveryChallanInput, DcSendableLine, Uom } from '@innovic/shared';
import { poSendsMaterialOut } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Truck } from 'lucide-react';
import { type CSSProperties, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { useDebounce } from '@/lib/use-debounce';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { useCreateNcDc, useNcRegister } from '@/modules/nc-register/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateDeliveryChallan, useDcSendable, useEligibleRtvNcs } from '../api';
import { itemCodeWithRev } from '@/lib/item-code';

// Both optional so the schema stays backward-compatible: an existing ?poId= link
// keeps working untouched, and ?ncId= selects the return-to-vendor source.
const newSearchSchema = z.object({
  poId: z.string().uuid().optional(),
  ncId: z.string().uuid().optional(),
});

export const deliveryChallanNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/new',
  validateSearch: newSearchSchema,
  component: DeliveryChallanNewPage,
});

// Thin dispatcher: pick the mode from the URL and hand off to a self-contained
// component. Keeping the two forms (and the picker) in separate components is
// what lets each own its hooks unconditionally — the PO form never fires the NC
// hooks and vice-versa. `key={ncId}` remounts the NC form when the selected NC
// changes (e.g. browser Back/Forward), so no dependent field can show stale data.
function DeliveryChallanNewPage(): React.JSX.Element {
  const { poId, ncId } = deliveryChallanNewRoute.useSearch();
  // poId wins if both are somehow present, so the PO path is never disturbed.
  if (poId) return <PoDcForm poId={poId} />;
  if (ncId) return <NcDcForm key={ncId} ncId={ncId} />;
  return <SourcePickerStep />;
}

// ═══ Against PO — the original form, unchanged in behaviour ═══════════════════

interface LineDraft {
  purchaseOrderLineId: string;
  itemId: string;
  itemCodeText: string;
  /** The customer's drawing revision carried down from the PO line's own SO
   *  link. DISPLAY ONLY — it is deliberately kept out of `itemCodeText`, which
   *  is submitted and must stay the bare code. Null on a PO line bought without
   *  an SO behind it (raw material, bought-in hardware), which is common here. */
  itemRevision: string | null;
  itemNameText: string | null;
  uom: Uom;
  poLineQty: number;
  shipQty: string;
  materialText: string;
  dcRemarks: string;
}

/** The most this line may go out on, all rules considered. The PO quantity is
 *  a ceiling the server also enforces; the sendable preview is usually lower. */
function maxSendNow(cap: DcSendableLine | undefined, poLineQty: number): number {
  return cap ? Math.min(cap.maxSendNow, poLineQty) : poLineQty;
}

/** The friendly warning for one line, or null when the typed qty is fine.
 *
 *  This used to be a server error the user met only AFTER pressing Save — a red
 *  banner quoting upstream/in-house/sent arithmetic against a number they had
 *  long since forgotten typing. Said here, while they type, it is an answer
 *  instead of a rejection: what the box will take, and what would free up more.
 *  The explanation half comes from the API so the form and the challan can never
 *  word the same limit differently. */
function sendNowIssue(
  typed: string,
  cap: DcSendableLine | undefined,
  poLineQty: number,
): string | null {
  if (typed.trim() === '') return null;
  const qty = Number(typed);
  if (Number.isNaN(qty)) return 'Enter a number of pieces.';
  if (qty < 0) return 'Enter 1 or more pieces.';
  const max = maxSendNow(cap, poLineQty);
  if (qty <= max) return null;
  const pcs = max === 1 ? 'pc' : 'pcs';
  const head =
    max > 0
      ? `Only ${max} ${pcs} can go out right now — you have typed ${qty}.`
      : cap?.limitKind === 'fully_sent'
        ? 'This purchase order line has already been fully sent.'
        : 'Nothing can go out on this line yet.';
  return cap?.limitReason
    ? `${head} ${cap.limitReason}`
    : `${head} This purchase order line is for ${poLineQty} pcs.`;
}

function PoDcForm({ poId }: { poId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: po, isLoading: poLoading, isError: poError } = usePurchaseOrder(poId);
  const create = useCreateDeliveryChallan();
  // Asked as soon as the PO is known, so the allowance is on screen before the
  // first keystroke rather than after the first failed save.
  const { data: sendable } = useDcSendable(poId);
  // Raising a DC is `entry` on ospdc_create (Purchase). Checked here too, not
  // just on the list button — the route is reachable by URL, and without this
  // an L1 Viewer got the whole form and failed only at the API.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  // ONE exit guard for the form. Where Cancel goes is where ESC -> Exit goes;
  // every other way off the screen (Back link, breadcrumb, browser Back) gets
  // "Are you sure?".
  const goBack = useCallback(() => void navigate({ to: '/delivery-challans' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const [code, setCode] = useState('');
  const [codeValid, setCodeValid] = useState(false);
  const [dcDate, setDcDate] = useState(todayLocal());
  const [transport, setTransport] = useState('');
  // Vehicle number is kept apart from the transporter NAME (`transport`) — the
  // OSP DC print and the gate register need the two separately.
  const [vehicleNo, setVehicleNo] = useState('');
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
        itemRevision: l.itemRevision,
        itemNameText: l.itemName ?? null,
        uom: 'NOS',
        poLineQty: Number(l.qty ?? 0),
        shipQty: '',
        materialText: '',
        dcRemarks: '',
      })),
    );
  }, [po]);

  const capByLine = useMemo(() => {
    const m = new Map<string, DcSendableLine>();
    for (const l of sendable?.lines ?? []) m.set(l.purchaseOrderLineId, l);
    return m;
  }, [sendable]);

  const canSubmit = useMemo(
    () =>
      Boolean(po) &&
      // T13: a blank DC date sends dcDate:'' which fails the server's YYYY-MM-DD
      // regex → opaque "Request validation failed". Require it up front.
      Boolean(dcDate) &&
      codeValid &&
      lineDrafts.some((l) => Number(l.shipQty) > 0) &&
      // Every line must be both a sensible number AND within what may actually
      // be sent — the same check that writes the message under the row, so the
      // button can never be enabled while a warning is showing.
      lineDrafts.every((l) => {
        if (l.shipQty === '') return true;
        const q = Number(l.shipQty);
        if (Number.isNaN(q) || q <= 0) return false;
        return sendNowIssue(l.shipQty, capByLine.get(l.purchaseOrderLineId), l.poLineQty) === null;
      }),
    // codeValid flips asynchronously (the doc-number duplicate check); it MUST be
    // a dependency or the Save button's enabled state lags the real validity.
    [po, dcDate, codeValid, lineDrafts, capByLine],
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
          vehicleNo: vehicleNo.trim() || null,
        },
        lines,
      };
      const created = await create.mutateAsync(input);
      exit.leave(() => void navigate({ to: '/delivery-challans/$id', params: { id: created.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create DC.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {exit.dialog}
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
              {/* Reads "PO No / NC No" because this same summary slot carries the
                  NC number on the Against-NC form. */}
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>PO No / NC No</span>
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
          <div className="form-grp">
            <label className="form-label" htmlFor="dc-vehicle-no">
              Vehicle No
            </label>
            <input
              id="dc-vehicle-no"
              className="innovic-input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ-01-AB-1234"
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
              {lineDrafts.map((l, idx) => {
                const cap = capByLine.get(l.purchaseOrderLineId);
                const max = maxSendNow(cap, l.poLineQty);
                const issue = sendNowIssue(l.shipQty, cap, l.poLineQty);
                // Nothing at all may go out on this line — worth saying out
                // loud, since there is no quantity the user could type that
                // would produce the explanation.
                const blocked = max === 0 && Boolean(cap?.limitReason);
                // A finished line is not a problem to be flagged — it is the
                // job done. Amber here would train the user to ignore amber.
                const done = cap?.limitKind === 'fully_sent';
                return (
                  <Fragment key={l.purchaseOrderLineId}>
                    <tr>
                      <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                        {idx + 1}
                      </td>
                      {/* CODE/REV while raising the challan, so this screen agrees
                          with the saved challan and its printout instead of showing
                          a bare code that gains a revision the moment it is saved. */}
                      <td className="mono" style={{ color: 'var(--purple)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {itemCodeWithRev(l.itemCodeText, l.itemRevision)}
                      </td>
                      <td>{l.itemNameText}</td>
                      <td className="mono">{l.poLineQty}</td>
                      <td>
                        <input
                          type="number"
                          step="1"
                          min={0}
                          max={max}
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
                            width: '100%',
                            fontWeight: 700,
                            color: issue ? 'var(--red)' : 'var(--green)',
                            borderColor: issue ? 'var(--red)' : undefined,
                          }}
                        />
                        {/* The allowance, stated before anything is typed. Amber
                        whenever the shop floor allows less than the PO line, so
                        the tighter number is the one that catches the eye. */}
                        {cap ? (
                          <div
                            style={{
                              fontSize: 10,
                              marginTop: 3,
                              color: done
                                ? 'var(--green)'
                                : max < l.poLineQty
                                  ? 'var(--amber)'
                                  : 'var(--text3)',
                            }}
                          >
                            {done ? (
                              <b>&#10003; Fully sent</b>
                            ) : (
                              <>
                                Can send now: <b className="mono">{max}</b>
                              </>
                            )}
                          </div>
                        ) : null}
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
                    {/* Full width, under the row it belongs to: the explanation runs
                    to a sentence or two and would be unreadable squeezed into
                    the 12%-wide quantity cell.

                    Two ways it appears. Red, when a number bigger than the
                    allowance has been typed. Amber and unprompted, when the
                    line can send NOTHING — there is no quantity that would
                    reveal the reason, so waiting to be asked would leave the
                    user staring at a zero with no explanation. */}
                    {issue || blocked ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 8px 8px' }}>
                          <div
                            style={{
                              color: issue ? 'var(--red)' : done ? 'var(--text2)' : 'var(--amber)',
                              background: issue
                                ? 'var(--red3)'
                                : done
                                  ? 'var(--bg3)'
                                  : 'var(--amber3)',
                              border: `1px solid ${
                                issue ? 'var(--red)' : done ? 'var(--border)' : 'var(--amber)'
                              }`,
                              borderRadius: 6,
                              padding: '6px 10px',
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            {issue ??
                              (done
                                ? cap?.limitReason
                                : `Nothing can go out on this line yet. ${cap?.limitReason}`)}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
            onClick={() => exit.leave(goBack)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══ Against NC — the return-to-vendor challan (design §5) ════════════════════
// A SECOND entry point to the exact flow the NC detail page runs. It calls
// useCreateNcDc (NOT createDeliveryChallan) so the NC linkage and the
// one-challan-per-NC lock are set. The qty is never asked: the challan line is
// the NC's full rejected qty by rule (interlock 4), shown read-only below.

function NcDcForm({ ncId }: { ncId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: eff } = useMyAccess();
  // Same gate the NC detail page enforces for this challan (design §5):
  // nc_dispose EDIT *and* ospdc_create ENTRY. Checked here too — the route is
  // reachable by URL, and the two-right rule must not be looser via this door.
  const canCreateDc =
    effectiveFormPerms(eff, 'nc_dispose').edit && effectiveFormPerms(eff, 'ospdc_create').entry;

  // Reuse the NC detail hook rather than refetch by hand — same cache, same
  // shape. rejectedQty / item fields come straight off it and refresh with ncId.
  const { data: nc, isLoading, isError } = useNcRegister(ncId);
  const createDc = useCreateNcDc(ncId);

  const goBack = useCallback(() => void navigate({ to: '/delivery-challans' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Only what createNcDcInputSchema takes: dcDate, vendor, transport, vehicleNo,
  // remarks. No lines, no qty — the server derives the line from the NC.
  const [dcDate, setDcDate] = useState(todayLocal());
  const [vendorId, setVendorId] = useState<string | null>(null);
  // The picker's label is "CODE — Name"; the challan stores the code text next to
  // the id (the DC's ADR-015 pair), so the code is peeled off here.
  const [vendorCodeText, setVendorCodeText] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!canCreateDc) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ You do not have access to create a return-to-vendor challan (needs NC dispose edit
          and OSP DC entry).
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC…
      </div>
    );
  }

  if (isError || !nc) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
          Could not load NC.
        </div>
      </div>
    );
  }

  // Guard against reaching this form for an NC that is not (or no longer)
  // eligible — the server enforces the same predicate, but saying it here avoids
  // a confusing rejection after the vendor has been picked.
  const alreadyHasChallan = Boolean(nc.deliveryChallanId);
  const isEligible =
    nc.disposition === 'return_to_vendor' && nc.status === 'disposed' && !alreadyHasChallan;

  // A plain const (not a hook) so it can read the guaranteed-loaded `nc`.
  const canSubmit = isEligible && dcDate !== '' && vendorId != null && vendorCodeText !== '';

  const onSubmit = async (): Promise<void> => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      // MUST be createNcDc (the NC endpoint), NEVER createDeliveryChallan: only
      // this sets ncId/jobCardId/rtvSentQty + nc.deliveryChallanId, flips the NC
      // to sent_to_vendor, and holds the one-challan-per-NC lock. It also
      // invalidates ncRegisterKeys.lists() on success (useInvalidateNcCascade),
      // which is the same key useEligibleRtvNcs uses — so this NC drops out of
      // the picker automatically.
      const created = await createDc.mutateAsync({
        dcDate,
        vendorId,
        vendorCodeText,
        transport: transport.trim() || null,
        vehicleNo: vehicleNo.trim() || null,
        remarks: remarks.trim() || null,
      });
      exit.leave(() =>
        void navigate({
          to: '/delivery-challans/$id',
          params: { id: created.deliveryChallanId },
        }),
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create DC.');
    } finally {
      setSubmitting(false);
    }
  };

  const itemCode = itemCodeWithRev(nc.itemCode ?? nc.itemCodeText, nc.itemRevision);
  const itemName = nc.itemName ?? nc.itemNameText ?? '—';

  return (
    <div>
      {exit.dialog}
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📦 OSP Delivery Challan &amp; Outward
      </div>

      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 12 }}>
          <Truck size={14} style={{ verticalAlign: -2 }} /> Create Return-to-Vendor Challan
        </div>

        {/* Read-only NC summary. Qty to return is nc.rejectedQty by rule — the
            full rejected quantity, never editable on this screen. */}
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
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>PO No / NC No</span>
              <br />
              <b className="mono" style={{ color: 'var(--blue)' }}>
                {nc.code}
              </b>
            </div>
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>ITEM</span>
              <br />
              <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                {itemCode}
              </b>
              <div className="text2" style={{ fontSize: 11 }}>
                {itemName}
              </div>
            </div>
            <div>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>QTY TO RETURN</span>
              <br />
              <b className="mono" style={{ color: 'var(--red)' }}>
                {Number(nc.rejectedQty)} pcs
              </b>
            </div>
          </div>
        </div>

        {!isEligible ? (
          <div
            style={{
              color: 'var(--amber)',
              background: 'var(--amber3)',
              border: '1px solid var(--amber)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {alreadyHasChallan
              ? 'A return challan has already been issued for this NC.'
              : 'This NC is not ready for a return-to-vendor challan (it must be disposed as “Return to Vendor” first).'}
          </div>
        ) : null}

        <div className="form-grid-3">
          <div className="form-grp">
            <label className="form-label" htmlFor="ncdc-date">
              DC Date<span className="req">★</span>
            </label>
            <input
              id="ncdc-date"
              type="date"
              className="innovic-input"
              value={dcDate}
              onChange={(e) => setDcDate(e.target.value)}
              required
            />
          </div>
          <VendorPicker
            id="ncdc-vendor"
            value={vendorId}
            onChange={(id, label) => {
              setVendorId(id);
              setVendorCodeText(id ? (label.split(' — ')[0] ?? label) : '');
            }}
          />
          <div className="form-grp">
            <label className="form-label" htmlFor="ncdc-transport">
              Transporter
            </label>
            <input
              id="ncdc-transport"
              className="innovic-input"
              maxLength={200}
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Transport name"
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="ncdc-vehicle-no">
              Vehicle No
            </label>
            <input
              id="ncdc-vehicle-no"
              className="innovic-input"
              maxLength={50}
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ-01-AB-1234"
            />
          </div>
          <div className="form-grp" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" htmlFor="ncdc-remarks">
              Remarks
            </label>
            <textarea
              id="ncdc-remarks"
              className="innovic-textarea"
              rows={2}
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="optional"
            />
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
              margin: '10px 0',
            }}
          >
            {submitError}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
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
          <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: choose the source, then the document ──────────────────────────
// Lives in its own component so its list queries only run while no document is
// chosen — the forms above must not fire a picker fetch they never use. The
// source toggle mounts/unmounts the two picker bodies, so switching source
// drops the other side's search state (nothing stale crosses over).

function sourceBtnStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '12px',
    border: active ? '2px solid var(--blue)' : '2px solid var(--border)',
    background: active ? 'var(--blue3)' : 'var(--bg)',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

function SourcePickerStep(): React.JSX.Element {
  const navigate = useNavigate();
  // Picking a document navigates to this same route with ?poId= / ?ncId=, which
  // is a step forward, not an exit — so the Select links get `exit.allow`.
  const goBack = useCallback(() => void navigate({ to: '/delivery-challans' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });
  const [source, setSource] = useState<'po' | 'nc'>('po');

  return (
    <>
      {exit.dialog}
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📦 OSP Delivery Challan &amp; Outward
      </div>

      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>
          ➕ Create OSP Delivery Challan — Step 1: choose the source
        </div>
        <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
          Ship against a purchase order that sends material out (Job Work / Service), or return
          rejected material to a vendor against a disposed NC. Pick a source, then the document.
        </div>

        {/* Source switch — 2-button selector, mirrors the GRN unified form.
            Default is "Against PO", so the original flow is unchanged. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['po', 'nc'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              onClick={() => setSource(s)}
              style={sourceBtnStyle(source === s)}
            >
              {s === 'po' ? '📦 Against PO' : '🏭 Against NC'}
            </button>
          ))}
        </div>

        {source === 'po' ? (
          <PoPickerBody onSelectAllow={exit.allow} />
        ) : (
          <NcPickerBody onSelectAllow={exit.allow} />
        )}
      </div>
    </>
  );
}

// Only POs that actually send material out are offered (job work + service, per
// poSendsMaterialOut). A draft PO is excluded because material cannot leave
// against an unissued order, and cancelled ones are dead.
function PoPickerBody({ onSelectAllow }: { onSelectAllow: () => void }): React.JSX.Element {
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
    <>
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
                <th>PO No / NC No</th>
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
                      onClick={onSelectAllow}
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
    </>
  );
}

// Only NCs ready for a return-to-vendor challan are offered — disposition
// return_to_vendor, status disposed, no challan yet (useEligibleRtvNcs, the
// pendingRtvChallan predicate). The whole eligible set loads in one fetch and
// scrolls; search filters it client-side across every visible column (NC no,
// item code, item name) per the universal-search standard.
function NcPickerBody({ onSelectAllow }: { onSelectAllow: () => void }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim().toLowerCase(), 300);
  const { data, isLoading, isError } = useEligibleRtvNcs();

  const eligible = useMemo(() => {
    const items = data?.items ?? [];
    if (!debounced) return items;
    return items.filter((n) =>
      [n.code, n.itemCode, n.itemCodeText, n.itemName, n.itemNameText].some((f) =>
        (f ?? '').toLowerCase().includes(debounced),
      ),
    );
  }, [data, debounced]);

  return (
    <>
      <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
        Return rejected material to a vendor. Only NCs disposed as “Return to Vendor” with no
        challan yet are shown. The challan returns the NC’s full rejected quantity.
      </div>

      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label className="form-label" htmlFor="dc-nc-search">
          Search NC
        </label>
        <input
          id="dc-nc-search"
          className="innovic-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="NC no. / item code / item name"
        />
      </div>

      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NCs…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          Could not load NCs.
        </div>
      ) : eligible.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--amber)' }}>
          No NC is awaiting a return-to-vendor challan
          {debounced ? ' for this search' : ''}. Dispose an NC as “Return to Vendor” first.
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>NC No</th>
                <th>Item</th>
                <th>Qty to return</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {eligible.map((n) => (
                <tr key={n.id}>
                  <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {n.code}
                  </td>
                  <td>
                    <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {itemCodeWithRev(n.itemCode ?? n.itemCodeText, n.itemRevision)}
                    </b>
                    <div className="text2" style={{ fontSize: 11 }}>
                      {n.itemName ?? n.itemNameText ?? '—'}
                    </div>
                  </td>
                  <td className="mono" style={{ color: 'var(--red)' }}>
                    {Number(n.rejectedQty)}
                  </td>
                  <td>
                    <Link
                      to="/delivery-challans/new"
                      search={{ ncId: n.id }}
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: 11 }}
                      onClick={onSelectAllow}
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
    </>
  );
}
