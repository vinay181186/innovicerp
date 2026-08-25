// "Create PO from PR" route (UI-003-04).
//
// Compact single-screen layout: the whole form fits above the fold on a laptop,
// so the buyer sees the PO total before submitting instead of scrolling to find
// the button. Deliberately dense — 36px controls, 10px labels — and the
// read-only PR facts sit in ONE horizontal strip rather than a card per fact.
//
// Styles are scoped under `.pof-` and live in this file: the spec's palette
// (#eef1f6 / #e4e7ee / #f7f9fc) and type scale differ from the global theme
// tokens, and confining them here keeps every other screen untouched.

import { type CreatePurchaseOrderFromPrInput, PO_TYPES, type PoType } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useDocNumber } from '@/lib/use-doc-number';
import { usePurchaseRequest } from '@/modules/purchase-requests/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseOrderFromPr } from '../api';

const fromPrSearchSchema = z.object({
  prId: z.string().uuid(),
});

export const purchaseOrderFromPrRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/from-pr',
  validateSearch: fromPrSearchSchema,
  component: PurchaseOrderFromPrPage,
});

interface FormValues {
  code: string;
  poDate: string;
  poType: PoType;
  dueDate?: string;
  taxType?: string;
  sgstPct: number;
  cgstPct: number;
  igstPct: number;
  remarks?: string;
}

const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Scoped stylesheet — see file header for why it is local. */
const CSS = `
/* Bleed the page tint to the edges of #content. The negative margin MUST match
   #content's padding exactly (20px, 12px under 768px in innovic-theme.css) —
   a mismatch pushes the box wider than its parent and adds a horizontal
   scrollbar to the whole app, which this screen must never do.
   Sides and bottom only — a negative TOP margin would ride up over the
   breadcrumb trail that #content renders above the outlet. */
.pof-page{ background:#eef1f6; margin:0 -20px -20px; padding:14px 26px 26px;
  min-height:100%; box-sizing:border-box; }
@media (max-width:768px){ .pof-page{ margin:0 -12px -12px; padding:12px; } }
.pof-root{ font-family:'Public Sans',var(--bfont),sans-serif; color:#1c2333; }
.pof-root .mono,.pof-root .pof-num{ font-family:'JetBrains Mono',var(--mono),monospace; }
.pof-card{ background:#fff; border:1px solid #e4e7ee; border-radius:12px;
  max-width:1180px; margin:0 auto; padding:18px; }

/* Header — title and source chip share one line. */
.pof-hdr{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
.pof-title{ font-size:16px; font-weight:700; letter-spacing:-.01em; }
.pof-chip{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:11.5px; font-weight:600;
  background:#eef3fb; color:#2054a8; border:1px solid #d6e3f7; border-radius:6px; padding:3px 8px; }

/* Read-only PR facts — one strip, dividers between groups. */
.pof-strip{ display:flex; align-items:stretch; border:1px solid #e4e7ee; border-radius:8px;
  background:#fbfcfe; margin-bottom:14px; overflow:hidden; }
/* Codes get a fixed narrow column, names get the leftover width. Splitting
   code and name into their own boxes stops "VN-00001 · Shree Heat Treatment"
   being ellipsised into uselessness at the old six-equal-columns width.
   Every cell keeps min-width:0 so the strip can never overflow its card. */
.pof-fact{ flex:1 1 0; min-width:0; padding:6px 12px; border-left:1px solid #e9ecf3; }
.pof-fact:first-child{ border-left:0; }
.pof-fact-code{ flex:0 1 116px; }
.pof-fact-name{ flex:2.4 1 0; }
.pof-fact-sm{ flex:0 1 88px; }
.pof-fact-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; line-height:1.5; }
.pof-fact-v{ font-size:12.5px; font-weight:600; color:#1c2333; line-height:1.5;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Fields */
.pof-lbl{ display:block; font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.07em; color:#8b93a2; margin-bottom:4px; }
.pof-req{ color:#c0392b; margin-left:2px; }
.pof-in{ width:100%; height:36px; border:1px solid #d9dee8; border-radius:7px;
  padding:0 9px; font-size:13px; color:#1c2333; background:#fff; font-family:inherit; }
.pof-in:focus{ outline:2px solid #cfe0f8; border-color:#2563c9; }
.pof-in.pof-num{ font-family:'JetBrains Mono',var(--mono),monospace; }
.pof-ok{ border-color:#1f7a44; }
.pof-bad{ border-color:#c0392b; }
.pof-note{ font-size:11.5px; color:#5a6376; margin-top:3px; line-height:1.4; }
.pof-note-ok{ color:#1f7a44; font-weight:600; }
.pof-note-bad{ color:#c0392b; font-weight:600; }

/* Sized to their content instead of stretched across the full card — a date
   picker does not need 280px. Wraps rather than overflows on a narrow window. */
.pof-row4{ display:flex; flex-wrap:wrap; gap:12px 14px; margin-bottom:14px; }
.pof-f-po{ flex:0 1 176px; min-width:0; }
.pof-f-date{ flex:0 1 148px; min-width:0; }
.pof-f-type{ flex:0 1 158px; min-width:0; }

/* Tax + live totals share one row. */
.pof-tax{ background:#f7f9fc; border:1px solid #e4e7ee; border-radius:8px; padding:12px 14px;
  display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
.pof-tax-f{ width:96px; flex:0 0 auto; }
.pof-tax-f.pof-tax-type{ width:150px; }
.pof-dim{ opacity:.45; }
.pof-tot{ margin-left:auto; display:flex; align-items:flex-end; gap:20px; text-align:right; }
.pof-tot-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; margin-bottom:2px; }
.pof-tot-v{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:14px; font-weight:600; color:#3a4256; }
.pof-tot-big .pof-tot-v{ font-size:20px; font-weight:700; color:#8a5a00; }

.pof-ta{ width:100%; border:1px solid #d9dee8; border-radius:7px; padding:7px 9px;
  font-size:13px; color:#1c2333; font-family:inherit; resize:vertical; }
.pof-ta:focus{ outline:2px solid #cfe0f8; border-color:#2563c9; }

/* Footer */
.pof-foot{ display:flex; align-items:center; justify-content:space-between; gap:12px;
  border-top:1px solid #e4e7ee; margin-top:16px; padding-top:13px; }
.pof-foot-hint{ font-size:11.5px; color:#5a6376; }
.pof-acts{ display:flex; gap:8px; }
.pof-btn{ height:36px; padding:0 15px; border-radius:7px; font-size:13px; font-weight:600;
  font-family:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.pof-btn-cancel{ background:#fff; color:#3a4256; border:1px solid #d9dee8; }
.pof-btn-cancel:hover{ background:#f4f6fa; }
.pof-btn-go{ background:#1f7a44; color:#fff; border:1px solid #1f7a44; }
.pof-btn-go:hover:not(:disabled){ background:#1a6839; }
.pof-btn-go:disabled{ opacity:.5; cursor:not-allowed; }

.pof-msg{ border-radius:7px; padding:8px 12px; font-size:12.5px; margin-bottom:12px; }
.pof-msg-warn{ background:#fdf3da; border:1px solid #f2d9a0; color:#8a5a00; }
.pof-msg-err{ background:#fdecea; border:1px solid #f5c2bc; color:#a4291c; }
`;

