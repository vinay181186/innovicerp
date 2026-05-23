// Incoming QC (QC Wave 2). Ports legacy renderIncomingQC (HTML L23748):
// pipeline dashboard + pending-GRN inspection queue + recently-completed
// table. Read-only — the "Inspect" action links to the GRN detail page where
// the existing goods-receipt-notes flow writes QC + the store transaction.
// Legacy chrome.

import type { IncomingQcCompletedRow, IncomingQcPendingRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useIncomingQc } from '../api';

export const incomingQcRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'incoming-qc',
  component: IncomingQcPage,
});

function waitColor(days: number): string {
  if (days >= 3) return 'var(--red)';
  if (days >= 2) return 'var(--amber)';
  return 'var(--green)';
}

function respColor(days: number | null): string {
  if (days === null) return 'var(--text3)';
  if (days <= 1) return 'var(--green)';
  if (days <= 2) return 'var(--amber)';
  return 'var(--red)';
}

function dispColor(d: IncomingQcCompletedRow['disposition']): string {
  if (d === 'Rejected') return 'var(--red)';
  if (d === 'Partial Accept') return 'var(--amber)';
  return 'var(--green)';
}

function IncomingQcPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useIncomingQc();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔬 Incoming QC
        </div>
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading incoming QC…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load incoming QC'}
          </div>
        </div>
      ) : (
        <>
          {/* Pipeline dashboard */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <Card label="GRNs Waiting" value={data.metrics.grnsWaiting} color="var(--amber)" />
            <Card label="Pending Qty" value={data.metrics.pendingQty} color="var(--red)" />
            <Card
              label="Avg Wait (days)"
              value={data.metrics.avgWaitDays}
              color={
                data.metrics.avgWaitDays > 3
                  ? 'var(--red)'
                  : data.metrics.avgWaitDays > 1
                    ? 'var(--amber)'
                    : 'var(--green)'
              }
            />
            <Card
              label="Oldest GRN"
              value={`${data.metrics.oldestDays}d`}
              color={data.metrics.oldestDays > 5 ? 'var(--red)' : 'var(--amber)'}
              {...(data.metrics.oldestGrnNo ? { sub: data.metrics.oldestGrnNo } : {})}
            />
            <Card
              label="Today Accepted"
              value={data.metrics.todayAcceptedQty}
              color="var(--green)"
              sub={`${data.metrics.todayAcceptedGrns} GRNs`}
            />
            <Card label="Today Rejected" value={data.metrics.todayRejectedQty} color="var(--red)" />
          </div>

          {/* Pending inspection queue */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">⏳ Awaiting Inspection</span>
              <span className="mono" style={{ color: 'var(--amber)', fontSize: 12 }}>
                {data.pending.length} lines
              </span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>GRN No.</th>
                    <th>Date</th>
                    <th>PO</th>
                    <th>Vendor</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th style={{ textAlign: 'center' }}>Received</th>
                    <th style={{ textAlign: 'center' }}>Wait</th>
                    <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Pending</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.pending.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="empty-state">
                        ✅ No GRNs awaiting QC.
                      </td>
                    </tr>
                  ) : (
                    data.pending.map((r) => <PendingRow key={r.grnLineId} r={r} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recently completed */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">✅ Recently Inspected</span>
              <span className="text3" style={{ fontSize: 11 }}>
                last {data.completed.length}
              </span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>GRN No.</th>
                    <th>GRN Date</th>
                    <th>QC Date</th>
                    <th style={{ textAlign: 'center' }}>Resp</th>
                    <th>Vendor</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th style={{ textAlign: 'center' }}>Received</th>
                    <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accepted</th>
                    <th style={{ textAlign: 'center', color: 'var(--red)' }}>Rejected</th>
                    <th>Disposition</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.completed.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="empty-state">
                        No completed inspections yet.
                      </td>
                    </tr>
                  ) : (
                    data.completed.map((r) => <CompletedRow key={r.grnLineId} r={r} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card(props: {
  label: string;
  value: number | string;
  color: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 24, color: props.color }}>
        {props.value}
      </div>
      {props.sub ? (
        <div className="text3" style={{ fontSize: 9 }}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

function PendingRow({ r }: { r: IncomingQcPendingRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">{r.grnNo}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {r.grnDate}
      </td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
        {r.poCode ?? 'Manual'}
      </td>
      <td style={{ fontSize: 11 }}>{r.vendorName ?? '—'}</td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {r.itemCode ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>{r.itemName ?? '—'}</td>
      <td className="td-ctr mono fw-700">{r.receivedQty}</td>
      <td className="td-ctr">
        <span className="fw-700" style={{ fontSize: 11, color: waitColor(r.waitDays) }}>
          ⏳ {r.waitDays}d
        </span>
      </td>
      <td className="td-ctr mono fw-700" style={{ fontSize: 14, color: 'var(--amber)' }}>
        {r.pendingQty}
      </td>
      <td>
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: r.grnId }}
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          🔬 Inspect
        </Link>
      </td>
    </tr>
  );
}

function CompletedRow({ r }: { r: IncomingQcCompletedRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">{r.grnNo}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {r.grnDate}
      </td>
      <td className="text2" style={{ fontSize: 11, color: 'var(--green)' }}>
        {r.qcDate ?? '—'}
      </td>
      <td className="td-ctr" style={{ fontSize: 11, fontWeight: 700, color: respColor(r.respDays) }}>
        {r.respDays === null ? '—' : r.respDays <= 0 ? 'Same day' : `${r.respDays}d`}
      </td>
      <td style={{ fontSize: 11 }}>{r.vendorName ?? '—'}</td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {r.itemCode ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>{r.itemName ?? '—'}</td>
      <td className="td-ctr mono fw-700">{r.receivedQty}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {r.acceptedQty}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
        {r.rejectedQty}
      </td>
      <td>
        <span className="fw-700" style={{ color: dispColor(r.disposition) }}>
          {r.disposition}
        </span>
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {r.qcRemarks ?? '—'}
      </td>
    </tr>
  );
}
