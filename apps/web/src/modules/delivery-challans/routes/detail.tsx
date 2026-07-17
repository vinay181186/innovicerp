// Delivery-challan detail (UI-003-06).

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

  const lineLookup = useMemo(() => {
    const m = new Map<string, DeliveryChallanLine>();
    if (!data) return m;
    for (const l of data.lines) m.set(l.id, l);
    return m;
  }, [data]);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading DC…
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
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
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
                border: '1px solid #fca5a5',
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
                  <th className="td-right">Ship qty</th>
                  <th className="td-right">Received</th>
                  <th className="td-right">Rejected</th>
                  <th className="td-right">Remaining</th>
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
                        <td className="td-ctr mono">{line.lineNo}</td>
                        <td>
                          <span className="mono">{line.itemCodeText}</span>
                          {line.itemNameText ? (
                            <span className="text3" style={{ marginLeft: 6 }}>
                              {line.itemNameText}
                            </span>
                          ) : null}
                        </td>
                        <td className="td-right mono fw-700">{ship.toFixed(2)}</td>
                        <td className="td-right mono" style={{ color: 'var(--green2)' }}>
                          {received.toFixed(2)}
                        </td>
                        <td className="td-right mono" style={{ color: 'var(--red2)' }}>
                          {rejected.toFixed(2)}
                        </td>
                        <td className="td-right mono">{remaining.toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {dc.receipts.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Receipts</div>
            <span className="text3" style={{ fontSize: 11 }}>
              {dc.receipts.length} receipt{dc.receipts.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            {dc.receipts.map((rcpt) => (
              <div
                key={rcpt.id}
                style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                >
                  <div style={{ fontSize: 12 }}>
                    <span className="mono">{rcpt.receiptCode}</span>{' '}
                    <span className="text3">· {rcpt.receiptDate}</span>
                    {rcpt.vendorInvoiceText ? (
                      <span className="text3">
                        {' '}
                        · inv <span className="mono">{rcpt.vendorInvoiceText}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="text3" style={{ fontSize: 11 }}>
                    {rcpt.lines.length} line{rcpt.lines.length === 1 ? '' : 's'}
                  </div>
                </div>
                {rcpt.remarks ? (
                  <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>
                    {rcpt.remarks}
                  </div>
                ) : null}
                <table className="innovic-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="td-right">Received</th>
                      <th className="td-right">Rejected</th>
                      <th>Reject reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rcpt.lines.map((rl) => {
                      const ll = lineLookup.get(rl.deliveryChallanLineId);
                      return (
                        <tr key={rl.id}>
                          <td>
                            <span className="mono">{ll?.itemCodeText ?? '—'}</span>
                            {ll?.itemNameText ? (
                              <span className="text3" style={{ marginLeft: 6 }}>
                                {ll.itemNameText}
                              </span>
                            ) : null}
                          </td>
                          <td className="td-right mono" style={{ color: 'var(--green2)' }}>
                            {Number(rl.receivedQty).toFixed(2)}
                          </td>
                          <td className="td-right mono" style={{ color: 'var(--red2)' }}>
                            {Number(rl.rejectedQty).toFixed(2)}
                          </td>
                          <td className="text3">{rl.rejectReason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <RelatedDocsPanel module="delivery-challans" id={dc.id} />
    </div>
  );
}

function HeaderGrid(props: { dc: DeliveryChallanWithLines }): React.JSX.Element {
  const { dc } = props;
  return (
    <div className="form-grid form-grid-3">
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
      <Pair
        label="SO"
        value={dc.soCode ?? dc.soRefText ?? '—'}
      />
      <Pair label="Transport" value={dc.transport ?? '—'} />
      <div className="form-grp" />
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
