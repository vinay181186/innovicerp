// Customer Dispatch — one dispatch as a record: what went, on which SO, and
// the Delivery Challan that travels with the truck (Print DC). Save on
// /customer-dispatches/new lands here, so the DC can be printed and the
// invoice raised without hunting for the new DSP on the list.
//
// The page body IS the challan: the same Innovic Sheet markup the print window
// emits, previewed in an iframe (screen = print, as on the invoice detail).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { MasterItemNameNote } from '@/components/shared/master-item-name-note';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
  linePendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { SHEET_STYLE } from '@/lib/print/sheet-print';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { PageHeader, PageState } from '@/ui/layout';
import { useDispatchDetail } from '../api';
import { dispatchSheetHtml, printDispatchChallan } from '../lib/print-dc';

export const customerDispatchDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/$id',
  component: CustomerDispatchDetailPage,
});

function CustomerDispatchDetailPage(): React.JSX.Element {
  const { id } = customerDispatchDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: d, isLoading, isError, error } = useDispatchDetail(id);
  const { data: client } = useClient(d?.clientId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  // ADR-202 — the edit(s) staged against this dispatch, still awaiting a
  // decision. Their per-field changes drive the inline amber chips below.
  const pendingEdit = usePendingEditForDoc('Dispatch', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  // ADR-202 — a pending edit shows a grey "Draft" chip on the header. The
  // dispatch header carries no status badge of its own (status is plain text),
  // so the chip is added beside the title rather than replacing a badge.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  const [previewHeight, setPreviewHeight] = useState(1123);

  const docHtml = useMemo(
    () =>
      d
        ? `<!DOCTYPE html><html><head><style>${SHEET_STYLE}.no-print{display:none!important}</style></head><body>${dispatchSheetHtml(d, client, company)}</body></html>`
        : '',
    [d, client, company],
  );

  if (eff && !perms.view) return <PageState as="page" state="noaccess" />;
  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !d) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load the dispatch. Try again.'}
      </div>
    );
  }

  const cancelled = d.status === 'cancelled';

  return (
    <div>
      <PageHeader
        title={`Customer Dispatch ${d.code}`}
        icon="🚚"
        subtitle={
          <>
            {d.customer ?? '—'} · SO No.{' '}
            <Link to="/sales-orders/$id" params={{ id: d.salesOrderId }} className="fw-700">
              {d.soCode ? soNoWithInternal(d.soCode, d.soInternalNo) : '—'}
            </Link>{' '}
            · {fmtDate(d.dispatchDate)} · {d.totalQty} pcs
            {cancelled ? ' · Cancelled' : ''}
            {isDraft ? (
              <>
                {' '}
                <span
                  className="badge b-grey"
                  title="An edit to this document is waiting for approval"
                >
                  Draft
                </span>
              </>
            ) : null}
          </>
        }
        backLabel="Back to Customer Dispatch"
        onBack={() => void navigate({ to: '/customer-dispatches' })}
        actions={
          <>
            {perms.edit && !cancelled ? (
              <Link
                to="/customer-dispatches/$id/edit"
                params={{ id: d.id }}
                className="btn btn-ghost"
                title="Edit this dispatch"
              >
                ✏️ Edit
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (!printDispatchChallan(d, client, company)) {
                  window.alert('Allow popups to print.');
                }
              }}
            >
              🖨 Print DC
            </button>
            {!cancelled && d.billedStatus !== 'full' ? (
              <Link
                to="/invoices/new"
                search={{ dispatchId: d.id }}
                className="btn btn-primary"
                title="Raise an invoice against this dispatch"
              >
                🧾 Create Invoice
              </Link>
            ) : null}
          </>
        }
      />

      {/* ADR-202 — edits staged against this dispatch and waiting for approval.
          The challan body is a print preview (an iframe), so the pending-change
          chips live in this compact panel rather than on the printed lines: the
          current value → the proposed value, in amber, per header field and per
          line's Dispatch Qty. Hidden entirely when nothing is pending. */}
      {pendingChanges.length > 0 ? (
        <Panel title="Changes awaiting approval">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {[
              { field: 'dispatchDate', label: 'Dispatch Date' },
              { field: 'transport', label: 'Transporter' },
              { field: 'vehicleNo', label: 'Vehicle No.' },
              { field: 'remarks', label: 'Remarks' },
            ].map(({ field, label }) => {
              const c = headerPendingChange(pendingChanges, field);
              if (!c) return null;
              return (
                <div key={field}>
                  <span className="text3">{label}:</span>{' '}
                  <span>{c.before == null || c.before === '' ? '—' : String(c.before)}</span>
                  <PendingChangeChip after={c.after} />
                </div>
              );
            })}
            {d.lines.map((l) => {
              const c = linePendingChange(pendingChanges, l.id, 'qty');
              if (!c) return null;
              return (
                <div key={l.id}>
                  <span className="text3">
                    Ln {l.lineNo} · {l.itemName} — Dispatch Qty:
                  </span>{' '}
                  <span className="mono">{l.qty}</span>
                  <PendingChangeChip after={c.after} />
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* Plan v3 Step 4 — the challan below keeps each line's saved Item Name;
          where that differs from the item master, say so here (screen only). */}
      {d.lines.some((l) => l.masterItemName && l.masterItemName.trim() !== l.itemName.trim()) ? (
        <div style={{ maxWidth: 860, margin: '0 auto 10px' }}>
          {d.lines.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              {l.masterItemName && l.masterItemName.trim() !== l.itemName.trim() ? (
                <>
                  <span className="text3" style={{ fontSize: 11 }}>
                    Ln {l.lineNo} · {l.itemName} —
                  </span>
                  <MasterItemNameNote lineName={l.itemName} masterItemName={l.masterItemName} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* A4-portrait paper preview — identical markup to the print output. */}
      <iframe
        title={`Delivery Challan ${d.code} preview`}
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

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Dispatch" entityId={d.id} refId={d.code} />
      </Panel>
    </div>
  );
}
