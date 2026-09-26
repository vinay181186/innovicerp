// Incoming QC (QC Wave 2). Ports legacy renderIncomingQC (HTML L23748):
// pipeline dashboard + pending-GRN inspection queue + recently-completed
// table. The "🔬 Inspect" action opens the accept/reject form as a popup OVER
// this queue (IncomingQcInspectModal) — the same form the QC Call Register
// draws inline in its expanded row — so the inspector never leaves the list
// they are working through. Legacy chrome.

import type { IncomingQcCompletedRow, IncomingQcPendingRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useIncomingQc } from '../api';
import { IncomingQcInspectModal } from '../components/incoming-qc-inspect-modal';

const searchSchema = z.object({
  // DEEP LINK: `?line=<grnLineId>` means "open the Inspect popup for this GRN
  // line" (the same param the QC Call Register accepts). It is consumed —
  // taken back out of the URL — the moment the popup opens, so a refresh or
  // Back is not a second request to open it.
  line: z.string().optional(),
});

export const incomingQcRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'incoming-qc',
  validateSearch: searchSchema,
  component: IncomingQcPage,
});

function waitColor(days: number): string {
  if (days >= 3) return 'var(--red)';
  if (days >= 2) return 'var(--amber)';
  return 'var(--green)';
}

// Legacy hard-codes the chip's translucent fill as an rgb triple alongside the
// var() border/text colour (HTML L23775).
function waitRgb(days: number): string {
  if (days >= 3) return '239,68,68';
  if (days >= 2) return '245,158,11';
  return '34,197,94';
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

/** Screen word for the stored QC result code. */
function dispLabel(d: IncomingQcCompletedRow['disposition']): string {
  return d === 'Partial Accept' ? 'Partly Accepted' : d;
}

function IncomingQcPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useIncomingQc();
  const { data: eff } = useMyAccess();
  const search = incomingQcRoute.useSearch();
  const navigate = incomingQcRoute.useNavigate();

  // Which pending GRN line the Inspect popup is open on; null = closed. Only
  // the id is kept — the row itself is always read fresh off the queue below,
  // so a refetch (the queue polls every 30s) cannot leave the box on stale
  // figures.
  const [inspectLineId, setInspectLineId] = useState<string | null>(null);
  const pending = data?.pending;
  const inspectRow = inspectLineId
    ? (pending?.find((r) => r.grnLineId === inspectLineId) ?? null)
    : null;

  // DEEP LINK — open the popup once the queue has loaded and the line is in
  // it. Acted on once per id, then the param is stripped (replace, so Back
  // does not step through it). A line that is not in the queue (already
  // inspected elsewhere) opens nothing; the param is still consumed.
  const autoOpenedLineRef = useRef<string | null>(null);
  useEffect(() => {
    const line = search.line;
    if (!line || !pending || autoOpenedLineRef.current === line) return;
    autoOpenedLineRef.current = line;
    if (pending.some((r) => r.grnLineId === line)) setInspectLineId(line);
    void navigate({ search: (prev) => ({ ...prev, line: undefined }), replace: true });
  }, [pending, search.line, navigate]);

  // The row vanished after a refetch — fully inspected elsewhere, or the GRN
  // was changed — so there is nothing left to inspect: close rather than keep
  // a form up for a line that no longer needs one.
  useEffect(() => {
    if (inspectLineId && pending && !pending.some((r) => r.grnLineId === inspectLineId)) {
      setInspectLineId(null);
    }
  }, [inspectLineId, pending]);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qc_incoming').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

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
            {error instanceof Error ? error.message : 'Could not load Incoming QC. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {/* Pipeline dashboard — one strip */}
          <div style={{ marginBottom: 16 }}>
            <StatStrip
              items={[
                {
                  key: 'grnsWaiting',
                  label: 'GRNs Waiting',
                  count: data.metrics.grnsWaiting,
                  color: 'var(--amber)',
                },
                {
                  key: 'pendingQty',
                  label: 'Pending Qty',
                  count: data.metrics.pendingQty,
                  color: 'var(--red)',
                },
                {
                  key: 'avgWait',
                  label: 'Avg Wait (days)',
                  count: data.metrics.avgWaitDays,
                  color:
                    data.metrics.avgWaitDays > 3
                      ? 'var(--red)'
                      : data.metrics.avgWaitDays > 1
                        ? 'var(--amber)'
                        : 'var(--green)',
                },
                {
                  key: 'oldest',
                  label: 'Oldest GRN',
                  count: `${data.metrics.oldestDays}d`,
                  color: data.metrics.oldestDays > 5 ? 'var(--red)' : 'var(--amber)',
                  sub: data.metrics.oldestGrnNo ?? undefined,
                },
                // Price-gated: the server sends null when prices are hidden.
                ...(data.metrics.valueInQc == null
                  ? []
                  : [
                      {
                        key: 'valueInQc',
                        label: 'Value in QC',
                        count: `₹${data.metrics.valueInQc.toLocaleString('en-IN')}`,
                        color: 'var(--amber)',
                      },
                    ]),
                {
                  key: 'todayAccepted',
                  label: 'Today Accepted',
                  count: data.metrics.todayAcceptedQty,
                  color: 'var(--green)',
                  sub: `${data.metrics.todayAcceptedGrns} GRNs`,
                },
                {
                  key: 'todayRejected',
                  label: 'Today Rejected',
                  count: data.metrics.todayRejectedQty,
                  color: 'var(--red)',
                },
              ]}
            />
          </div>

          {/* Pending inspection queue */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--amber)' }}>
                ⏳ Pending Inspection ({data.pending.length} lines)
              </span>
            </div>
            {/* The sheet look (tbl-grid, as the Plans and Job Card lists):
                bold blue column names, gridlines, cream / white rows, fixed
                widths that add up to the page so nothing scrolls sideways. */}
            <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
              <table className="innovic-table tbl-grid">
                {/* POL added before Item Code; Vendor and Item Name gave up
                    the width so these still total 100. */}
                <colgroup>
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>GRN No.</th>
                    <th>GRN Date</th>
                    <th>PO No.</th>
                    <th>Vendor</th>
                    {/* POL = the CUSTOMER's own PO line number off the SO line
                        behind this receipt. */}
                    <th style={{ color: 'var(--purple)' }}>POL</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Received</th>
                    <th style={{ color: 'var(--amber)' }}>Days Waiting</th>
                    <th style={{ color: 'var(--amber)' }}>QC Pending</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pending.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty-state">
                        ✅ No items pending QC inspection
                      </td>
                    </tr>
                  ) : (
                    data.pending.map((r) => (
                      <PendingRow
                        key={r.grnLineId}
                        r={r}
                        onInspect={() => setInspectLineId(r.grnLineId)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recently completed */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--green)' }}>
                ✅ Recently Completed QC (last 20)
              </span>
            </div>
            <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
              <table className="innovic-table tbl-grid">
                {/* POL added before Item Code; Vendor, Item Code and Item Name
                    gave up the width so these still total 100. */}
                <colgroup>
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>GRN No.</th>
                    <th>GRN Date</th>
                    <th style={{ color: 'var(--green)' }}>QC Date</th>
                    <th>Days to Inspect</th>
                    <th>Vendor</th>
                    {/* POL = the CUSTOMER's own PO line number off the SO line
                        behind this receipt. */}
                    <th style={{ color: 'var(--purple)' }}>POL</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Received</th>
                    <th style={{ color: 'var(--green)' }}>Accepted</th>
                    <th style={{ color: 'var(--red)' }}>Rejected</th>
                    <th>QC Result</th>
                    <th>Remarks</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.completed.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="empty-state">
                        No completed QC inspections yet
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

      {inspectRow ? (
        <IncomingQcInspectModal
          key={inspectRow.grnLineId}
          o={inspectRow}
          onClose={() => setInspectLineId(null)}
        />
      ) : null}
    </div>
  );
}

function PendingRow({
  r,
  onInspect,
}: {
  r: IncomingQcPendingRow;
  onInspect: () => void;
}): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">{r.grnNo}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(r.grnDate)}
      </td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
        {r.poCode ?? 'Manual'}
      </td>
      <td>{r.vendorName ?? '—'}</td>
      {/* POL — the customer's own PO line number; '—' on a raw-material
          receipt, which has no sales order behind it. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {r.clientPoLineNo ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {/* An OSP return traces back to an SO line and shows CODE/REV; a vendor's
            raw-material receipt has no SO behind it and shows the bare code. Half
            this queue being unslashed is the truth, not a missing value. */}
        {itemCodeWithRev(r.itemCode, r.itemRevision)}
      </td>
      <td>{r.itemName ?? '—'}</td>
      <td className="td-ctr mono fw-700">{r.receivedQty}</td>
      <td className="td-ctr">
        <span
          style={{
            fontWeight: 800,
            color: waitColor(r.waitDays),
            fontSize: 11,
            padding: '2px 8px',
            background: `rgba(${waitRgb(r.waitDays)},0.1)`,
            borderRadius: 4,
            border: `1px solid ${waitColor(r.waitDays)}`,
          }}
        >
          ⏳ {r.waitDays}d
        </span>
      </td>
      <td className="td-ctr mono fw-700" style={{ fontSize: 14, color: 'var(--amber)' }}>
        {r.pendingQty}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11, fontWeight: 700 }}
          onClick={onInspect}
        >
          🔬 Inspect
        </button>
      </td>
    </tr>
  );
}

