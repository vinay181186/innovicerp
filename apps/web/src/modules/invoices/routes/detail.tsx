// Invoice detail — ports legacy _viewInvoice (L21273, verified) plus the
// _addPayment form (L21243). Legacy renders both as modals off renderInvoices
// (L21096, the router's only `invoices` key L2457); the port is a route with a
// real URL, and add-payment is an inline panel rather than a second modal.
//
// Legacy deltas kept deliberately (do NOT "fix" without reading these):
//  - Legacy's plain lines table (L21303: # / Item / Name / Qty / Rate / Amount)
//    is replaced by the A4 paper preview — the same markup the print emits
//    (user direction 2026-06-06: screen = print; the same direction drives
//    lib/print/letterhead.ts, which names Invoice explicitly). No column is
//    lost: the preview carries Sl/Description/Qty/UOM/Rate/Amount.
//  - Action buttons stay in the page header. Legacy puts them at the end of the
//    modal body (L21306); after a 1123px-tall A4 preview that would bury them.
//  - Status renders as a badge in place of legacy's "(status)" parenthetical
//    in the modal title (L21311). It is the SHARED StatusBadge kind="invoice"
//    (unpaid red / partial amber / paid green) — the same component and the
//    same map the invoices list uses, so one invoice cannot read one colour
//    here and another there. The inline `b-green : b-amber : b-red` ternary
//    this file used to carry is what caused exactly that.
//
// Money: every figure here is server-owned (subtotal/gstAmount/grandTotal/
// totalPaid/balance from service.ts rowToInvoice). `balance` is NOT re-derived
// in the browser — legacy computes it client-side at L21275, we do not.
//
// Known divergence (reported, not fixed here — needs the one shared IST/date
// helper): dates render as raw ISO. Legacy fmt() (L1484) shows "15 Jul 26" and
// the sibling list.tsx carries its own copy of that helper; adding a second
// copy here would be one more of the ~12 divergent fmt()s. All three date
// columns (invoice_date / due_date / payment_date) are `date`, not timestamptz,
// so no UTC-shift bug exists at these render sites.

