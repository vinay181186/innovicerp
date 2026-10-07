// New DC route (T-059a) — ONE screen for BOTH sources of the same OSP/return
// challan, mirroring the unified GRN create shell (goods-receipt-notes/
// components/unified-grn-form.tsx). It used to be TWO screens: a landing
// "choose the source" step that then NAVIGATED (?poId= / ?ncId=) to a separate
// form. That felt like two screens because it was. Now a single panel holds a
// "▸ DC AGAINST" 2-button selector (state, not navigation) and, INLINE below it,
// the active source's picker AND — once a document is chosen — its form. No
// source-chooser screen, no ?param navigation to switch source.
//
//   • Against PO — pick a JW/Service PO, its lines load right below, enter ship
//     qty per line, submit via createDeliveryChallan. The item-code guard,
//     maxSendNow/sendNowIssue warnings and canSubmit are exactly as before; this
//     path is byte-for-byte the same behaviour, only rendered on one screen.
//   • Against NC — pick a disposed return-to-vendor NC, its read-only summary
//     (qty = nc.rejectedQty) and vendor/date/transport fields show below, submit
//     via useCreateNcDc → POST /nc-register/:id/create-dc. It MUST stay createNcDc
//     (NOT createDeliveryChallan): only createNcDc sets the NC linkage (ncId,
//     jobCardId, rtvSentQty, nc.deliveryChallanId, status→sent_to_vendor) and
//     holds the one-challan-per-NC double-consumption lock. A DC made the PO way
//     for an NC would silently break receiving/QC/auto-close (QC-NC-HANDLING-
//     DESIGN.md §5).
//
//   • Against JW PO / DC (ADR-211) — the store knows the JW PO No. or the DC No.
//     the pieces first went out on, not the NC No. Search by either, pick ONE
//     return-to-vendor NC behind it, and the SAME Against-NC form opens — so the
//     save is still useCreateNcDc (one writer, one-challan-per-NC lock). Against
//     PO also warns when the chosen PO has such pieces waiting, so a return is not
//     booked as an ordinary send by mistake.
//
// ADR-219 — returns stay their OWN document; this screen just stops hiding them.
// The Against-PO cap is unchanged (fresh pieces only, deviated pieces are never
// added to it). What changed is three things: the PO picker keeps an order listed
// while pieces wait to go back and shows the figure as "Return Challan Pending";
// the warning leads with the TOTAL still to go back (netted openQty, never the
// gross rejectedQty), says it is NOT part of what this screen offers, and its
// button hands the user to Against NC; and the Against-NC form reads the JW PO
// No. and the challan the pieces went out on off the deviation instead of asking.
// The compulsory tick is untouched — it is the only safeguard against shipping
// the rejected pile by mistake, since both piles sit in the same store.
//
// Switching source unmounts the other side, so its picks and drafts are dropped
// (no stale state crosses). The document picked within a source is held in that
// side's own state; the form body is keyed on the chosen id so its dependent
// fields remount clean when the choice changes.
//
// DEEP LINK: ?poId= (from the PO detail/list "Create DC" buttons and from a job
// card's OSP action) opens the Against-PO source with that PO already selected —
// like unified-grn-form's initialPurchaseOrderId. ?ncId= navigation is gone: no
// inbound link uses it and the source is now state, so the search schema carries
// poId only.

import type {
  CreateDeliveryChallanInput,
  DcSendableLine,
  RtvCandidateState,
  RtvPendingConflictDetails,
  Uom,
} from '@innovic/shared';
import {
  poSendsMaterialOut,
  qtyStepForUom,
  qtyUomProblem,
  RTV_CANDIDATE_STATE_LABELS,
  UOMS,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Truck } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { docCodeToSend } from '@/lib/use-doc-number';
import { useSaveKey } from '@/lib/use-save-key';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ApiError } from '@/lib/api';
import { fmtDate, todayIst } from '@/lib/date';
import { type ExitConfirm, ExitConfirmDialog, useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { useCreateNcDc, useNcRegister } from '@/modules/nc-register/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import {
  deliveryChallansKeys,
  useCreateDeliveryChallan,
  useDcSendable,
  useEligibleRtvNcs,
  useRtvCandidates,
} from '../api';
import { JwpoDcPickerBody } from '../components/jwpo-dc-rtv-picker';
import { rtvOpenQty } from '../lib/rtv-open-qty';

// poId only. An existing ?poId= link keeps working untouched and preselects the
// Against-PO source; ?ncId= is dropped because the source is now state, not URL,
// and nothing links here with it.
const newSearchSchema = z.object({
  poId: z.string().uuid().optional(),
});

export const deliveryChallanNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/new',
  validateSearch: newSearchSchema,
  component: DeliveryChallanNewPage,
});

// ─── The single screen ────────────────────────────────────────────────────────
// One panel, one exit guard for both sources. The "▸ DC AGAINST" selector is
// state; switching it unmounts the other side so nothing stale crosses over.

type DcSource = 'po' | 'nc' | 'jwpo_dc';

// Button text + icons mirror the GRN unified form's TYPE_META style.
/** PO status → the words the user reads; the stored codes are unchanged. */
const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  partial: 'Partly Received',
  qc_pending: 'QC Pending',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const SOURCE_META: Record<DcSource, { label: string }> = {
  po: { label: 'Against PO' },
  nc: { label: 'Against NC' },
  jwpo_dc: { label: 'Against JW PO / DC' },
};

/** One row of the Against PO warning — from GET rtv-candidates or from the
 *  409's details.ncs (ADR-211). */
interface RtvPanelRow {
  ncId: string;
  ncCode: string;
  itemCodeLabel: string;
  /** GROSS — what the deviation was raised for. Kept because the 409's details
   *  carry only this. Never the figure shown or totalled: see `openQty`. */
  rejectedQty: string;
  /** ADR-219 — what is STILL to go back on this deviation (rejected less
   *  anything recovered or written off). This is what the banner shows and
   *  totals; `rejectedQty` would overstate a partly recovered one. */
  openQty: string;
  state: RtvCandidateState;
  poLineId: string | null;
}

/** The 409 an Against PO save answers with when return-to-vendor pieces are
 *  waiting on one of its PO lines (ADR-211). */
