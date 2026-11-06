// Delivery-challan detail (UI-003-06) — the OSP Outward DC.
//
// Styling pass 2026-08-13 against the SO Master detail page. Presentation only;
// no data, mutation or API change. Fixed: the bare "Loading DC…" line (now the
// `.panel.empty-state` chain), a hard-coded `#fca5a5` error border (→
// `var(--red)`), `1px solid var(--line)` on the receipt separators (`--line` is
// not a token, so the browser dropped the declaration and the receipts ran
// together), `form-grid form-grid-3` stacked on one element with an empty
// filler cell (→ one `.form-grid-3`, sixth cell now "Issued on" in IST), the
// receipts' nested table missing its `.tbl-wrap`, and receipt rows showing only
// the item snapshot while the lines table showed the live master name. Added a
// totals row to the lines table. Receipts moved to components/dc-receipts-panel
// to stay under the 400-line rule.

import { Icon } from '@/ui/core';
import type { DeliveryChallanLine, DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Ban, Inbox, Loader2 } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useHistoryTab } from '@/components/shared/document-history';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
  linePendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtQty } from '@/lib/qty-format';
import { soNoWithInternal } from '@/lib/so-number';
import { runPrint } from '@/lib/print/preview-host';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, useToast } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid, DocIdent } from '@/ui/forms';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { usePrintTemplates } from '../../print-templates/api';
import { useMyCompany } from '../../settings/api';
import { useVendor } from '../../vendors/api';
import { useDeliveryChallan } from '../api';
import { dcNcs } from '../lib/dc-ncs';
import { DcReceiptsPanel } from '../components/dc-receipts-panel';
import { DcStatusBadge } from '../components/dc-status-badge';
import { printOspDc } from '../lib/print-ospdc';

export const deliveryChallanDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id',
  component: DeliveryChallanDetailPage,
});

interface LineAgg {
  receivedQty: number;
  rejectedQty: number;
}

