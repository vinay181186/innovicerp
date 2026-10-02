// Incoming QC (QC Wave 2). Ports legacy renderIncomingQC (HTML L23748):
// pipeline dashboard + pending-GRN inspection queue + recently-completed
// table. The ⋯ menu's Inspect opens the accept/reject form as a popup OVER
// this queue (IncomingQcInspectModal) — the same form the QC Call Register
// draws inline in its expanded row — so the inspector never leaves the list
// they are working through.
//
// ADR-199 table standard: both tables are the shared FIT table
// (<DataTable tableKey=…>), one line per GRN line, the fit engine sizing columns
// to the screen and dropping the rightmost unpinned ones into a ▸ detail row
// when it is too narrow. The row columns + ▸ detail live in two column modules
// so this file stays under the 400-line ceiling.

import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback/Banner';
import { ListHeader, PageState } from '@/ui/layout';
import { useIncomingQc } from '../api';
import { type IncomingRaisedNc } from '../components/incoming-qc-inspect-form';
import { IncomingQcInspectModal } from '../components/incoming-qc-inspect-modal';
import {
  IncomingQcCompletedExpanded,
  incomingQcCompletedColumns,
} from '../components/incoming-qc-completed-columns';
import {
  IncomingQcPendingExpanded,
  incomingQcPendingColumns,
} from '../components/incoming-qc-pending-columns';
import { daysText } from '../lib/qc-format';

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
  // The NC the last reject raised — named with a link to its disposition,
  // the same banner the QC Call Register shows (incoming-qc-inspect#1).
  const [raisedNc, setRaisedNc] = useState<IncomingRaisedNc | null>(null);
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

  // Client-side search over the rows already loaded — every column the two
  // tables show that carries text (GRN, PO, vendor, POL, item code/name).
  const [term, setTerm] = useState('');
  const pendingRows = (data?.pending ?? []).filter((r) =>
    matchesSearchTerm(
      [r.grnNo, r.poCode, r.vendorName, r.clientPoLineNo, r.itemCode, r.itemRevision, r.itemName],
      term,
    ),
  );
  const completedRows = (data?.completed ?? []).filter((r) =>
    matchesSearchTerm(
      [
        r.grnNo,
        r.vendorName,
        r.clientPoLineNo,
        r.itemCode,
        r.itemRevision,
        r.itemName,
        r.qcRemarks,
      ],
      term,
    ),
  );

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row.
  const [pendingOpen, setPendingOpen] = useState<Set<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState<Set<string>>(new Set());
  const togglePending = useCallback((id: string) => toggle(setPendingOpen, id), []);
  const toggleCompleted = useCallback((id: string) => toggle(setCompletedOpen, id), []);

  const pendingCols = incomingQcPendingColumns();
  const completedCols = incomingQcCompletedColumns();

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qc_incoming').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Incoming QC. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="Incoming QC"
        icon="🔬"
        count={data ? pendingRows.length : undefined}
        noun="pending line"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search GRN, PO, vendor, POL, item code, item name…"
        updating={isFetching && !isLoading}
      >
        {/* Pipeline dashboard — one strip */}
        {data ? (
          <StatStrip
            items={[
              {
                key: 'grnsWaiting',
                label: 'GRNs Waiting',
                count: data.metrics.grnsWaiting,
                color: 'var(--amber2)',
                // Price-gated: the server sends null when prices are hidden.
                sub:
                  data.metrics.valueInQc == null
                    ? undefined
                    : `₹${data.metrics.valueInQc.toLocaleString('en-IN')} in QC`,
              },
              {
                key: 'pendingQty',
                label: 'QC Pending',
                count: data.metrics.pendingQty,
                color: 'var(--amber2)',
              },
              {
                key: 'oldest',
                label: 'Oldest GRN',
                count: daysText(data.metrics.oldestDays),
                color: data.metrics.oldestDays > 5 ? 'var(--red2)' : 'var(--amber2)',
                sub: [data.metrics.oldestGrnNo, `Avg ${daysText(data.metrics.avgWaitDays)}`]
                  .filter(Boolean)
                  .join(' · '),
              },
              {
                key: 'todayAccepted',
                label: 'Today Accepted',
                count: data.metrics.todayAcceptedQty,
                color: 'var(--green2)',
                sub: `${data.metrics.todayAcceptedGrns} GRNs`,
              },
              {
                key: 'todayRejected',
                label: 'Today Rejected',
                count: data.metrics.todayRejectedQty,
                color: 'var(--red2)',
              },
            ]}
          />
        ) : null}
      </ListHeader>

      {raisedNc ? (
        <Banner
          tone="warn"
          accent
          onDismiss={() => setRaisedNc(null)}
          title={
            <>
              NC{' '}
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {raisedNc.code}
              </span>{' '}
              raised —{' '}
              <Link to="/nc-register/$id" params={{ id: raisedNc.id }}>
                Dispose now →
              </Link>
            </>
          }
        >
          The rejected qty from the Incoming QC just saved is on this NC until it is disposed.
        </Banner>
      ) : null}

      {isError || (!data && !isLoading) ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load Incoming QC. Try again.'
          }
        />
      ) : (
        <>
          {/* Pending inspection queue */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--amber2)' }}>
                ⏳ Pending Inspection ({pendingRows.length} lines)
              </span>
            </div>
            <Panel bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.incomingQcPending}
                columns={pendingCols}
                rows={pendingRows}
                rowKey={(r) => r.grnLineId}
                loading={isLoading}
                emptyText={term.trim() ? 'No GRN lines match.' : 'No GRN lines waiting for QC.'}
                // Row click opens the GRN doc; Inspect (⋯) opens the accept/reject
                // popup over the queue.
                onRowClick={(r) =>
                  void navigate({ to: '/goods-receipt-notes/$id', params: { id: r.grnId } })
                }
                renderExpanded={(r) =>
                  pendingOpen.has(r.grnLineId) ? <IncomingQcPendingExpanded r={r} /> : null
                }
                onToggleExpanded={(r) => togglePending(r.grnLineId)}
                rowMenu={(r) => [
                  {
                    key: 'inspect',
                    label: 'Inspect',
                    icon: 'check',
                    group: 'workflow',
                    onSelect: () => setInspectLineId(r.grnLineId),
                  },
                ]}
              />
            </Panel>
          </div>

          {/* Recently completed */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--green2)' }}>
                ✅ Recently Completed QC (last 20)
              </span>
            </div>
            <Panel bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.incomingQcDone}
                columns={completedCols}
                rows={completedRows}
                rowKey={(r) => r.grnLineId}
                loading={isLoading}
                emptyText={
                  term.trim() ? 'No completed inspections match.' : 'No completed inspections yet.'
                }
                onRowClick={(r) =>
                  void navigate({ to: '/goods-receipt-notes/$id', params: { id: r.grnId } })
                }
                // Row tint by the real QC result (disposition): accepted green,
                // partial amber, rejected red.
                rowClassName={(r) => ROW_TINT_BY_DISP[r.disposition]}
                renderExpanded={(r) =>
                  completedOpen.has(r.grnLineId) ? <IncomingQcCompletedExpanded r={r} /> : null
                }
                onToggleExpanded={(r) => toggleCompleted(r.grnLineId)}
              />
            </Panel>
          </div>
        </>
      )}

      {inspectRow ? (
        <IncomingQcInspectModal
          key={inspectRow.grnLineId}
          o={inspectRow}
          onClose={() => setInspectLineId(null)}
          onNcRaised={setRaisedNc}
        />
      ) : null}
    </div>
  );
}

// Completed QC result → row tint (ADR-199 ROW_TINT). Real disposition enum only.
const ROW_TINT_BY_DISP: Record<string, string> = {
  Accepted: ROW_TINT.done,
  'Partial Accept': ROW_TINT.pending,
  Rejected: ROW_TINT.late,
};

function toggle(set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string): void {
  set((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