function PurchaseOrderFromPrPage(): React.JSX.Element {
  const { prId } = purchaseOrderFromPrRoute.useSearch();
  const navigate = useNavigate();
  // Route-level gate. Converting a PR raises a NEW PO, so this is the entry
  // action (L2 Data Entry and up), same as "+ New PO". Reached from a link on
  // the PR screen, but the URL is typeable — without this the whole form was
  // open to anyone who could log in.
  const { data: eff, isPending: accessPending } = useMyAccess();
  const canCreate = effectiveFormPerms(eff, 'po_create').entry;
  const { data: pr, isLoading, isError, error } = usePurchaseRequest(prId);
  const createFromPr = useCreatePurchaseOrderFromPr();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaults: FormValues = {
    code: '',
    poDate: todayLocal(),
    poType: 'job_work',
    sgstPct: 0,
    cgstPct: 0,
    igstPct: 0,
  };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;

  // PO number field is built inline rather than via the shared DocNumberInput:
  // the spec's 10px label / 36px control / "✕ Already used" wording is local to
  // this screen, and restyling the shared component would move every other form.
  const code = watch('code') ?? '';
  const docNo = useDocNumber('purchase_order', code);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefilled.current && docNo.nextCode && code.trim() === '') {
      setValue('code', docNo.nextCode);
      prefilled.current = true;
    }
  }, [docNo.nextCode, code, setValue]);

  const taxType = watch('taxType') ?? '';
  const isSplit = taxType === 'sgst_cgst';
  const isIgst = taxType === 'igst';

  const qty = Number(pr?.qty ?? 0);
  const est = Number(pr?.estCost ?? 0);
  const subtotal = qty * est;
  const taxPct = isSplit
    ? Number(watch('cgstPct') || 0) + Number(watch('sgstPct') || 0)
    : isIgst
      ? Number(watch('igstPct') || 0)
      : 0;
  const taxAmt = (subtotal * taxPct) / 100;
  const poTotal = subtotal + taxAmt;

  const codeEmpty = code.trim() === '';
  const canSubmit = !codeEmpty && docNo.valid && !docNo.checking;

  const onSubmit = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    if (!pr) return;
    const payload: CreatePurchaseOrderFromPrInput = {
      prId: pr.id,
      header: {
        // Blank → undefined so the server auto-generates IN-PO-#####; sending
        // '' fails the schema's code.min(1) → "request validation failed" (T20).
        code: values.code.trim() || undefined,
        poDate: values.poDate,
        poType: values.poType,
        dueDate: values.dueDate || undefined,
        taxType: values.taxType?.trim() || undefined,
        sgstPct: Number(values.sgstPct),
        cgstPct: Number(values.cgstPct),
        igstPct: Number(values.igstPct),
        remarks: values.remarks?.trim() || undefined,
      },
    };
    try {
      const created = await createFromPr.mutateAsync(payload);
      await navigate({ to: '/purchase-orders/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create PO from PR');
    }
  };

  if (isLoading || accessPending) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading source PR…
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Data entry access required to create a purchase order.
        </div>
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Source PR not found'}
          </div>
        </div>
      </div>
    );
  }

  const alreadyConverted = pr.poId !== null || pr.status === 'po_created';
  const isCancelled = pr.status === 'cancelled';

  // Code and name are shown in their own boxes. A PR may carry either a master
  // link (vendorCode/itemCode) or free text (…CodeText) — prefer the master.
  const vendorCode = pr.vendorCode ?? pr.vendorCodeText ?? '—';
  const vendorName = pr.vendorName ?? '—';
  const itemCode = pr.itemCode ?? pr.itemCodeText ?? '—';
  const itemName = pr.itemName ?? '—';

  return (
    <div className="pof-page pof-root">
      <style>{CSS}</style>

      <Link
        to="/purchase-requests/$id"
        params={{ id: pr.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to PR
      </Link>

      <div className="pof-card">
        {/* Title and source ref on ONE line. */}
        <div className="pof-hdr">
          <span className="pof-title">Create Purchase Order</span>
          <span className="pof-chip">from PR {pr.code}</span>
        </div>

        {/* One strip, six facts, divider between each — never a card per fact. */}
        <div className="pof-strip">
          <Fact label="Vendor Code" value={vendorCode} mono cls="pof-fact-code" />
          <Fact label="Vendor Name" value={vendorName} cls="pof-fact-name" />
          <Fact label="Item Code" value={itemCode} mono cls="pof-fact-code" />
          <Fact label="Item Name" value={itemName} cls="pof-fact-name" />
          <Fact label="Operation" value={pr.operation ?? '—'} />
          <Fact label="Qty" value={String(pr.qty)} mono cls="pof-fact-sm" />
          {/* Currency needs the wider column — "₹1,250.00" ellipsises at 88px. */}
          <Fact label="Est. Cost / pc" value={inr(est)} mono cls="pof-fact-code" />
          <Fact label="Required By" value={pr.requiredDate ?? '—'} mono cls="pof-fact-code" />
        </div>

        {alreadyConverted ? (
          <div className="pof-msg pof-msg-warn">
            This PR is already linked to a PO.{' '}
            {pr.poId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: pr.poId }}
                style={{ color: '#2054a8', fontWeight: 700 }}
              >
                View the PO →
              </Link>
            ) : null}
          </div>
        ) : isCancelled ? (
          <div className="pof-msg pof-msg-err">This PR is cancelled — no PO can be generated.</div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)}>
            {/* Four inputs, four columns, one row. */}
            <div className="pof-row4">
              <div className="pof-f-po">
                <label className="pof-lbl" htmlFor="pof-code">
                  PO No.<span className="pof-req">*</span>
                </label>
                <input
                  id="pof-code"
                  className={`pof-in pof-num ${
                    codeEmpty || docNo.error ? 'pof-bad' : docNo.valid ? 'pof-ok' : ''
                  }`}
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setValue('code', e.target.value)}
                  onBlur={() => {
                    if (code.trim()) setValue('code', docNo.padded);
                  }}
                />
                {codeEmpty ? (
                  <div className="pof-note pof-note-bad">
                    <X size={11} style={{ verticalAlign: -1 }} /> PO number is required
                  </div>
                ) : docNo.checking ? (
                  <div className="pof-note">Checking…</div>
                ) : docNo.duplicate ? (
                  <div className="pof-note pof-note-bad">
                    <X size={11} style={{ verticalAlign: -1 }} /> Already used
                  </div>
                ) : docNo.error ? (
                  <div className="pof-note pof-note-bad">
                    <X size={11} style={{ verticalAlign: -1 }} /> {docNo.error}
                  </div>
                ) : (
                  <div className="pof-note pof-note-ok">
                    <Check size={11} style={{ verticalAlign: -1 }} /> Available
                  </div>
                )}
              </div>

              <div className="pof-f-date">
                <label className="pof-lbl" htmlFor="pof-date">
                  PO Date<span className="pof-req">*</span>
                </label>
                <input
                  id="pof-date"
                  type="date"
                  className="pof-in pof-num"
                  {...register('poDate', { required: 'Date is required' })}
                />
                {formState.errors.poDate?.message ? (
                  <div className="pof-note pof-note-bad">{formState.errors.poDate.message}</div>
                ) : null}
              </div>

              <div className="pof-f-type">
                <label className="pof-lbl" htmlFor="pof-type">
                  PO Type
                </label>
                {/* standard / job_work / service are offered; the server anyway
                    derives the final type from the source PR (OSP → job work,
                    service PR → service, plain buy → standard), so a wrong pick
                    here is corrected. */}
                <select id="pof-type" className="pof-in" {...register('poType')}>
                  {PO_TYPES.filter(
                    (t) => t === 'standard' || t === 'job_work' || t === 'service',
                  ).map((t) => (
                    <option key={t} value={t}>
                      {t.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pof-f-date">
                <label className="pof-lbl" htmlFor="pof-due">
                  Due Date
                </label>
                <input
                  id="pof-due"
                  type="date"
                  className="pof-in pof-num"
                  {...register('dueDate')}
                />
              </div>
            </div>

            {/* Tax inputs sized to their content, with the running total in the
                same row so the amount is visible before submitting. */}
            <div className="pof-tax">
              <div className="pof-tax-f pof-tax-type">
                <label className="pof-lbl" htmlFor="pof-taxtype">
                  Tax Type
                </label>
                <select id="pof-taxtype" className="pof-in" {...register('taxType')}>
                  <option value="">— None —</option>
                  <option value="sgst_cgst">SGST + CGST</option>
                  <option value="igst">IGST</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div className={`pof-tax-f ${isSplit ? '' : 'pof-dim'}`}>
                <label className="pof-lbl" htmlFor="pof-cgst">
                  CGST %
                </label>
                <input
                  id="pof-cgst"
                  type="number"
                  step="0.01"
                  min={0}
                  className="pof-in pof-num"
                  {...register('cgstPct', { valueAsNumber: true })}
                />
              </div>
              <div className={`pof-tax-f ${isSplit ? '' : 'pof-dim'}`}>
                <label className="pof-lbl" htmlFor="pof-sgst">
                  SGST %
                </label>
                <input
                  id="pof-sgst"
                  type="number"
                  step="0.01"
                  min={0}
                  className="pof-in pof-num"
                  {...register('sgstPct', { valueAsNumber: true })}
                />
              </div>
              <div className={`pof-tax-f ${isIgst ? '' : 'pof-dim'}`}>
                <label className="pof-lbl" htmlFor="pof-igst">
                  IGST %
                </label>
                <input
                  id="pof-igst"
                  type="number"
                  step="0.01"
                  min={0}
                  className="pof-in pof-num"
                  {...register('igstPct', { valueAsNumber: true })}
                />
              </div>

              <div className="pof-tot">
                <div>
                  <div className="pof-tot-l">Subtotal</div>
                  <div className="pof-tot-v">{inr(subtotal)}</div>
                </div>
                <div>
                  <div className="pof-tot-l">Tax</div>
                  <div className="pof-tot-v">{inr(taxAmt)}</div>
                </div>
                <div className="pof-tot-big">
                  <div className="pof-tot-l">PO Total</div>
                  <div className="pof-tot-v">{inr(poTotal)}</div>
                </div>
              </div>
            </div>

            <div>
              <label className="pof-lbl" htmlFor="pof-remarks">
                PO Remarks
              </label>
              <textarea
                id="pof-remarks"
                className="pof-ta"
                rows={2}
                placeholder={`From PR ${pr.code}${pr.operation ? ` — ${pr.operation}` : ''} (default if blank)`}
                {...register('remarks')}
              />
            </div>

            {submitError ? (
              <div className="pof-msg pof-msg-err" style={{ marginTop: 12, marginBottom: 0 }}>
                {submitError}
              </div>
            ) : null}

            <div className="pof-foot">
              <span className="pof-foot-hint">Fields marked * are required</span>
              <div className="pof-acts">
                <button
                  type="button"
                  className="pof-btn pof-btn-cancel"
                  onClick={() =>
                    void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } })
                  }
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pof-btn pof-btn-go"
                  disabled={formState.isSubmitting || !canSubmit}
                >
                  {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : '✓'}{' '}
                  Create PO
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Fact(props: {
  label: string;
  value: string;
  mono?: boolean;
  /** Width class — codes narrow, names wide. Defaults to an even share. */
  cls?: string;
}): React.JSX.Element {
  return (
    <div className={`pof-fact${props.cls ? ` ${props.cls}` : ''}`}>
      <div className="pof-fact-l">{props.label}</div>
      <div className={`pof-fact-v${props.mono ? ' pof-num' : ''}`} title={props.value}>
        {props.value}
      </div>
    </div>
  );
}