function DeliveryChallanDetailPage(): React.JSX.Element {
  const toast = useToast();
  const { id } = deliveryChallanDetailRoute.useParams();
  const { data, isLoading, isError, error } = useDeliveryChallan(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const { data: vendor } = useVendor(data?.vendorId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: templates } = usePrintTemplates();
  // ADR-202 — the edit(s) staged against this DC, still awaiting a decision.
  // Their per-field changes drive the "Changes awaiting approval" panel below.
  const pendingEdit = usePendingEditForDoc('DeliveryChallan', id);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-202 — any pending edit overlays grey "Draft" on the status chip.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  // ADR-235 — the ONE standard Cancel dialog (reason, request / approve).
  const [cancelOpen, setCancelOpen] = useState(false);
  // ADR-235 — the receipt whose Cancel dialog is open (docType 'dc_receipt').
  const [cancelReceipt, setCancelReceipt] = useState<{ id: string; code: string } | null>(null);
  // ADR-197 — who did what to this DC. Before the early returns (hooks rule).
  const historyTab = useHistoryTab({
    entity: 'DeliveryChallan',
    entityId: data?.id,
    refId: data?.code,
  });

  const aggregatesByLine = useMemo(() => {
    const map = new Map<string, LineAgg>();
    if (!data) return map;
    for (const r of data.receipts) {
      // ADR-235 — a Cancelled receipt booked nothing back any more.
      if (r.cancelledAt) continue;
      for (const rl of r.lines) {
        const cur = map.get(rl.deliveryChallanLineId) ?? { receivedQty: 0, rejectedQty: 0 };
        cur.receivedQty += Number(rl.receivedQty);
        cur.rejectedQty += Number(rl.rejectedQty);
        map.set(rl.deliveryChallanLineId, cur);
      }
    }
    return map;
  }, [data]);

  // Column totals for the lines table's footer — the same four numbers each row
  // shows, so the DC can be reconciled without adding them up by hand.
  const totals = useMemo(() => {
    const t = { ship: 0, received: 0, rejected: 0, remaining: 0 };
    if (!data) return t;
    for (const line of data.lines) {
      const ship = Number(line.qty);
      const agg = aggregatesByLine.get(line.id);
      const received = agg?.receivedQty ?? 0;
      const rejected = agg?.rejectedQty ?? 0;
      t.ship += ship;
      t.received += received;
      t.rejected += rejected;
      t.remaining += Math.max(0, ship - received - rejected);
    }
    return t;
  }, [data, aggregatesByLine]);

  const lineLookup = useMemo(() => {
    const m = new Map<string, DeliveryChallanLine>();
    if (!data) return m;
    for (const l of data.lines) m.set(l.id, l);
    return m;
  }, [data]);

  if (isLoading) {
    // Same loading / error / empty chain as the SO Master pages — a bare
    // sentence with no panel around it read as a broken page.
    return (
      <div className="panel empty-state" style={{ padding: 'var(--sp-5)' }}>
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading DC…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <Link to="/delivery-challans" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'DC not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view DCs. Ask an admin.
      </div>
    );
  }

  const dc = data;
  // Every NC this return DC carries (one DC may hold several NCs of one SO).
  // Empty on an ordinary OSP DC; `dc.ncId` stays the is-return flag.
  const ncs = dcNcs(dc);
  // Tier-driven, per department (ospdc_create sits in Purchase).
  //   Receive -> entry. It had NO role gate at all, so an L1 Viewer was shown
  //              the button and only found out at the API. Status condition kept.
  //   Cancel DC -> Edit OR Approve (ADR-235, the ONE standard Cancel): Edit
  //              sends a Cancel Request, Approve decides it. The dialog reads
  //              the server's preview — what blocks it (receipts, GRNs made from
  //              it) and which button this user may press.
  // ADR-234 — Receive opens /delivery-challans/$id/receive, whose route and
  // API accept OSP DC Entry OR GRN Entry; the list ⋯ already does this.
  const canReceive =
    dc.status === 'issued' && (perms.entry || effectiveFormPerms(eff, 'grn_create').entry);
  const cancelled = dc.status === 'cancelled';
  const canCancel = !cancelled && (perms.edit || perms.approve);
  // Cancel Receipt -> the same Edit OR Approve on OSP DC (ADR-235); the server
  // preview decides what blocks it (a GRN / QC made from the receipt).
  const canCancelReceipt = perms.edit || perms.approve;
  // Edit (ADR-202) -> edit, only while the DC is still issued and nothing has
  // been received against it (receiving freezes the quantities). The server
  // re-checks the same guard; the edit screen does too.
  const canEdit =
    dc.status === 'issued' && dc.receipts.every((r) => r.cancelledAt != null) && perms.edit;

  const printArgs = {
    dc,
    vendor,
    company,
    templates: templates?.items ?? [],
    currentUser: me?.email,
    draft: isDraft,
    cancelled,
  };
  // Preview: the print now opens the in-app Preview box.
  const onPrint = (): void => {
    const ok = printOspDc(printArgs);
    if (!ok) toast.error('Allow popups to print.');
  };
  const onDownload = (): Promise<void> =>
    runPrint(
      'download',
      { title: 'OSP Delivery Challan', fileName: dc.code },
      async () => () => printOspDc(printArgs),
    );

  return (
    <div>
      <DetailHeader
        backTo="/delivery-challans"
        backLabel="Back to Delivery Challans"
        renderLink={(p) => <Link {...p} />}
        code={dc.code}
        name={dc.vendorName ?? dc.vendorCodeText}
        badges={<DcStatusBadge status={dc.status} draft={isDraft} />}
        actions={
          <>
            <ActionMenu
              items={[
                { label: 'Preview', onClick: onPrint },
                { label: 'Download PDF', icon: 'download', onClick: () => void onDownload() },
              ]}
            />
            {canEdit ? (
              <Link
                to="/delivery-challans/$id/edit"
                params={{ id: dc.id }}
                className="btn btn-ghost btn-sm"
                title="Edit this DC"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            {canReceive ? (
              <Link
                to="/delivery-challans/$id/receive"
                params={{ id: dc.id }}
                className="btn btn-primary btn-sm"
              >
                <Inbox size={13} /> Receive
              </Link>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setCancelOpen(true)}
              >
                <Ban size={13} /> Cancel DC
              </button>
            ) : null}
          </>
        }
      >
        {/* Return-to-vendor challan raised from an NC (design §5): say so, with
            the NC and the job card one click away — the receive step books the
            replacement against that NC, so the reader must not mistake this for
            an ordinary OSP outward DC. */}
        {dc.ncId ? (
          <DocIdent>
            <div
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--amber2)',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span>↩ Return to vendor —</span>
              {/* Every NC on this DC (one DC may hold several NCs of one SO). */}
              <span>{ncs.length === 1 ? 'NC' : 'NCs'}</span>
              {ncs.map((n, i) => (
                <Fragment key={n.id}>
                  {i > 0 ? <span>,</span> : null}
                  <Link to="/nc-register/$id" params={{ id: n.id }} className="td-code">
                    {n.code}
                  </Link>
                </Fragment>
              ))}
              {/* The header job card is the FIRST NC's — shown only when the
                  DC carries one NC, so it is never read as all of them. */}
              {dc.jobCardId && ncs.length === 1 ? (
                <>
                  <span>· JC</span>
                  <Link to="/job-cards/$id" params={{ id: dc.jobCardId }} className="td-code">
                    {dc.jobCardCode ?? '—'}
                  </Link>
                </>
              ) : null}
              {dc.reason ? (
                <span style={{ color: 'var(--text2)', fontWeight: 400 }}>· {dc.reason}</span>
              ) : null}
            </div>
          </DocIdent>
        ) : null}
        <HeaderGrid dc={dc} />
      </DetailHeader>

      {/* ADR-235 — an open Cancel Request (orange), or the Cancelled mark (red). */}
      <CancelPendingBanner
        docType="delivery_challan"
        docId={dc.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      {cancelled ? (
        <div className="mb-2">
          <Banner tone="error" accent title="Cancelled — this DC is void">
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              Nothing more can be received against it. The reason, who cancelled it and when are in
              History below.
            </div>
          </Banner>
        </div>
      ) : null}

      {/* ADR-202 — edits staged against this DC and waiting for approval. The
          lines table below has no Material / DC Remarks columns to host inline
          chips, so every pending change (header travel fields + each line's
          Challan Qty / Material / Remarks) is shown here as current → proposed in
          amber. Hidden entirely when nothing is pending. */}
      {pendingChanges.length > 0 ? (
        <Panel title="Changes awaiting approval">
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)' }}
          >
            {[
              { field: 'dcDate', label: 'DC Date' },
              { field: 'transport', label: 'Transporter' },
              { field: 'vehicleNo', label: 'Vehicle No.' },
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
            {dc.lines.flatMap((l) => {
              const name = l.itemName ?? l.itemNameText ?? l.itemCodeText;
              const rows: React.ReactNode[] = [];
              const qtyC = linePendingChange(pendingChanges, l.id, 'qty');
              if (qtyC) {
                rows.push(
                  <div key={`${l.id}-qty`}>
                    <span className="text3">
                      Ln {l.lineNo} · {name} — Challan Qty:
                    </span>{' '}
                    <span className="mono">{Number(l.qty)}</span>
                    <PendingChangeChip after={qtyC.after} />
                  </div>,
                );
              }
              const matC = linePendingChange(pendingChanges, l.id, 'material');
              if (matC) {
                rows.push(
                  <div key={`${l.id}-material`}>
                    <span className="text3">Ln {l.lineNo} — Material:</span>{' '}
                    <span>
                      {l.materialText == null || l.materialText === '' ? '—' : l.materialText}
                    </span>
                    <PendingChangeChip after={matC.after} />
                  </div>,
                );
              }
              const remC = linePendingChange(pendingChanges, l.id, 'remarks');
              if (remC) {
                rows.push(
                  <div key={`${l.id}-remarks`}>
                    <span className="text3">Ln {l.lineNo} — Remarks:</span>{' '}
                    <span>{l.dcRemarks == null || l.dcRemarks === '' ? '—' : l.dcRemarks}</span>
                    <PendingChangeChip after={remC.after} />
                  </div>,
                );
              }
              return rows;
            })}
          </div>
        </Panel>
      ) : null}

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Lines</div>
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            {dc.lines.length} line{dc.lines.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="panel-body">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th className="th-ctr">Ln</th>
                  {/* A return DC carries one NC per line. */}
                  {dc.ncId ? <th>NC No.</th> : null}
                  {/* Each return line's own JW PO — NCs of one SO may come
                      from different JW POs. */}
                  {dc.ncId ? <th>PO No.</th> : null}
                  {/* POL = the CUSTOMER's own PO line number off the SO line
                      behind this challan line. */}
                  <th className="th-ctr" style={{ color: 'var(--purple)' }}>
                    POL
                  </th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th className="th-num">Sent</th>
                  <th className="th-num">Received</th>
                  <th className="th-num">Deviated</th>
                  <th className="th-num">Pending</th>
                </tr>
              </thead>
              <tbody>
                {dc.lines.length === 0 ? (
                  <tr>
                    <td colSpan={dc.ncId ? 10 : 8} className="empty-state">
                      No lines yet.
                    </td>
                  </tr>
                ) : (
                  dc.lines.map((line) => {
                    const ship = Number(line.qty);
                    const agg = aggregatesByLine.get(line.id);
                    const received = agg?.receivedQty ?? 0;
                    const rejected = agg?.rejectedQty ?? 0;
                    const remaining = Math.max(0, ship - received - rejected);
                    return (
                      <tr key={line.id}>
                        <td className="td-ctr mono">{line.lineNo}</td>
                        {dc.ncId ? (
                          <td className="mono fw-700">
                            {line.ncId ? (
                              <Link
                                to="/nc-register/$id"
                                params={{ id: line.ncId }}
                                className="td-code"
                              >
                                {line.ncCode ?? '—'}
                              </Link>
                            ) : (
                              // A DC raised before 0237: its one line is the header NC.
                              (ncs[0]?.code ?? '—')
                            )}
                          </td>
                        ) : null}
                        {dc.ncId ? (
                          <td className="mono">{line.poCode ?? dc.poCode ?? '—'}</td>
                        ) : null}
                        {/* POL — the customer's PO line number off the SO line
                            behind this row; '—' on a raw-material line. */}
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
                          {line.clientPoLineNo ?? '—'}
                        </td>
                        {/* SO document format: the code is its own strong-mono
                            column (td-code, var(--text)) and the name a second
                            column beside it. The drawing revision joins the code
                            only on a line the API could prove IS the customer's
                            part — an OSP line going out for a process. A
                            raw-material or bought-in line has no revision here
                            and stays bare; the SO's revision is on the header. */}
                        <td className="td-code" style={{ color: 'var(--text)' }}>
                          {itemCodeWithRev(line.itemCode ?? line.itemCodeText, line.itemRevision)}
                        </td>
                        <td>{line.itemName ?? line.itemNameText ?? '—'}</td>
                        <td className="mono fw-700 td-num">{fmtQty(ship)}</td>
                        <td className="mono td-num" style={{ color: 'var(--green2)' }}>
                          {fmtQty(received)}
                        </td>
                        <td className="mono td-num" style={{ color: 'var(--red2)' }}>
                          {fmtQty(rejected)}
                        </td>
                        <td className="mono td-num">{fmtQty(remaining)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {dc.lines.length > 0 ? (
                <tfoot>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <td colSpan={dc.ncId ? 6 : 4} style={{ fontWeight: 700 }}>
                      Total
                    </td>
                    <td className="mono fw-700 td-num">{fmtQty(totals.ship)}</td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                      {fmtQty(totals.received)}
                    </td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--red2)' }}>
                      {fmtQty(totals.rejected)}
                    </td>
                    <td className="mono fw-700 td-num">{fmtQty(totals.remaining)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </div>

      <DcReceiptsPanel
        receipts={dc.receipts}
        lineLookup={lineLookup}
        onCancel={
          // A return-to-vendor replacement receipt cannot be cancelled yet.
          canCancelReceipt && !dc.ncId
            ? (r) => setCancelReceipt({ id: r.id, code: r.receiptCode })
            : undefined
        }
      />

      <RelatedDocsTabs module="delivery-challans" id={dc.id} extraTabs={[historyTab]} />

      {cancelOpen ? (
        <CancelDocDialog
          docType="delivery_challan"
          docId={dc.id}
          docCode={dc.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
      {cancelReceipt ? (
        <CancelDocDialog
          docType="dc_receipt"
          docId={cancelReceipt.id}
          docCode={cancelReceipt.code}
          onClose={() => setCancelReceipt(null)}
        />
      ) : null}
    </div>
  );
}

function HeaderGrid(props: { dc: DeliveryChallanWithLines }): React.JSX.Element {
  const { dc } = props;
  const vendorName = dc.vendorName ?? dc.vendorCodeText;
  return (
    <ClusterGrid stack>
      <Cluster name="Against">
        <ClusterFact num label="DC Date" value={fmtDate(dc.dcDate)} />
        {/* An NC challan has no PO: po_code_text carries the NC code (the column
            is NOT NULL), so the same cell is labelled NC and linked to the NC,
            instead of showing that code as an amber "snapshot PO". */}
        {dc.ncId ? (
          // `wrap`: several NCs flow over lines instead of clipping on one.
          <ClusterFact
            wrap
            label="NC No."
            value={
              // Every NC on this return DC, each a link to its NC.
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                {dcNcs(dc).map((n) => (
                  <Link
                    key={n.id}
                    to="/nc-register/$id"
                    params={{ id: n.id }}
                    className="badge b-red"
                  >
                    {n.code}
                  </Link>
                ))}
              </span>
            }
          />
        ) : (
          <ClusterFact
            label="PO No."
            empty={!dc.poCode && !dc.poCodeText}
            value={
              dc.poCode ? (
                <span className="badge b-green">{dc.poCode}</span>
              ) : dc.poCodeText ? (
                <span className="badge b-amber" title="PO No. typed by hand — not linked to a PO">
                  {dc.poCodeText}*
                </span>
              ) : (
                '—'
              )
            }
          />
        )}
        {/* Resolved through the PO's lines when the DC has no SO line of its own,
            which is the normal shape for an OSP/vendor challan. */}
        <ClusterFact
          num
          label="SO No."
          empty={!dc.soCode && !dc.soRefText}
          value={
            dc.soCode || dc.soRefText
              ? soNoWithInternal(dc.soCode ?? dc.soRefText ?? '', dc.soInternalNo)
              : '—'
          }
        />
        {/* Its own labelled field, NOT "IN-SO-0012/B" — a slash after an SO
            number reads as a revision OF THE SALES ORDER, which is not a thing.
            This is the customer's DRAWING revision, so it is said in words. It is
            shown only when there is one; an empty "Rev —" tells nobody anything. */}
        {dc.soLineRevision ? (
          <ClusterFact num label="Drawing Rev" value={dc.soLineRevision} />
        ) : null}
      </Cluster>
      <Cluster name="Transport">
        <ClusterFact label="Vendor" title={vendorName} value={vendorName} />
        <ClusterFact label="Transporter" empty={!dc.transport} value={dc.transport ?? '—'} />
        <ClusterFact num label="Vehicle No." empty={!dc.vehicleNo} value={dc.vehicleNo ?? '—'} />
        <ClusterFact num label="Issued On" value={fmtDateTime(dc.createdAt)} />
      </Cluster>
      {/* Written server-side at create-DC time ("Return to vendor — rework");
          only an NC challan has one, so the row is not shown otherwise. */}
      {dc.ncId && dc.reason ? (
        <Cluster name="Return">
          <ClusterFact span={4} wrap label="Reason" value={dc.reason} />
        </Cluster>
      ) : null}
    </ClusterGrid>
  );
}