import {
  PAYMENT_MODES,
  PLACE_OF_SUPPLY_UNKNOWN_NOTE,
  type PaymentMode,
  placeOfSupplyLabel,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { fmtDate, todayIst } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { useMyCompany } from '@/modules/settings/api';
import { StatusBadge } from '@/ui/core';
import { Banner } from '@/ui/feedback';
import { Panel } from '@/ui/data';
import { ActionMenu } from '@/ui/layout';
import { useAddPayment, useInvoice } from '../api';
import { SHEET_STYLE } from '@/lib/print/sheet-print';
import { invoiceSheetHtml, printInvoice } from '../lib/print';
import { splitGst } from '../lib/gst-split';

/** Invoice status → the words the user reads; the stored codes are unchanged. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly Paid',
  paid: 'Paid',
};

export const invoiceDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/$id',
  component: InvoiceDetailPage,
});

// Legacy renderInvoices L21110 / _viewInvoice L21296 render rupees as
// Math.round + en-IN (whole rupees, no paise) on both list and detail. The
// shared inrFormat() is 2dp and is what the print doc uses — a different
// format for a different surface, matching legacy's own split.
const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;
// Uses the shared todayIst() helper so the payment-date default is today in
// IST, not the UTC "yesterday" before ~05:30 IST.
const todayStr = (): string => todayIst();

function InvoiceDetailPage(): React.JSX.Element {
  const { id } = invoiceDetailRoute.useParams();
  const { data: inv, isLoading, isError, error } = useInvoice(id);
  const { data: company } = useMyCompany();
  const addPayment = useAddPayment(id);
  // The preview is the print: the same Innovic Sheet markup + stylesheet, in an
  // iframe so the sheet's paper styles never leak into the app's own CSS.
  const docHtml = useMemo(
    () =>
      inv
        ? `<!DOCTYPE html><html><head><style>${SHEET_STYLE}.no-print{display:none!important}</style></head><body>${invoiceSheetHtml(inv, company)}</body></html>`
        : '',
    [inv, company],
  );
  const [previewHeight, setPreviewHeight] = useState(1123);

  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayStr());
  const [payAmt, setPayAmt] = useState('');
  // TDS / short amount the customer deducted — counts toward settling.
  const [payTds, setPayTds] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('NEFT');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'invoice_create');

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Invoices. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !inv) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load invoice. Try again.'}
      </div>
    );
  }

  async function submitPayment(): Promise<void> {
    setPayErr(null);
    const amount = Number(payAmt) || 0;
    const tdsAmount = Number(payTds) || 0;
    if (amount < 0 || tdsAmount < 0) return setPayErr('Amounts cannot be less than 0.');
    if (amount <= 0 && tdsAmount <= 0) {
      return setPayErr('Enter an Amount or a TDS / Short Amount.');
    }
    try {
      await addPayment.mutateAsync({
        paymentDate: payDate,
        amount,
        tdsAmount,
        mode: payMode,
        refNo: payRef || undefined,
        notes: payNotes || undefined,
      });
      setPayOpen(false);
      setPayAmt('');
      setPayTds('');
      setPayRef('');
      setPayNotes('');
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : 'Could not save payment. Try again.');
    }
  }

  // Legacy _viewInvoice L21296-21300: five separate .panel cards, 16px for
  // SUBTOTAL/GST and 18px for TOTAL/PAID/BALANCE. `balance` is server-owned
  // (service.ts rowToInvoice L64) — never re-derived here.
  // Money hidden for L1 Viewers: the API nulls the amounts, so the whole
  // money stat strip, the line rate/amount columns, and the payment amounts
  // are dropped.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = inv.priceVisible === false;
  const stats: { label: string; value: string; size: number; color?: string }[] = priceHidden
    ? []
    : [
        { label: 'Subtotal', value: inr(inv.subtotal ?? 0), size: 16 },
        // The split follows the invoice's Tax Type; an invoice raised before it
        // was recorded shows the single GST figure, as it always did.
        ...(inv.taxType === 'igst'
          ? [
              {
                label: `IGST ${inv.gstPercent}%`,
                value: inr(inv.gstAmount ?? 0),
                size: 16,
                color: 'var(--amber2)',
              },
            ]
          : inv.taxType === 'sgst_cgst'
            ? [
                {
                  label: `SGST ${(inv.gstPercent ?? 0) / 2}%`,
                  value: inr(splitGst(inv.gstAmount ?? 0).sgst),
                  size: 16,
                  color: 'var(--amber2)',
                },
                {
                  label: `CGST ${(inv.gstPercent ?? 0) / 2}%`,
                  value: inr(splitGst(inv.gstAmount ?? 0).cgst),
                  size: 16,
                  color: 'var(--amber2)',
                },
              ]
            : [
                {
                  label: `GST ${inv.gstPercent}%`,
                  value: inr(inv.gstAmount ?? 0),
                  size: 16,
                  color: 'var(--amber2)',
                },
              ]),
        { label: 'Grand Total', value: inr(inv.grandTotal ?? 0), size: 18, color: 'var(--green2)' },
        { label: 'Paid', value: inr(inv.totalPaid ?? 0), size: 18, color: 'var(--cyan)' },
        ...((inv.totalTds ?? 0) > 0
          ? [
              {
                label: 'TDS / Short',
                value: inr(inv.totalTds ?? 0),
                size: 18,
                color: 'var(--purple)',
              },
            ]
          : []),
        {
          label: 'Outstanding Amount',
          value: inr(inv.balance ?? 0),
          size: 18,
          color: (inv.balance ?? 0) > 0 ? 'var(--red)' : 'var(--green)',
        },
      ];

  return (
    <div>
      <Link to="/invoices" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Invoices
      </Link>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Invoice {inv.code}{' '}
          <StatusBadge
            kind="invoice"
            status={inv.status}
            label={INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
          />
        </div>
        {/* One primary next step (Add Payment) + the Actions menu for the rest. */}
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionMenu
            items={[
              {
                label: 'Print',
                onClick: () => {
                  if (!printInvoice(inv, company)) window.alert('Allow popups to print.');
                },
              },
            ]}
          />
          {perms.entry && inv.status !== 'paid' ? (
            <button type="button" className="btn btn-primary" onClick={() => setPayOpen((v) => !v)}>
              💳 Add Payment
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Customer: <b>{inv.clientName ?? '—'}</b> · SO No.:{' '}
        <Link to="/sales-orders/$id" params={{ id: inv.salesOrderId }} className="fw-700">
          {inv.soCode ? soNoWithInternal(inv.soCode, inv.soInternalNo) : '—'}
        </Link>{' '}
        · Due Date: <b>{fmtDate(inv.dueDate)}</b>
        {inv.placeOfSupply ? (
          <>
            {' '}
            · Place of Supply: <b>{placeOfSupplyLabel(inv.placeOfSupply)}</b>
          </>
        ) : null}
      </div>

      {/* Screen only — never on the printed (legal) invoice (plan D2). */}
      {!inv.placeOfSupply ? (
        <div className="mb-2">
          <Banner tone="warn">{PLACE_OF_SUPPLY_UNKNOWN_NOTE}</Banner>
        </div>
      ) : null}

      {/* The invoice keeps its own item names; where the item master's name
          has changed since, show it beside (screen only, plan v3 Step 4). */}
      {inv.lines.some((l) => l.masterItemName && l.masterItemName !== l.itemName) ? (
        <div className="text3" style={{ fontSize: 11, marginBottom: 10 }}>
          {inv.lines
            .filter((l) => l.masterItemName && l.masterItemName !== l.itemName)
            .map((l) => (
              <div key={l.id}>
                Ln {l.lineNo} {l.itemName} — Master: {l.masterItemName}
              </div>
            ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            className="panel"
            style={{ padding: 10, minWidth: 100, textAlign: 'center' }}
          >
            <div className="text3" style={{ fontSize: 11 }}>
              {s.label}
            </div>
            <div className="mono fw-700" style={{ fontSize: s.size, color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {payOpen ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Add Payment</span>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label">Payment Date</label>
                <input
                  type="date"
                  className="innovic-input"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <div className="form-grp">
                {/* Amount or TDS / Short Amount — at least one (the server checks). */}
                <label className="form-label">Amount</label>
                <input
                  type="number"
                  className="innovic-input"
                  min="0"
                  step="0.01"
                  value={payAmt}
                  placeholder={String(Math.round(inv.balance ?? 0))}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">TDS / Short Amount</label>
                <input
                  type="number"
                  className="innovic-input"
                  min="0"
                  step="0.01"
                  value={payTds}
                  placeholder="0"
                  title="Amount the customer deducted (TDS) or paid short. It counts toward settling the invoice."
                  onChange={(e) => setPayTds(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">Payment Mode</label>
                <select
                  className="innovic-input"
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as PaymentMode)}
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-grp">
                <label className="form-label">Reference No.</label>
                <input
                  className="innovic-input"
                  placeholder="UTR / Cheque No."
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                />
              </div>
              <div className="form-grp form-full">
                <label className="form-label">Notes</label>
                <input
                  className="innovic-input"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                />
              </div>
            </div>
            {payErr ? (
              <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{payErr}</div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPayOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={addPayment.isPending}
                onClick={() => void submitPayment()}
              >
                {addPayment.isPending ? 'Saving…' : 'Add Payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* A4-portrait paper preview — identical markup to the print output. */}
      <iframe
        title={`Invoice ${inv.code} preview`}
        // Self-built, esc()'d sheet HTML shared with the print window.
        srcDoc={docHtml}
        onLoad={(e) => {
          const h = e.currentTarget.contentDocument?.documentElement.scrollHeight;
          if (h) setPreviewHeight(h);
        }}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: 860,
          height: previewHeight,
          margin: '0 auto 14px',
          border: 'none',
          borderRadius: 4,
        }}
      />

      {inv.payments.length > 0 && !priceHidden ? (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Payments ({inv.payments.length})</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Amount</th>
                  <th>TDS / Short</th>
                  <th>Mode</th>
                  <th>Reference No.</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 11 }}>{fmtDate(p.paymentDate)}</td>
                    <td className="mono fw-700" style={{ color: 'var(--green2)' }}>
                      {inr(p.amount ?? 0)}
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {(p.tdsAmount ?? 0) > 0 ? inr(p.tdsAmount ?? 0) : '—'}
                    </td>
                    <td style={{ fontSize: 11 }}>{p.mode}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{p.refNo ?? ''}</td>
                    <td style={{ fontSize: 11 }} className="text3">
                      {p.notes ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <RelatedDocsPanel module="invoices" id={inv.id} />

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Invoice" entityId={inv.id} refId={inv.code} />
      </Panel>
    </div>
  );
}
