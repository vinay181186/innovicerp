// JW DC outward detail page (Print Templates P2, ADR-034). A full-page view of
// a single outward DC (returnable gate pass).
//
// Legacy counterpart: `_jwdcViewOut` (L24592-24609) — the 👁 row action on the
// outward register (L24474), shown there as a `showModalLg` modal; this port
// makes it a dedicated route. Field order/labels and the line table follow that
// modal. NOT `_jwdcPrint` (L24611): the DC No. cell (L24463) and the 🖨 action
// (L24473) both hop straight to the print window, not to a detail view — that
// print is reached here via the Print button, which consumes the `jwdc_*`
// templates. `renderJWDC` (L24434) is the LIST (router key `jwdc`, L2412).
//
// Returned/Pending columns + the status label are additions over the legacy
// modal, carried over from the legacy register's own columns (L24469-24471).

import type { JwDcOutwardDetail } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Ban, Download, Eye, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { itemCodeWithRev } from '@/lib/item-code';
import { runPrint } from '@/lib/print/preview-host';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { usePrintTemplates } from '../../print-templates/api';
import { useMyCompany } from '../../settings/api';
import { useVendor } from '../../vendors/api';
import { useJwDcOutwardDetail } from '../api';
import { isJwDcCancelled } from '../components/outward-columns';
import { printJwDc } from '../lib/print-jwdc';

export const jwDcOutwardDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-dc/$id',
  component: JwDcOutwardDetailPage,
});

function JwDcOutwardDetailPage(): React.JSX.Element {
  const { id } = jwDcOutwardDetailRoute.useParams();
  const { data: dc, isLoading, isError, error } = useJwDcOutwardDetail(id);
  const { data: me } = useSession();
  const { data: vendor } = useVendor(dc?.vendorId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: templates } = usePrintTemplates();
  const [printBlocked, setPrintBlocked] = useState(false);
  // ADR-235 — the ONE standard Cancel (docType 'jw_dc_outward', page ospdc_create):
  // Edit sends a Cancel Request, Approve decides it.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading JW DC…
      </div>
    );
  }
  if (isError || !dc) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/jw-dc" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'JW DC not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  const printArgs = {
    dc,
    vendor,
    company,
    templates: templates?.items ?? [],
    currentUser: me?.email,
  };
  // Preview: the print now opens the in-app Preview box.
  const onPrint = (): void => {
    const ok = printJwDc(printArgs);
    setPrintBlocked(!ok);
  };
  const onDownload = (): Promise<void> =>
    runPrint(
      'download',
      { title: 'JW Delivery Challan', fileName: dc.code },
      async () => () => printJwDc(printArgs),
    );

  const cancelled = isJwDcCancelled(dc);
  const canCancel = !cancelled && (perms.edit || perms.approve);

  // Returned = done (green); Partly Returned / At Vendor = under way (amber).
  // A Cancelled DC reads Cancelled (red) instead.
  const statusClass = cancelled
    ? 'b-red'
    : dc.returnStatus === 'fully_returned'
      ? 'b-green'
      : 'b-amber';
  const statusLabel = cancelled
    ? 'Cancelled'
    : dc.returnStatus === 'fully_returned'
      ? 'Returned'
      : dc.returnStatus === 'partial'
        ? 'Partly Returned'
        : 'At Vendor';

  return (
    <div>
      <Link to="/jw-dc" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to JW Delivery Challans
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--purple)', fontSize: 16, fontWeight: 800 }}
            >
              {dc.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? '—'}
              <span className={`badge ${statusClass}`}>{statusLabel}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Eye size={13} /> Preview
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void onDownload()}
            >
              <Download size={13} /> Download PDF
            </button>
            {canCancel ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setCancelOpen(true)}
              >
                <Ban size={13} /> Cancel JW DC
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {printBlocked ? (
            <Banner tone="error" role="alert">
              Could not open the print window. Allow pop-ups for this site and try again.
            </Banner>
          ) : null}
          <DetailGrid dc={dc} />
        </div>
      </div>

      {/* ADR-235 — an open Cancel Request (orange), or the Cancelled mark (red). */}
      <CancelPendingBanner
        docType="jw_dc_outward"
        docId={dc.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      {cancelled ? (
        <div className="mb-2">
          <Banner tone="error" accent title="Cancelled — this JW DC is void">
            <div>
              Reason: <b>{dc.cancelReason ?? '—'}</b>
              {dc.cancelledAt ? ` · ${fmtDateTime(dc.cancelledAt)}` : ''}
            </div>
          </Banner>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line Items ({dc.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            Sent <b style={{ color: 'var(--text)' }}>{dc.totalSentQty}</b> · Received{' '}
            <b style={{ color: 'var(--green2)' }}>{dc.totalReturnedQty}</b> · Pending{' '}
            <b style={{ color: dc.pendingQty > 0 ? 'var(--red)' : 'var(--green)' }}>
              {dc.pendingQty}
            </b>
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Ln</th>
                {/* POL — the CUSTOMER's own purchase-order line number off the
                    SO line behind this challan line; an em dash on a purely
                    job-work line, which has no sales order behind it. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Process</th>
                <th className="th-num">PO Qty</th>
                <th className="th-num">Sent</th>
                <th className="th-num">Received</th>
                <th className="th-num">Pending</th>
              </tr>
            </thead>
            <tbody>
              {dc.lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No lines on this DC.
                  </td>
                </tr>
              ) : (
                dc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.lineNo}</td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}
                    </td>
                    <td>{l.itemName ?? l.itemNameText ?? '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{l.processText ?? '—'}</td>
                    <td className="mono td-num">{l.poQty}</td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--cyan)' }}>
                      {l.sentQty}
                    </td>
                    <td className="mono td-num" style={{ color: 'var(--green2)' }}>
                      {l.alreadyReturned}
                    </td>
                    <td
                      className="mono fw-700 td-num"
                      style={{ color: l.pending > 0 ? 'var(--red)' : 'var(--green)' }}
                    >
                      {l.pending}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Legacy renders Remarks below the line table (L24608), not in the
            info block. */}
        {dc.remarks ? (
          <div className="panel-body text3" style={{ fontSize: 11 }}>
            Remarks: {dc.remarks}
          </div>
        ) : null}
      </div>

      <RelatedDocsPanel module="jw-dc" id={dc.id} />

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="JwDcOutward" entityId={dc.id} refId={dc.code} />
      </Panel>

      {cancelOpen ? (
        <CancelDocDialog
          docType="jw_dc_outward"
          docId={dc.id}
          docCode={dc.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </div>
  );
}

// Field order + labels mirror legacy `_jwdcViewOut`'s info block (L24599-24606):
// DC No. / DC Date / PO No. / Vendor / Total Sent / Vehicle No.
function DetailGrid(props: { dc: JwDcOutwardDetail }): React.JSX.Element {
  const { dc } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="DC No." value={dc.code} />
      <Pair label="DC Date" value={fmtDate(dc.dcDate)} />
      <Pair label="PO No." value={dc.jwpoCodeText ?? '—'} />
      <Pair label="SO No." value={dc.soCode ?? '—'} />
      <Pair label="Vendor" value={dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? '—'} />
      <Pair label="Total Sent" value={`${dc.totalSentQty} pcs`} />
      <Pair label="Vehicle No." value={dc.vehicleNo ?? '—'} />
    </div>
  );
}

function Pair(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