function CompletedRow({ r }: { r: IncomingQcCompletedRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">{r.grnNo}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(r.grnDate)}
      </td>
      <td className="text2" style={{ fontSize: 11, color: 'var(--green)' }}>
        {fmtDate(r.qcDate)}
      </td>
      <td
        className="td-ctr"
        style={{ fontSize: 11, fontWeight: 700, color: respColor(r.respDays) }}
      >
        {r.respDays === null ? '' : r.respDays <= 0 ? 'Same day' : `${r.respDays}d`}
      </td>
      <td>{r.vendorName ?? '—'}</td>
      {/* POL — the customer's own PO line number; '—' on a raw-material
          receipt, which has no sales order behind it. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {r.clientPoLineNo ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {itemCodeWithRev(r.itemCode, r.itemRevision)}
      </td>
      <td>{r.itemName ?? '—'}</td>
      <td className="td-ctr mono fw-700">{r.receivedQty}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {r.acceptedQty}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
        {r.rejectedQty}
      </td>
      <td>
        <span className="fw-700" style={{ color: dispColor(r.disposition) }}>
          {dispLabel(r.disposition)}
        </span>
      </td>
      <td
        className="text3"
        style={{
          fontSize: 11,
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {r.qcRemarks ?? '—'}
      </td>
      <td>
        {r.qcReportPath ? (
          <QcReportLink path={r.qcReportPath} name={r.qcReportName} label="Report" />
        ) : (
          <span className="text3" style={{ fontSize: 10 }}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}