function isRtvPendingConflict(e: unknown): e is ApiError & { details: RtvPendingConflictDetails } {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    typeof e.details === 'object' &&
    e.details !== null &&
    (e.details as { kind?: unknown }).kind === 'rtv_pending'
  );
}

function DeliveryChallanNewPage(): React.JSX.Element {
  const { poId: initialPoId } = deliveryChallanNewRoute.useSearch();
  const navigate = useNavigate();

  // ONE exit guard for the whole screen, both sources. Where Cancel goes is where
  // ESC → Exit goes; every other way off the screen (Back link, breadcrumb,
  // browser Back) gets "Are you sure?". Picking a document / switching source is
  // in-component state, never a navigation, so none of it trips the guard.
  const goBack = useCallback(() => void navigate({ to: '/delivery-challans' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Arriving with ?poId= means the PO source, preselected. Otherwise default to
  // Against PO so the original flow is unchanged.
  const [source, setSource] = useState<DcSource>('po');
  // The search the picker on the other side opens with. Set when the Against PO
  // warning's button brings the user over (ADR-219: to the NC No. when exactly
  // one deviation is waiting, so the row it sends them to is already on screen);
  // blank when the source is picked from the dropdown.
  const [pickerSearch, setPickerSearch] = useState('');
  // ADR-219 — the warning's button goes to Against NC, the route the owner uses
  // for a return. It used to go to Against JW PO / DC seeded with the PO No.;
  // that screen still exists and is still reachable from the dropdown.
  const switchToNc = useCallback((ncSearch: string) => {
    setPickerSearch(ncSearch);
    setSource('nc');
  }, []);

  // Save lives in the sticky header, but the save handler belongs to whichever
  // form body is mounted (none while a picker is showing). The body reports its
  // state here and keeps `submitRef` pointed at its own save.
  const [save, setSave] = useState<DcSaveState>(NO_SAVE);
  const submitRef = useRef<() => void>(() => {});
  const saveCtl = useMemo<DcSaveCtl>(() => ({ setState: setSave, submitRef }), []);
  const runSave = useCallback(() => submitRef.current(), []);
  useSaveShortcut(runSave, save.canSave && !save.saving);

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title="New OSP Delivery Challan"
        backLabel="Back to Delivery Challans"
        onBack={goBack}
        dirty={save.dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runSave}
              disabled={!save.canSave || save.saving}
            >
              {save.saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {save.saving ? 'Saving…' : 'Save DC'}
            </button>
          </>
        }
      />

      <div className="panel" style={{ padding: 16 }}>
        {/* ▸ DC AGAINST — a compact dropdown (Against PO / Against NC). State,
            not navigation; switching unmounts the other side below. */}
        <div className="form-grp" style={{ maxWidth: 220, marginBottom: 14 }}>
          <label className="form-label" htmlFor="dc-source">
            DC Against
          </label>
          <select
            id="dc-source"
            className="innovic-select"
            value={source}
            onChange={(e) => {
              setPickerSearch('');
              setSource(e.target.value as DcSource);
            }}
          >
            {(['po', 'nc', 'jwpo_dc'] as const).map((s) => (
              <option key={s} value={s}>
                {SOURCE_META[s].label}
              </option>
            ))}
          </select>
        </div>

        {/* Switching source unmounts the other side, dropping its picks/drafts. */}
        {source === 'po' ? (
          <PoDcSection
            {...(initialPoId ? { initialPoId } : {})}
            exit={exit}
            saveCtl={saveCtl}
            onSwitchToNc={switchToNc}
          />
        ) : source === 'nc' ? (
          <NcDcSection initialSearch={pickerSearch} exit={exit} saveCtl={saveCtl} />
        ) : (
          <JwpoDcRtvSection initialSearch={pickerSearch} exit={exit} saveCtl={saveCtl} />
        )}
      </div>
    </div>
  );
}

// ─── Header Save wiring ──────────────────────────────────────────────────────
interface DcSaveState {
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
}
const NO_SAVE: DcSaveState = { canSave: false, saving: false, dirty: false };
interface DcSaveCtl {
  setState: (s: DcSaveState) => void;
  submitRef: React.MutableRefObject<() => void>;
}

/** A form body reports its Save state to the page header while mounted, and
 *  clears it on unmount (back to a picker, or the other source). */
function useReportSave(ctl: DcSaveCtl, s: DcSaveState): void {
  const { canSave, saving, dirty } = s;
  const { setState } = ctl;
  useEffect(() => {
    setState({ canSave, saving, dirty });
  }, [setState, canSave, saving, dirty]);
  useEffect(() => () => setState(NO_SAVE), [setState]);
}

// ═══ Against PO ═══════════════════════════════════════════════════════════════
// Picker and form on ONE screen: the picker shows until a PO is chosen, then the
// form body renders in its place. Selection is state (setPoId), not navigation.
// The form body is keyed on poId so its line drafts remount clean when the PO
// changes. Keeping the form in its own child means its PO hooks (usePurchaseOrder,
// useDcSendable) only fire once a PO is actually chosen — never for the picker.

interface LineDraft {
  purchaseOrderLineId: string;
  itemId: string;
  itemCodeText: string;
  /** The customer's drawing revision carried down from the PO line's own SO
   *  link. DISPLAY ONLY — it is deliberately kept out of `itemCodeText`, which
   *  is submitted and must stay the bare code. Null on a PO line bought without
   *  an SO behind it (raw material, bought-in hardware), which is common here. */
  itemRevision: string | null;
  /** The CUSTOMER's PO line number off the SO line behind this PO line.
   *  Display only — the challan stores no copy of it. */
  clientPoLineNo: string | null;
  itemNameText: string | null;
  uom: Uom;
  poLineQty: number;
  shipQty: string;
  materialText: string;
  dcRemarks: string;
}

/** The most this line may go out on, all rules considered. The PO quantity is
 *  a ceiling the server also enforces; the sendable preview is usually lower. */
/** A PO line's item unit as a challan unit; NOS when unknown (as on the print). */
function toUom(u: string | null | undefined): Uom {
  return (UOMS as readonly string[]).includes(u ?? '') ? (u as Uom) : 'NOS';
}

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
  uom: string,
): string | null {
  if (typed.trim() === '') return null;
  const qty = Number(typed);
  if (Number.isNaN(qty)) return 'Enter a number of pieces.';
  if (qty < 0) return 'Enter 1 or more pieces.';
  // Decimals follow the unit (S9): KGS / MTR up to 3, NOS / SET whole only.
  // The server checks the same rule; saying it here saves a round trip.
  const uomProblem = qtyUomProblem(qty, uom, 'Send Now');
  if (uomProblem) return uomProblem;
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

function PoDcSection({
  initialPoId,
  exit,
  saveCtl,
  onSwitchToNc,
}: {
  initialPoId?: string;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
  /** ADR-219 — hand the user to Against NC, seeded with the NC No. when exactly
   *  one deviation is waiting (blank when several are). */
  onSwitchToNc: (ncSearch: string) => void;
}): React.JSX.Element {
  // The chosen PO. Preselected from ?poId= (the deep link), else null → picker.
  const [poId, setPoId] = useState<string | null>(initialPoId ?? null);

  if (poId === null) {
    return <PoPickerBody onSelect={setPoId} />;
  }
  // key={poId}: swapping the PO throws away the previous line drafts cleanly.
  return (
    <PoDcFormBody
      key={poId}
      poId={poId}
      onChangePo={() => setPoId(null)}
      exit={exit}
      saveCtl={saveCtl}
      onSwitchToNc={onSwitchToNc}
    />
  );
}

/** `Return Challan Pending` on one PO row, read defensively.
 *
 *  This client returns response bodies UNPARSED (lib/api.ts), so the shared
 *  schema's `.default(0)` never runs in the browser: an API that predates the
 *  field sends nothing at all and the value arrives as `undefined`. Anything
 *  that is not a usable positive number reads as 0, so the screen degrades to
 *  exactly the old behaviour instead of rendering NaN or dropping rows. */
function rtvPendingQty(p: { rtvAwaitingChallanQty?: number }): number {
  const n = Number(p.rtvAwaitingChallanQty ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Only POs that actually send material out are offered (job work + service, per
// poSendsMaterialOut). A draft PO is excluded because material cannot leave
// against an unissued order, and cancelled ones are dead. A PO whose lines have
// ALL gone out already (dcSentQty >= totalQty) is excluded too: there is nothing
// left to put on a challan, and offering it only led to a form where every line
// said "fully sent" — UNLESS deviated pieces are still waiting to go back to the
// vendor (ADR-219). An order leaves this list only when it owes nothing AND has
// nothing waiting to go back: a 50-piece order fully sent with 20 pieces to
// return used to vanish from this screen entirely, so the one place that could
// tell the storekeeper what to do had removed it. The whole eligible set
// loads in one fetch and scrolls; the search box filters it client-side across
// EVERY visible column via the shared matchesSearchTerm helper (universal-search
// standard) — so typing a vendor, a type or a status finds the row, not only the
// PO number. (Client-side because the picker holds its bounded set in the
// browser; there is no server-side page to hide matching rows behind.)
function PoPickerBody({ onSelect }: { onSelect: (poId: string) => void }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = usePurchaseOrdersList({ limit: 200, offset: 0 });

  const eligible = useMemo(() => {
    const rows = (data?.items ?? []).filter(
      (p) =>
        poSendsMaterialOut(p.poType) &&
        p.status !== 'draft' &&
        p.status !== 'cancelled' &&
        // Something is still to send (a PO with no lines, totalQty 0, stays
        // listed: the form, not the picker, explains that) OR deviated pieces
        // are still waiting to go back — ADR-219.
        (p.totalQty === 0 || p.dcSentQty < p.totalQty || rtvPendingQty(p) > 0),
    );
    if (search.trim() === '') return rows;
    return rows.filter((p) =>
      matchesSearchTerm(
        [
          p.code,
          p.poDate,
          p.vendorName,
          p.vendorCodeText,
          p.poType === 'service' ? 'Service' : 'Job Work',
          p.status,
          p.lineCount,
          `${p.dcSentQty}/${p.totalQty}`,
          rtvPendingQty(p) > 0 ? rtvPendingQty(p) : null,
        ],
        search,
      ),
    );
  }, [data, search]);
  // Is any order on screen holding pieces to go back? Decides whether the note
  // under the heading that explains the marked rows is shown at all.
  const anyRtvPending = useMemo(() => eligible.some((p) => rtvPendingQty(p) > 0), [eligible]);

  return (
    <>
      <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
        Pick a PO.
      </div>
      {/* ADR-219 — why an order with nothing left to send is still in the list,
          said once above the table instead of on every row. */}
      {anyRtvPending ? (
        <div style={{ fontSize: 11, color: 'var(--amber2)', marginBottom: 12 }}>
          Marked orders have deviated pieces waiting to go back to the vendor. This screen sends
          fresh pieces only — raise the return on Against NC.
        </div>
      ) : null}

      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label className="form-label" htmlFor="dc-po-search">
          Search this list
        </label>
        <input
          id="dc-po-search"
          className="innovic-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="PO no, vendor, type, status…"
        />
      </div>

      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase orders…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          Could not load POs. Try again.
        </div>
      ) : eligible.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--amber2)' }}>
          No Job Work / Service PO is open for dispatch
          {search.trim() ? ' for this search' : ''}. Raise or issue one first.
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>PO No.</th>
                <th>PO Date</th>
                <th>Vendor</th>
                <th>PO Type</th>
                <th>PO Status</th>
                <th className="th-num">Lines</th>
                <th className="th-num">Sent / Order Qty</th>
                {/* ADR-219 / NAMING §A — the SAME fact the Job Card op card
                    calls Return Challan Pending, summed per purchase order. */}
                <th className="th-num">Return Challan Pending</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {eligible.map((p) => {
                const rtvPending = rtvPendingQty(p);
                return (
                  // Marked when pieces are waiting to go back, so an order with
                  // 0 left to send does not look like a mistake (ADR-219).
                  <tr key={p.id} className={rtvPending > 0 ? 'row-pending' : undefined}>
                    <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                      {p.code}
                    </td>
                    <td className="mono">{fmtDate(p.poDate)}</td>
                    <td>{p.vendorName ?? p.vendorCodeText ?? '—'}</td>
                    <td style={{ color: 'var(--purple)' }}>
                      {p.poType === 'service' ? 'Service' : 'Job Work'}
                    </td>
                    <td className="mono">
                      {PO_STATUS_LABEL[p.status] ?? p.status.replaceAll('_', ' ')}
                    </td>
                    <td className="mono td-num">{p.lineCount}</td>
                    {/* Amber once something has gone out: this PO is part-way
                        through, and the challan being raised is a balance one. */}
                    <td
                      className="mono td-num"
                      style={{ color: p.dcSentQty > 0 ? 'var(--amber)' : undefined }}
                    >
                      {p.dcSentQty} / {p.totalQty}
                    </td>
                    {/* Blank, not 0, when nothing is waiting — a column of
                        zeros would read as a figure worth checking. */}
                    <td
                      className="mono td-num"
                      style={{ color: rtvPending > 0 ? 'var(--amber2)' : undefined }}
                      title={
                        rtvPending > 0
                          ? `${rtvPending} pcs are waiting to go back to the vendor. Raise that challan on Against NC.`
                          : undefined
                      }
                    >
                      {rtvPending > 0 ? rtvPending : ''}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelect(p.id)}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PoDcFormBody({
  poId,
  onChangePo,
  exit,
  saveCtl,
  onSwitchToNc,
}: {
  poId: string;
  onChangePo: () => void;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
  /** ADR-219 — hand the user to Against NC for the pieces waiting to go back. */
  onSwitchToNc: (ncSearch: string) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { data: po, isLoading: poLoading, isError: poError } = usePurchaseOrder(poId);
  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const create = useCreateDeliveryChallan(saveKey);
  // Asked as soon as the PO is known, so the allowance is on screen before the
  // first keystroke rather than after the first failed save.
  const { data: sendable } = useDcSendable(poId);
  // Raising a DC is `entry` on ospdc_create (Purchase). Checked here too, not
  // just on the list button — the route is reachable by URL, and without this
  // an L1 Viewer got the whole form and failed only at the API.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  // ADR-211 — pieces from this PO waiting to go back to the vendor (an RTV NC
  // ready, or still awaiting QC's decision). The fetch below is only the early
  // warning; the server is the guard (409 rtv_pending on Save).
  const rtv = useRtvCandidates(poId);
  // NCs the server named in a 409 — kept so the warning shows even when the
  // fetch above failed or ran before QC disposed the NC.
  const [rtvConflictRows, setRtvConflictRows] = useState<RtvPanelRow[]>([]);
  // The id set the store ticked against ("a,b,c", sorted). A tick holds only
  // for the exact set it was given on.
  const [rtvConfirmedKey, setRtvConfirmedKey] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [codeValid, setCodeValid] = useState(false);
  // S2: the number the field auto-filled. It is only a preview — the form
  // sends a number only when the user changed it (docCodeToSend).
  const [suggestedCode, setSuggestedCode] = useState('');
  const [dcDate, setDcDate] = useState(todayIst());
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
        clientPoLineNo: l.clientPoLineNo,
        itemNameText: l.itemName ?? null,
        // The PO line's item unit (items.uom, read on the PO detail), so a 25 KGS
        // bar lot is challaned as KGS — not NOS. A line with no item (or an
        // unknown unit) falls back to NOS, as the print already does.
        uom: toUom(l.uom),
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

  // The PO lines this challan sends — the SAME set onSubmit builds the payload
  // from. Only NCs on these lines can hold the save.
  const sendingDrafts = useMemo(
    () => lineDrafts.filter((l) => Number(l.shipQty) > 0),
    [lineDrafts],
  );

  // Everything waiting to go back on THIS PO: fetched candidates merged with any
  // the server named in a 409 (by ncId, the 409 being fresher). NOT narrowed.
  //
  // ADR-219 — this set is what the panel TELLS the user about, and it has to be
  // the whole order, not the lines being shipped. On a fully-sent order every
  // line's cap is 0, so no qty can legitimately be typed, so the narrowed set
  // below is always empty — and the panel never rendered at all. That is the
  // exact case ADR-219 exists for: the order now stays in the picker, and the
  // storekeeper who opens it was still told nothing. The data was already in
  // hand; only the gate was wrong.
  const rtvOnPo = useMemo<RtvPanelRow[]>(() => {
    const byId = new Map<string, RtvPanelRow>();
    for (const c of rtv.data?.items ?? []) {
      byId.set(c.ncId, {
        ncId: c.ncId,
        ncCode: c.ncCode,
        itemCodeLabel: itemCodeWithRev(c.itemCode ?? c.itemCodeText, c.itemRevision),
        rejectedQty: c.rejectedQty,
        openQty: c.openQty,
        state: c.state,
        poLineId: c.purchaseOrderLineId,
      });
    }
    for (const r of rtvConflictRows) {
      const had = byId.get(r.ncId);
      byId.set(r.ncId, had ? { ...had, state: r.state, poLineId: r.poLineId } : r);
    }
    return [...byId.values()];
  }, [rtv.data, rtvConflictRows]);
  // ADR-211 — the deviations that may HOLD THE SAVE: only those on lines this
  // challan is actually shipping. A deviation on a line we are not touching is
  // worth telling the user about (rtvOnPo, above) but must not demand a tick
  // before an unrelated line can go out. Two sets because they answer two
  // different questions; collapsing them is what broke the panel.
  const rtvRows = useMemo<RtvPanelRow[]>(() => {
    const sendingLineIds = new Set(sendingDrafts.map((l) => l.purchaseOrderLineId));
    return rtvOnPo.filter((r) => r.poLineId !== null && sendingLineIds.has(r.poLineId));
  }, [rtvOnPo, sendingDrafts]);
  // ADR-219 — the TOTAL still to go back on this PO, over everything waiting on
  // it. Netted (openQty), never the gross rejected figure.
  const rtvOpenTotal = useMemo(() => rtvOnPo.reduce((sum, r) => sum + rtvOpenQty(r), 0), [rtvOnPo]);
  const rtvShownKey = useMemo(
    () =>
      rtvRows
        .map((r) => r.ncId)
        .sort()
        .join(','),
    [rtvRows],
  );
  const rtvConfirmed = rtvRows.length > 0 && rtvConfirmedKey === rtvShownKey;
  // The shown set changed after the tick (a new NC appeared, a line was
  // emptied or filled): the tick no longer covers what is on screen — clear it.
  useEffect(() => {
    if (rtvConfirmedKey !== null && rtvConfirmedKey !== rtvShownKey) setRtvConfirmedKey(null);
  }, [rtvConfirmedKey, rtvShownKey]);
  // Save waits while the check is genuinely in flight (isLoading is false once
  // it errors, so this cannot hang); a failed check does NOT block — the server
  // still refuses with 409 rtv_pending.
  const rtvBlocks = rtv.isLoading || (rtvRows.length > 0 && !rtvConfirmed);
  // "Send the N back → Against NC" drops this form: ask first if anything was
  // typed (the auto-filled DC No. alone does not count).
  const [confirmSwitch, setConfirmSwitch] = useState(false);

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
        return (
          sendNowIssue(l.shipQty, capByLine.get(l.purchaseOrderLineId), l.poLineQty, l.uom) === null
        );
      }),
    // codeValid flips asynchronously (the doc-number duplicate check); it MUST be
    // a dependency or the Save button's enabled state lags the real validity.
    [po, dcDate, codeValid, lineDrafts, capByLine],
  );

  const dirty =
    code !== '' ||
    transport !== '' ||
    vehicleNo !== '' ||
    lineDrafts.some((l) => l.shipQty !== '' || l.materialText !== '' || l.dcRemarks !== '');
  useReportSave(saveCtl, {
    canSave: perms.entry && canSubmit && !rtvBlocks,
    saving: submitting,
    dirty,
  });

  // FLOW HELPER (frontend only): put each line's "Can send now" figure into
  // its Send Now box. Lines whose allowance is not known yet, or is 0, stay
  // blank. Every box stays editable; nothing is filled until this is clicked.
  const fillAllPending = (): void => {
    setLineDrafts((prev) =>
      prev.map((l) => {
        const cap = capByLine.get(l.purchaseOrderLineId);
        if (!cap) return l;
        const max = maxSendNow(cap, l.poLineQty);
        return { ...l, shipQty: max > 0 ? String(max) : '' };
      }),
    );
  };

  if (!perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)' }}>
        You do not have permission to create DCs. Ask an admin.
      </div>
    );
  }

  if (poLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }

  if (poError || !po) {
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        Could not load PO. Try again.
      </div>
    );
  }

  const onSubmit = async (): Promise<void> => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const lines = sendingDrafts.map((l) => ({
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
          code: docCodeToSend(code, suggestedCode),
          dcDate,
          purchaseOrderId: po.id,
          poCodeText: po.code,
          vendorId: po.vendorId ?? null,
          // The vendor's code, never the PO number (A32, NAMING: Vendor Code). A
          // linked vendor needs nothing here: the server stores the master's code.
          ...(po.vendorCodeText ? { vendorCodeText: po.vendorCodeText } : {}),
          transport: transport.trim() || null,
          vehicleNo: vehicleNo.trim() || null,
          // ADR-211 — the NCs the store saw when it ticked; sent only when ticked.
          ...(rtvConfirmed ? { rtvConfirmedNcIds: rtvRows.map((r) => r.ncId) } : {}),
        },
        lines,
      };
      const created = await create.mutateAsync(input);
      exit.leave(() => void navigate({ to: '/delivery-challans/$id', params: { id: created.id } }));
    } catch (e) {
      // QC disposed an NC on this PO between page load and Save (or the check
      // failed): show the NCs the server named, and make the store tick again.
      if (isRtvPendingConflict(e)) {
        const named = e.details.ncs.map(
          (n): RtvPanelRow => ({
            ncId: n.ncId,
            ncCode: n.ncCode,
            itemCodeLabel: n.itemCode ?? '—',
            rejectedQty: n.rejectedQty,
            // The 409 names the NCs holding the save and carries only the gross
            // figure, so that is the best available here. It can only overstate
            // a partly recovered deviation, never hide one — and the fetched
            // candidate (which does carry openQty) replaces this row as soon as
            // the refetch below lands.
            openQty: n.rejectedQty,
            state: n.state,
            poLineId: n.poLineId,
          }),
        );
        setRtvConflictRows((prev) => [
          ...prev.filter((p) => !named.some((n) => n.ncId === p.ncId)),
          ...named,
        ]);
        setRtvConfirmedKey(null);
        void rtv.refetch();
      }
      setSubmitError(e instanceof Error ? e.message : 'Could not save DC. Try again.');
    } finally {
      setSubmitting(false);
    }
  };
  // The page header's Save (and Ctrl+S) run this body's save.
  saveCtl.submitRef.current = () => void onSubmit();

  const editedForSwitch =
    (code !== '' && code !== suggestedCode) ||
    transport !== '' ||
    vehicleNo !== '' ||
    lineDrafts.some((l) => l.shipQty !== '' || l.materialText !== '' || l.dcRemarks !== '');
  // Against NC lists the deviations themselves and searches by NC No. / item —
  // not by PO No. — so seed its search only when ONE deviation is waiting and
  // the search can land on it. With several, it opens on the full list.
  const doSwitch = (): void =>
    exit.leave(() => onSwitchToNc(rtvOnPo.length === 1 ? (rtvOnPo[0]?.ncCode ?? '') : ''));
  const onSwitchClick = (): void => {
    if (editedForSwitch) setConfirmSwitch(true);
    else doSwitch();
  };

  return (
    <>
      {/* Save error right under the header's Save. */}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          margin: '4px 0 14px',
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
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>PO No.</span>
            <br />
            <b className="mono" style={{ color: 'var(--blue)' }}>
              {po.code}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Vendor</span>
            <br />
            <b>{po.vendorName ?? po.vendorCodeText ?? '—'}</b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Process</span>
            <br />
            {/* The operation the vendor does: an OSP PO line carries it in
                lineRemarks (written from the JC op / PR operation, and read the
                same way as the JW DC's processText) — NOT the PO header's
                Remarks, which is free text about the order. */}
            <b style={{ color: 'var(--purple)' }}>
              {[
                ...new Set(
                  po.lines.map((l) => (l.lineRemarks ?? '').trim()).filter((t) => t !== ''),
                ),
              ].join(', ') || '—'}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Lines</span>
            <br />
            <b>{po.lines.length}</b>
          </div>
        </div>
        {/* Return to the picker WITHOUT leaving the screen — the browser-Back path
            the old two-screen flow used to offer, now in-component state. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10 }}
          onClick={onChangePo}
        >
          <ArrowLeft size={12} /> Choose a different PO
        </button>
      </div>

      {/* 12-column grid: DC No. · DC Date · Transporter · Vehicle No. (3 + 3 + 4 + 2). */}
      <FormGrid>
        <div className="f-sm">
          <DocNumberInput
            type="delivery_challan"
            value={code}
            onChange={setCode}
            required
            id="dc-code"
            onValidityChange={setCodeValid}
            onSuggestedChange={setSuggestedCode}
          />
        </div>
        <FormField label="DC Date" required size="sm" htmlFor="dc-date">
          <input
            id="dc-date"
            type="date"
            className="innovic-input"
            value={dcDate}
            onChange={(e) => setDcDate(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Transporter" size="md" htmlFor="dc-transport">
          <input
            id="dc-transport"
            className="innovic-input"
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            placeholder="Transporter name"
          />
        </FormField>
        <FormField label="Vehicle No." size="xs" htmlFor="dc-vehicle-no">
          <input
            id="dc-vehicle-no"
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="GJ-01-AB-1234"
          />
        </FormField>
      </FormGrid>

      {/* ADR-211 — pieces waiting to go back to the vendor on a PO line this
          challan sends. Shown only when there are some; with none, Against PO
          is exactly as before. */}
      {rtv.isError ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 'var(--sp-2)' }}>
          Could not check for pieces waiting to go back; the save will check.
        </div>
      ) : null}
      {rtvOnPo.length > 0 ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          {/* ADR-219 — lead with the TOTAL still to go back, and say plainly
              that this screen's quantities do not include it. */}
          <Banner
            tone="warn"
            role="alert"
            flush
            title={
              rtvOpenTotal > 0
                ? `${rtvOpenTotal} pcs on this PO must go back to the vendor — send them separately`
                : 'Pieces on this PO must go back to the vendor — send them separately'
            }
          >
            <div style={{ marginBottom: 6 }}>
              They are <b>not</b> part of what this screen offers: Against PO sends fresh pieces
              only. Raise the return on Against NC, one challan per deviation.
            </div>
            <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
              {rtvOnPo.map((r) => (
                <li key={r.ncId}>
                  <b className="mono fw-700">{r.ncCode}</b> —{' '}
                  <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                    {r.itemCodeLabel}
                  </b>{' '}
                  — {rtvOpenQty(r)} pcs — {RTV_CANDIDATE_STATE_LABELS[r.state]}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSwitchClick}>
                {rtvOpenTotal > 0
                  ? `Send the ${rtvOpenTotal} back → Against NC`
                  : 'Send them back → Against NC'}
              </button>
              {/* Only when a line this challan IS shipping carries a deviation.
                  On a fully-sent order nothing can be shipped, so there is
                  nothing to confirm — the panel is pure information there, and
                  demanding a tick for a Save that cannot happen would be noise. */}
              {rtvRows.length > 0 ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={rtvConfirmed}
                    onChange={(e) => setRtvConfirmedKey(e.target.checked ? rtvShownKey : null)}
                  />
                  These are new pieces, not the ones waiting to go back
                  <span className="req">★</span>
                </label>
              ) : null}
            </div>
          </Banner>
        </div>
      ) : null}
      {confirmSwitch ? (
        <ExitConfirmDialog
          onExit={() => {
            setConfirmSwitch(false);
            doSwitch();
          }}
          onStay={() => setConfirmSwitch(false)}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: 'var(--sp-3) 0 var(--sp-2)',
        }}
      >
        <h2 className="panel-title">Items to Send</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={fillAllPending}
          disabled={!sendable}
        >
          Fill all pending
        </button>
      </div>
      <div className="tbl-wrap" style={{ marginBottom: 14 }}>
        <table className="innovic-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: '5%' }}>Ln</th>
              {/* POL = the CUSTOMER's own PO line number off the SO line behind
                  this PO line. Widths below still total 100. */}
              <th style={{ width: '5%', color: 'var(--purple)' }}>POL</th>
              <th style={{ width: '14%' }}>Item Code</th>
              <th style={{ width: '20%' }}>Item Name</th>
              <th className="th-num" style={{ width: '8%' }}>
                PO Qty
              </th>
              <th style={{ width: '6%' }}>UOM</th>
              <th className="th-num" style={{ width: '12%', color: 'var(--green2)' }}>
                Send Now<span className="req">★</span>
              </th>
              <th style={{ width: '16%' }}>Material</th>
              <th style={{ width: '14%' }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {lineDrafts.map((l, idx) => {
              const cap = capByLine.get(l.purchaseOrderLineId);
              const max = maxSendNow(cap, l.poLineQty);
              const issue = sendNowIssue(l.shipQty, cap, l.poLineQty, l.uom);
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
                    {/* POL — the customer's PO line number; '—' on a line with
                        no sales order behind it (raw material, bought-in). */}
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    {/* CODE/REV while raising the challan, so this screen agrees
                        with the saved challan and its printout instead of showing
                        a bare code that gains a revision the moment it is saved. */}
                    <td
                      className="mono"
                      style={{ color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                      {itemCodeWithRev(l.itemCodeText, l.itemRevision)}
                    </td>
                    <td>{l.itemNameText}</td>
                    <td className="mono td-num">{l.poLineQty}</td>
                    {/* Read-only: the unit comes from the PO line's item. */}
                    <td className="mono">{l.uom}</td>
                    <td className="td-num">
                      <input
                        type="number"
                        step={qtyStepForUom(l.uom)}
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
                            fontSize: 11,
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
                      <td colSpan={9} style={{ padding: '0 8px 8px' }}>
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
    </>
  );
}

// ═══ Against NC — the return-to-vendor challan (design §5) ════════════════════
// A SECOND entry point to the exact flow the NC detail page runs. It calls
// useCreateNcDc (NOT createDeliveryChallan) so the NC linkage and the
// one-challan-per-NC lock are set. The qty is never asked: the challan line is
// the NC's full rejected qty by rule (interlock 4), shown read-only below.
// Picker and form share ONE screen: the picker shows until an NC is chosen, then
// the form body renders in its place. The body is keyed on ncId so its dependent
// fields (vendor/date/etc.) remount clean when the chosen NC changes.

function NcDcSection({
  initialSearch,
  exit,
  saveCtl,
}: {
  /** ADR-219 — the NC No. the Against PO warning sent the user here to raise,
   *  when there was exactly one. Blank otherwise. */
  initialSearch: string;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
}): React.JSX.Element {
  const [ncId, setNcId] = useState<string | null>(null);
  // Held here, not in the picker, so "Choose a different NC" comes back to the
  // same search (the same shape as JwpoDcRtvSection).
  const [search, setSearch] = useState(initialSearch);

  if (ncId === null) {
    return <NcPickerBody search={search} onSearchChange={setSearch} onSelect={setNcId} />;
  }
  return (
    <NcDcFormBody
      key={ncId}
      ncId={ncId}
      onChangeNc={() => setNcId(null)}
      exit={exit}
      saveCtl={saveCtl}
    />
  );
}

// Only NCs ready for a return-to-vendor challan are offered — disposition
// return_to_vendor, status disposed, no challan yet (useEligibleRtvNcs, the
// pendingRtvChallan predicate). The whole eligible set loads in one fetch and
// scrolls; the search box filters it client-side across EVERY visible column (NC
// No, item code, item name) via the shared matchesSearchTerm helper (universal-
// search standard).
function NcPickerBody({
  search,
  onSearchChange,
  onSelect,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  onSelect: (ncId: string) => void;
}): React.JSX.Element {
  const { data, isLoading, isError } = useEligibleRtvNcs();

  const eligible = useMemo(() => {
    const items = data?.items ?? [];
    if (search.trim() === '') return items;
    return items.filter((n) =>
      matchesSearchTerm(
        [n.code, n.itemCode, n.itemCodeText, n.itemName, n.itemNameText, n.rejectedQty],
        search,
      ),
    );
  }, [data, search]);

  return (
    <>
      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label className="form-label" htmlFor="dc-nc-search">
          Search this list
        </label>
        <input
          id="dc-nc-search"
          className="innovic-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="NC no, item code, item name…"
        />
      </div>

      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NCs…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          Could not load NCs. Try again.
        </div>
      ) : eligible.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--amber2)' }}>
          No NC is awaiting a return-to-vendor challan
          {search.trim() ? ' for this search' : ''}. Dispose an NC as “Return to Vendor” first.
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>NC No.</th>
                {/* POL = the CUSTOMER's own PO line number off the SO line
                    behind the job card this NC was raised on. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code · Name</th>
                <th className="th-num">Qty to Return</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {eligible.map((n) => (
                <tr key={n.id}>
                  <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {n.code}
                  </td>
                  <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                    {n.clientPoLineNo ?? '—'}
                  </td>
                  <td>
                    <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {itemCodeWithRev(n.itemCode ?? n.itemCodeText, n.itemRevision)}
                    </b>
                    <div className="text2" style={{ fontSize: 11 }}>
                      {n.itemName ?? n.itemNameText ?? '—'}
                    </div>
                  </td>
                  <td className="mono td-num" style={{ color: 'var(--red2)' }}>
                    {Number(n.rejectedQty)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onSelect(n.id)}
                    >
                      Select
                    </button>
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

// ═══ Against JW PO / DC — the return-to-vendor challan found by PO / DC No. ═══
// ADR-211. The store knows the JW PO No. or the DC No. the pieces first went out
// on, not the NC No. The picker lists the return-to-vendor NCs behind them
// (GET /delivery-challans/rtv-candidates); picking one opens the EXISTING
// NcDcFormBody, so the save is still useCreateNcDc — one writer for the RTV qty
// and the one-challan-per-NC lock (CLAUDE.md §20.1). One challan per NC.

function JwpoDcRtvSection({
  initialSearch,
  exit,
  saveCtl,
}: {
  initialSearch: string;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
}): React.JSX.Element {
  const [ncId, setNcId] = useState<string | null>(null);
  // Held here, not in the picker, so "Choose a different NC" comes back to the
  // same search.
  const [search, setSearch] = useState(initialSearch);

  if (ncId === null) {
    return <JwpoDcPickerBody search={search} onSearchChange={setSearch} onSelect={setNcId} />;
  }
  return (
    <NcDcFormBody
      key={ncId}
      ncId={ncId}
      onChangeNc={() => setNcId(null)}
      exit={exit}
      saveCtl={saveCtl}
    />
  );
}

function NcDcFormBody({
  ncId,
  onChangeNc,
  exit,
  saveCtl,
}: {
  ncId: string;
  onChangeNc: () => void;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { data: eff } = useMyAccess();
  // Same gate the NC detail page and the server enforce for this challan
  // (ADR-211, owner): OSP Outward DC ENTRY alone raises the return challan, on
  // every route. Disposing the NC stays with QC (nc_dispose) — not needed here.
  // Checked here too because the route is reachable by URL.
  const canCreateDc = effectiveFormPerms(eff, 'ospdc_create').entry;
  const qc = useQueryClient();

  // Reuse the NC detail hook rather than refetch by hand — same cache, same
  // shape. rejectedQty / item fields come straight off it and refresh with ncId.
  const { data: nc, isLoading, isError } = useNcRegister(ncId);
  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createDc = useCreateNcDc(ncId, saveKey);

  // Only what createNcDcInputSchema takes: dcDate, vendor, transport, vehicleNo,
  // remarks. No lines, no qty — the server derives the line from the NC.
  const [dcDate, setDcDate] = useState(todayIst());
  const [vendorId, setVendorId] = useState<string | null>(null);
  // The picker's label is "CODE — Name"; the challan stores the code text next to
  // the id (the DC's ADR-015 pair), so the code is peeled off here.
  const [vendorCodeText, setVendorCodeText] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The goods go back to the vendor they came from, so the NC's source vendor
  // (the GRN's supplier, or the outsource PO's vendor) is filled in once the NC
  // loads. It stays editable — the user may pick another vendor.
  const sourceVendorId = nc?.sourceVendorId ?? null;
  const sourceVendorCode = nc?.sourceVendorCode ?? '';
  const seededVendorRef = useRef(false);
  useEffect(() => {
    if (seededVendorRef.current || !sourceVendorId || !sourceVendorCode) return;
    seededVendorRef.current = true;
    setVendorId(sourceVendorId);
    setVendorCodeText(sourceVendorCode);
  }, [sourceVendorId, sourceVendorCode]);
  const sourceVendorLabel = sourceVendorId
    ? [nc?.sourceVendorCode, nc?.sourceVendorName].filter(Boolean).join(' — ')
    : '';

  // Guard against reaching this form for an NC that is not (or no longer)
  // eligible — the server enforces the same predicate, but saying it here avoids
  // a confusing rejection after the vendor has been picked. Computed before the
  // early returns (reading `nc?.`) so the header Save state can be reported.
  const alreadyHasChallan = Boolean(nc?.deliveryChallanId);
  const isEligible =
    nc?.disposition === 'return_to_vendor' && nc.status === 'disposed' && !alreadyHasChallan;
  const canSubmit = isEligible && dcDate !== '' && vendorId != null && vendorCodeText !== '';
  // The pre-filled source vendor is not the user's typing — only a change is.
  const dirty =
    vendorId !== (sourceVendorCode ? sourceVendorId : null) ||
    transport !== '' ||
    vehicleNo !== '' ||
    remarks !== '';
  useReportSave(saveCtl, { canSave: canCreateDc && canSubmit, saving: submitting, dirty });

  if (!canCreateDc) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)' }}>
        You do not have permission to create a return DC. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC…
      </div>
    );
  }

  if (isError || !nc) {
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        Could not load NC. Try again.
      </div>
    );
  }

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
      exit.leave(
        () =>
          void navigate({
            to: '/delivery-challans/$id',
            params: { id: created.deliveryChallanId },
          }),
      );
    } catch (e) {
      // 409 — another user / route raised this NC's challan first. Refetch the
      // Against JW PO / DC candidates so the stale row goes from the picker.
      if (e instanceof ApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: deliveryChallansKeys.rtvCandidatesAll() });
      }
      setSubmitError(e instanceof Error ? e.message : 'Could not save DC. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const itemCode = itemCodeWithRev(nc.itemCode ?? nc.itemCodeText, nc.itemRevision);
  const itemName = nc.itemName ?? nc.itemNameText ?? '—';
  // The page header's Save (and Ctrl+S) run this body's save.
  saveCtl.submitRef.current = () => void onSubmit();

  return (
    <>
      {/* Save error right under the header's Save. */}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 12 }}>
        <Truck size={14} style={{ verticalAlign: -2 }} /> Create Return-to-Vendor Challan
      </div>

      {/* Read-only NC summary. Qty to Return is nc.rejectedQty by rule — the
          full rejected quantity, never editable on this screen.
          ADR-219 — the JW PO the pieces were made under and the challan they
          first went out on are read off the deviation and shown here too: it
          already knows both, so asking the storekeeper for them is asking
          twice. A dash means the deviation genuinely has none (an in-house
          deviation has no purchase order behind it) — never a guess. */}
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          margin: '4px 0 14px',
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
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>NC No.</span>
            <br />
            <b className="mono" style={{ color: 'var(--blue)' }}>
              {nc.code}
            </b>
          </div>
          {/* POL — the customer's own PO line number off the SO line behind
              this NC's job card. */}
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>POL</span>
            <br />
            <b className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {nc.clientPoLineNo ?? '—'}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Item</span>
            <br />
            <b className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCode}
            </b>
            <div className="text2" style={{ fontSize: 11 }}>
              {itemName}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Qty to Return</span>
            <br />
            <b className="mono" style={{ color: 'var(--red2)' }}>
              {Number(nc.rejectedQty)} pcs
            </b>
          </div>
          {/* The job-work order the deviated pieces were made under — NOT the
              ADR-217 replacement order (that is Replacement PO No. elsewhere). */}
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>JW PO No.</span>
            <br />
            <b className="mono fw-700" style={{ color: 'var(--text)' }}>
              {nc.poCode ?? '—'}
            </b>
          </div>
          {/* The outward challan the rejected pieces first went out on. */}
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Sent on DC No.</span>
            <br />
            <b className="mono fw-700" style={{ color: 'var(--text)' }}>
              {nc.sourceDeliveryChallanCode ?? '—'}
            </b>
          </div>
        </div>
        <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
          Read off the deviation — none of it is typed here, and none of it can be edited. Below,
          the vendor is pre-filled from the deviation and may be changed; the DC date, transporter,
          vehicle and remarks are yours to fill.
        </div>
        {/* Return to the picker WITHOUT leaving the screen — in-component state. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10 }}
          onClick={onChangeNc}
        >
          <ArrowLeft size={12} /> Choose a different NC
        </button>
      </div>

      {!isEligible ? (
        <div
          style={{
            color: 'var(--amber2)',
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

      {/* 12-column grid, party first: Vendor · DC Date · Transporter ·
          Vehicle No (4 + 3 + 3 + 2), then Remarks (full). */}
      <FormGrid>
        <VendorPicker
          id="ncdc-vendor"
          className="form-grp f-md"
          value={vendorId}
          initialLabel={sourceVendorLabel}
          onChange={(id, label) => {
            setVendorId(id);
            setVendorCodeText(id ? (label.split(' — ')[0] ?? label) : '');
          }}
        />
        <FormField label="DC Date" required size="sm" htmlFor="ncdc-date">
          <input
            id="ncdc-date"
            type="date"
            className="innovic-input"
            value={dcDate}
            onChange={(e) => setDcDate(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Transporter" size="sm" htmlFor="ncdc-transport">
          <input
            id="ncdc-transport"
            className="innovic-input"
            maxLength={200}
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            placeholder="Transporter name"
          />
        </FormField>
        <FormField label="Vehicle No." size="xs" htmlFor="ncdc-vehicle-no">
          <input
            id="ncdc-vehicle-no"
            className="innovic-input"
            maxLength={50}
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="GJ-01-AB-1234"
          />
        </FormField>
        <FormField label="Remarks" size="full" htmlFor="ncdc-remarks">
          <textarea
            id="ncdc-remarks"
            className="innovic-textarea"
            rows={2}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="optional"
          />
        </FormField>
      </FormGrid>
    </>
  );
}
