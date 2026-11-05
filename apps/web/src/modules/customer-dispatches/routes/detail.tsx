// Customer Dispatch — one dispatch as a record: what went, on which SO, and
// the Delivery Challan that travels with the truck (Preview / Download PDF). Save on
// /customer-dispatches/new lands here, so the DC can be printed and the
// invoice raised without hunting for the new DSP on the list.
//
// The page body IS the challan: the same Innovic Sheet markup the print window
// emits, previewed in an iframe (screen = print, as on the invoice detail).

import { Icon } from '@/ui/core';
import { itemRevLabel } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { useHistoryTab } from '@/components/shared/document-history';
import { MasterItemNameNote } from '@/components/shared/master-item-name-note';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
  linePendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { docDrawingRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { runPrint } from '@/lib/print/preview-host';
import { SHEET_STYLE } from '@/lib/print/sheet-print';
import { useClient } from '@/modules/clients/api';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { TabStrip } from '@/ui/navigation';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { ActionMenu, DetailHeader, PageState } from '@/ui/layout';
import { useDispatchDetail } from '../api';
import { dispatchSheetHtml, printDispatchChallan } from '../lib/print-dc';

export const customerDispatchDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/$id',
  component: CustomerDispatchDetailPage,
});

function CustomerDispatchDetailPage(): React.JSX.Element {
  const { id } = customerDispatchDetailRoute.useParams();
  const { data: d, isLoading, isError, error } = useDispatchDetail(id);
  const { data: client } = useClient(d?.clientId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  // ADR-202 — the edit(s) staged against this dispatch, still awaiting a
  // decision. Their per-field changes drive the inline amber chips below.
  const pendingEdit = usePendingEditForDoc('Dispatch', id);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-202 — a pending edit shows a grey "Draft" chip on the header. The
  // dispatch header carries no status badge of its own (status is plain text),
  // so the chip is added beside the title rather than replacing a badge.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  const [previewHeight, setPreviewHeight] = useState(1123);
  const [cancelOpen, setCancelOpen] = useState(false);
  // ADR-197 — who did what to this dispatch. Before the early returns (hooks rule).
  const historyTab = useHistoryTab({ entity: 'Dispatch', entityId: d?.id, refId: d?.code });

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
  // ADR-235 — the ONE standard Cancel: Edit requests, Approve decides.
  const canCancel = (perms.edit || perms.approve) && !cancelled;

  return (
    <div>
      <DetailHeader
        backTo="/customer-dispatches"
        backLabel="Back to Customer Dispatch"
        renderLink={(p) => <Link {...p} />}
        code={d.code}
        name="🚚 Customer Dispatch"
        badges={
          <>
            {cancelled ? <span className="badge b-red">Cancelled</span> : null}
            {isDraft ? (
              <span
                className="badge b-grey"
                title="An edit to this document is waiting for approval"
              >
                Draft
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <ActionMenu
              items={[
                { label: 'Preview', onClick: () => printDispatchChallan(d, client, company) },
                {
                  label: 'Download PDF',
                  icon: 'download',
                  onClick: () =>
                    void runPrint('download', { title: 'Delivery Challan', fileName: d.code }, () =>
                      Promise.resolve(() => printDispatchChallan(d, client, company)),
                    ),
                },
              ]}
            />
            {perms.edit && !cancelled ? (
              <Link
                to="/customer-dispatches/$id/edit"
                params={{ id: d.id }}
                className="btn btn-ghost"
                title="Edit this dispatch"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            {/* ADR-234 — shown only to an Invoice Entry holder. */}
            {!cancelled && d.billedStatus !== 'full' ? (
              <ActionLink
                to="/invoices/new"
                search={{ dispatchId: d.id }}
                className="btn btn-primary"
                title="Raise an invoice against this dispatch"
              >
                🧾 Create Invoice
              </ActionLink>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: 'var(--red2)' }}
                onClick={() => setCancelOpen(true)}
              >
                Cancel Dispatch
              </button>
            ) : null}
          </>
        }
      >
        <ClusterGrid stack>
          <Cluster name="Dispatch">
            <ClusterFact
              label="Customer"
              empty={!d.customer}
              title={d.customer ?? undefined}
              value={d.customer ?? '—'}
            />
            <ClusterFact
              num
              label="SO No."
              value={
                <Link to="/sales-orders/$id" params={{ id: d.salesOrderId }} className="fw-700">
                  {d.soCode ? soNoWithInternal(d.soCode, d.soInternalNo) : '—'}
                </Link>
              }
            />
            <ClusterFact num label="Dispatch Date" value={fmtDate(d.dispatchDate)} />
            <ClusterFact num label="Total Qty" value={`${d.totalQty} pcs`} />
          </Cluster>
          {/* The Item + Drawing Rev each line SHIPPED (ABC/1), linked to its drawing
              page — the challan below is a print preview and cannot carry links.
              Only lines saved with a register Rev are listed. */}
          {d.lines.some((l) => l.itemRevisionId) ? (
            <Cluster name="Shipped">
              <ClusterFact
                span={4}
                wrap
                label="Drawing Rev shipped"
                value={d.lines
                  .filter((l) => l.itemRevisionId)
                  .map((l, i) => (
                    <span key={l.id}>
                      {i > 0 ? ' · ' : null}
                      <span className="text3">Ln {l.lineNo}</span>{' '}
                      <ItemRevLink
                        itemRevisionId={l.itemRevisionId}
                        label={itemRevLabel(l.itemCode ?? l.itemCodeText, docDrawingRev(l))}
                      />
                    </span>
                  ))}
              />
            </Cluster>
          ) : null}
        </ClusterGrid>
      </DetailHeader>

      <CancelPendingBanner
        docType="customer_dispatch"
        docId={d.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      {cancelled ? (
        <div className="mb-2">
          <Banner tone="error" accent title="Cancelled — this dispatch was reversed">
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              {d.cancelReason
                ? `Reason: ${d.cancelReason}${d.cancelledAt ? ` · ${fmtDateTime(d.cancelledAt)}` : ''}. `
                : ''}
              Its stock went back to the store. Who cancelled it is in History below.
            </div>
          </Banner>
        </div>
      ) : null}

      {/* ADR-202 — edits staged against this dispatch and waiting for approval.
          The challan body is a print preview (an iframe), so the pending-change
          chips live in this compact panel rather than on the printed lines: the
          current value → the proposed value, in amber, per header field and per
          line's Dispatch Qty. Hidden entirely when nothing is pending. */}
      {pendingChanges.length > 0 ? (
        <Panel title="Changes awaiting approval">
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)' }}
          >
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
                  <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
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
          borderRadius: 'var(--radius-sm)',
        }}
      />

      {/* No /related endpoint on a dispatch, so History sits in the shared TabStrip. */}
      <Panel>
        <TabStrip
          tabs={[
            {
              key: historyTab.key,
              label: `${historyTab.icon} ${historyTab.title}`,
              count: historyTab.count,
            },
          ]}
          activeKey={historyTab.key}
          label="Dispatch tabs"
        />
        {historyTab.render()}
      </Panel>

      {cancelOpen ? (
        <CancelDocDialog
          docType="customer_dispatch"
          docId={d.id}
          docCode={d.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </div>
  );
}
