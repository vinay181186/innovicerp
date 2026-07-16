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
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates } from '../../print-templates/api';
import { useMyCompany } from '../../settings/api';
import { useVendor } from '../../vendors/api';
import { useJwDcOutwardDetail } from '../api';
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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'JW DC not found'}
          </div>
        </div>
      </div>
    );
  }

  const onPrint = (): void => {
    const ok = printJwDc({
      dc,
      vendor,
      company,
      templates: templates?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
  };

  const statusColor =
    dc.returnStatus === 'fully_returned'
      ? 'var(--green)'
      : dc.returnStatus === 'partial'
        ? 'var(--cyan)'
        : 'var(--red)';
  const statusLabel =
    dc.returnStatus === 'fully_returned'
      ? 'Fully Returned'
      : dc.returnStatus === 'partial'
        ? 'Partial'
        : 'Out';

  return (
    <div>
      <Link to="/jw-dc" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to JW Delivery Challans
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--purple)', fontSize: 16, fontWeight: 800 }}>
              {dc.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {dc.vendorNameText ?? dc.vendorCodeText ?? '—'}
              <span style={{ fontWeight: 700, color: statusColor, fontSize: 12 }}>{statusLabel}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Printer size={13} /> Print
            </button>
          </div>
        </div>
        <div className="panel-body">
          <DetailGrid dc={dc} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line items ({dc.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            sent <b style={{ color: 'var(--text)' }}>{dc.totalSentQty}</b> · returned{' '}
            <b style={{ color: 'var(--green)' }}>{dc.totalReturnedQty}</b> · pending{' '}
            <b style={{ color: dc.pendingQty > 0 ? 'var(--red)' : 'var(--green)' }}>
              {dc.pendingQty}
            </b>
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Process</th>
                <th className="td-right">PO Qty</th>
                <th className="td-right">Sent</th>
                <th className="td-right">Returned</th>
                <th className="td-right">Pending</th>
              </tr>
            </thead>
            <tbody>
              {dc.lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No lines on this DC.
                  </td>
                </tr>
              ) : (
                dc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.lineNo}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {l.itemCodeText}
                    </td>
                    <td>{l.itemNameText ?? '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>
                      {l.processText ?? '—'}
                    </td>
                    <td className="td-ctr mono">{l.poQty}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {l.sentQty}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {l.alreadyReturned}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
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
    </div>
  );
}

// Field order + labels mirror legacy `_jwdcViewOut`'s info block (L24599-24606):
// DC NO. / DATE / JWPO / VENDOR / TOTAL SENT / VEHICLE. `.form-label` uppercases,
// so these render in legacy's caps.
function DetailGrid(props: { dc: JwDcOutwardDetail }): React.JSX.Element {
  const { dc } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="DC No." value={dc.code} />
      <Pair label="Date" value={dc.dcDate} />
      <Pair label="JWPO" value={dc.jwpoCodeText ?? '—'} />
      <Pair label="Vendor" value={dc.vendorNameText ?? dc.vendorCodeText ?? '—'} />
      <Pair label="Total Sent" value={`${dc.totalSentQty} pcs`} />
      <Pair label="Vehicle" value={dc.vehicleNo ?? '—'} />
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
