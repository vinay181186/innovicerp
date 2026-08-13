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

import type { DeliveryChallanLine, DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Ban, Inbox, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates } from '../../print-templates/api';
import { useMyCompany } from '../../settings/api';
import { useVendor } from '../../vendors/api';
import { useCancelDeliveryChallan, useDeliveryChallan } from '../api';
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
  const { id } = deliveryChallanDetailRoute.useParams();
  const { data, isLoading, isError, error } = useDeliveryChallan(id);
  const { data: me } = useSession();
  const { data: vendor } = useVendor(data?.vendorId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: templates } = usePrintTemplates();
  const cancel = useCancelDeliveryChallan();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const aggregatesByLine = useMemo(() => {
    const map = new Map<string, LineAgg>();
    if (!data) return map;
    for (const r of data.receipts) {
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
      <div className="panel empty-state" style={{ padding: 24 }}>
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading DC…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/delivery-challans" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'DC not found'}
          </div>
        </div>
      </div>
    );
  }

  const dc = data;
  const canReceive = dc.status === 'issued';
  const canCancel = dc.status === 'issued' && me?.role === 'admin';

  const onCancel = async (): Promise<void> => {
    setCancelError(null);
    try {
      await cancel.mutateAsync(dc.id);
      setConfirmCancel(false);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Failed to cancel DC.');
    }
  };

  const onPrint = (): void => {
    const ok = printOspDc({
      dc,
      vendor,
      company,
      templates: templates?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
  };

  return (
    <div>
      <Link to="/delivery-challans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Delivery Challans
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            {/* --blue, not --cyan: blue is the app's identity/link colour for a
                document code (SO detail, PR, JWSO, and the DC list card all use
                it). This page was the last one left on the old teal, so opening
                a DC from the list changed the colour of its own number. */}
            <div className="td-code" style={{ color: 'var(--blue)', fontSize: 16, fontWeight: 700 }}>
              {dc.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {dc.vendorName ?? dc.vendorCodeText}
              <DcStatusBadge status={dc.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Printer size={13} /> Print
            </button>
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
              confirmCancel ? (
                <>
                  <span className="text3" style={{ fontSize: 12 }}>
                    Cancel DC?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void onCancel()}
                    disabled={cancel.isPending}
                  >
                    {cancel.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Ban size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmCancel(false)}
                    disabled={cancel.isPending}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmCancel(true)}
                >
                  <Ban size={13} /> Cancel DC
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {cancelError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid var(--red)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {cancelError}
            </div>
          ) : null}
          <HeaderGrid dc={dc} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Lines</div>
          <span className="text3" style={{ fontSize: 11 }}>
            {dc.lines.length} line{dc.lines.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="panel-body">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Ship qty</th>
                  <th>Received</th>
                  <th>Rejected</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {dc.lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No lines
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
                        <td className="mono">{line.lineNo}</td>
                        <td>
                          <span className="mono">{line.itemCode ?? line.itemCodeText ?? '—'}</span>
                          {line.itemName ?? line.itemNameText ? (
                            <span className="text3" style={{ marginLeft: 6 }}>
                              {line.itemName ?? line.itemNameText}
                            </span>
                          ) : null}
                        </td>
                        <td className="mono fw-700">{ship.toFixed(2)}</td>
                        <td className="mono" style={{ color: 'var(--green2)' }}>
                          {received.toFixed(2)}
                        </td>
                        <td className="mono" style={{ color: 'var(--red2)' }}>
                          {rejected.toFixed(2)}
                        </td>
                        <td className="mono">{remaining.toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {dc.lines.length > 0 ? (
                <tfoot>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <td colSpan={2} style={{ textAlign: 'left', fontWeight: 700 }}>
                      Total
                    </td>
                    <td className="mono fw-700">{totals.ship.toFixed(2)}</td>
                    <td className="mono fw-700" style={{ color: 'var(--green2)' }}>
                      {totals.received.toFixed(2)}
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--red2)' }}>
                      {totals.rejected.toFixed(2)}
                    </td>
                    <td className="mono fw-700">{totals.remaining.toFixed(2)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </div>

      <DcReceiptsPanel receipts={dc.receipts} lineLookup={lineLookup} />

      <RelatedDocsPanel module="delivery-challans" id={dc.id} />
    </div>
  );
}

/** Format a stored UTC timestamp as IST date + time — same helper the SO detail
 *  page uses (CLAUDE.md §6 rule 5: stored UTC, displayed IST). */
function fmtIstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function HeaderGrid(props: { dc: DeliveryChallanWithLines }): React.JSX.Element {
  const { dc } = props;
  // `form-grid form-grid-3` stacked a 2-col and a 3-col grid on one element and
  // left an empty `.form-grp` filler in the last cell. One grid class, and the
  // sixth cell carries "Issued on" instead of a blank — no orphan cells.
  return (
    <div className="form-grid-3">
      <Pair label="DC date" value={dc.dcDate} />
      <Pair label="Vendor" value={dc.vendorName ?? dc.vendorCodeText} />
      <Pair
        label="PO"
        value={
          dc.poCode ? (
            <span className="badge b-green">{dc.poCode}</span>
          ) : dc.poCodeText ? (
            <span className="badge b-amber" title="Snapshot text — no live PO linked">
              {dc.poCodeText}*
            </span>
          ) : (
            '—'
          )
        }
      />
      <Pair label="SO" value={dc.soCode ?? dc.soRefText ?? '—'} />
      <Pair label="Transport" value={dc.transport ?? '—'} />
      <Pair
        label="Issued on"
        value={<span className="mono" style={{ fontSize: 12 }}>{fmtIstDateTime(dc.createdAt)}</span>}
      />
    </div>
  );
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
