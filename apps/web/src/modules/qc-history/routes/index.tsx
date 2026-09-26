// QC History & Tracking (QC Wave 2). Ports legacy renderQCHistory (HTML
// L23531): All/Pending/Completed tabs + 4 stat cards + SO/JC/Item + date
// filters + pending QC table + completed QC-entries table + Excel export.
// Read-only, legacy chrome.

import { type QcHistoryLogRow, type QcHistoryPendingRow, opSrNo } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ActionMenu, ListHeader } from '@/ui/layout';
import { useQcHistory } from '../api';
import { exportCompletedQc, exportPendingQc } from '../lib/export';

export const qcHistoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-history',
  component: QcHistoryPage,
});

type Tab = 'all' | 'pending' | 'completed';

// Legacy L23599-23601: All is plain, Pending is amber, Completed is green.
const TABS: { key: Tab; label: string; color?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', color: 'var(--amber2)' },
  { key: 'completed', label: 'Completed', color: 'var(--green2)' },
];

function QcHistoryPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useQcHistory();
  const [tab, setTab] = useState<Tab>('all');
  const [term, setTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const t = term.trim().toLowerCase();
  const matchText = (...vals: (string | null)[]): boolean =>
    t === '' || vals.some((v) => (v ?? '').toLowerCase().includes(t));

  const pending = useMemo(
    () =>
      (data?.pending ?? []).filter((o) =>
        // The revision is part of what the Item column shows, and the part name
        // now has a column of its own, so both have to be part of what the box
        // searches — an inspector hunting "plunger" should not have to know its
        // code. This filter runs over rows already in the browser, so nothing
        // can be hidden by widening it.
        matchText(o.soCode, o.jcCode, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName),
      ),
    [data?.pending, t],
  );
  const logs = useMemo(
    () =>
      (data?.logs ?? []).filter(
        (l) =>
          // Same widening as the pending list: the Item Name column is on
          // screen, so typing a part name has to find the row.
          matchText(l.soCode, l.jcCode, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName) &&
          (dateFrom === '' || l.logDate >= dateFrom) &&
          (dateTo === '' || l.logDate <= dateTo),
      ),
    [data?.logs, t, dateFrom, dateTo],
  );

  const showPend = tab === 'all' || tab === 'pending';
  const showComp = tab === 'all' || tab === 'completed';

  function clearFilters(): void {
    setTerm('');
    setDateFrom('');
    setDateTo('');
    setTab('all');
  }

  const shownCount = (showPend ? pending.length : 0) + (showComp ? logs.length : 0);

  return (
    <div>
      <ListHeader
        title="QC History"
        icon="📊"
        count={data ? shownCount : undefined}
        noun="row"
        filterNote={tab === 'all' ? undefined : tab}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO, JC, POL, item code, item name…"
        updating={isFetching && !isLoading}
        tools={
          <>
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                className={`btn btn-sm ${tab === tb.key ? 'btn-primary' : 'btn-ghost'}`}
                style={tb.color && tab !== tb.key ? { color: tb.color } : undefined}
                aria-pressed={tab === tb.key}
                onClick={() => setTab(tb.key)}
              >
                {tb.label}
              </button>
            ))}
            <input
              type="date"
              className="innovic-input"
              title="QC date from"
              aria-label="QC date from"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              type="date"
              className="innovic-input"
              title="QC date to"
              aria-label="QC date to"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear
            </button>
            <ActionMenu
              label="⬇ Export"
              items={[
                {
                  label: 'Completed entries',
                  disabled: logs.length === 0,
                  onClick: () => exportCompletedQc(logs),
                },
                {
                  label: 'Pending QC',
                  disabled: pending.length === 0,
                  onClick: () => exportPendingQc(pending),
                },
              ]}
            />
          </>
        }
      >
        {data ? (
          /* Stats — legacy L23604-23609, now one strip under the title. */
          <StatStrip
            items={[
              {
                key: 'overdue',
                label: 'Overdue (>1 day)',
                count: data.stats.overdue,
                color: 'var(--red2)',
              },
              { key: 'today', label: "Today's Entries", count: data.stats.today },
            ]}
          />
        ) : null}
      </ListHeader>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC history…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load QC History. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {showPend ? (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--amber2)' }}>
                  ⏳ QC Pending ({pending.length})
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>JC No.</th>
                      <th>Op</th>
                      <th>SO No.</th>
                      {/* POL — the CUSTOMER's own purchase-order line number,
                          immediately before the item code as everywhere else. */}
                      <th style={{ color: 'var(--purple)' }}>POL</th>
                      <th>Item Code</th>
                      {/* The code says which part number is waiting; it does not
                          say what the part is. The name gets its own column so
                          the code column stays a clean key. */}
                      <th>Item Name</th>
                      <th>Operation</th>
                      <th className="th-num">Order Qty</th>
                      <th className="th-num">Completed</th>
                      <th className="th-num" style={{ color: 'var(--green2)' }}>
                        Accepted
                      </th>
                      <th className="th-num" style={{ color: 'var(--red2)' }}>
                        Rejected
                      </th>
                      <th className="th-num" style={{ color: 'var(--amber2)' }}>
                        Pending
                      </th>
                      <th>Since</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="empty-state">
                          ✅ Nothing QC Pending
                        </td>
                      </tr>
                    ) : (
                      pending.map((o) => <PendRow key={o.jcOpId} o={o} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {showComp ? (
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--green2)' }}>
                  ✅ QC Entries ({logs.length})
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>JC No.</th>
                      <th>Op</th>
                      <th>SO No.</th>
                      <th style={{ color: 'var(--purple)' }}>POL</th>
                      <th>Item Code</th>
                      {/* Same reason as the pending table above: reading a QC
                          entry back months later, the part number alone does not
                          tell you what was inspected. */}
                      <th>Item Name</th>
                      <th>Operation</th>
                      <th className="th-num" style={{ color: 'var(--green2)' }}>
                        Accepted
                      </th>
                      <th className="th-num" style={{ color: 'var(--red2)' }}>
                        Rejected
                      </th>
                      <th>QC Date</th>
                      <th>Shift</th>
                      <th>Inspected By</th>
                      <th>Remarks</th>
                      <th>Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="empty-state">
                          No QC entries
                        </td>
                      </tr>
                    ) : (
                      logs.map((l) => <LogRow key={l.logId} l={l} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PendRow({ o }: { o: QcHistoryPendingRow }): React.JSX.Element {
  return (
    <tr className={o.overdue ? 'qc-alert-blink' : undefined}>
      <td className="td-code cyan">{o.jcCode}</td>
      <td className="td-ctr mono">Op{opSrNo(o.opSeq)}</td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>
        {o.soCode ?? '—'}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {o.clientPoLineNo ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {itemCodeWithRev(o.itemCode, o.itemRevision)}
      </td>
      {/* Free text of any length, so it clips to a fixed width and keeps the
          full name on hover rather than stretching a twelve-column row. An
          unresolved item prints nothing — a dash would read as a part that was
          deliberately left unnamed. */}
      <td
        className="fw-700"
        style={{
          fontSize: 12,
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        {...(o.itemName ? { title: o.itemName } : {})}
      >
        {o.itemName ? o.itemName : null}
      </td>
      <td style={{ fontSize: 11 }}>{o.operation}</td>
      <td className="td-num mono fw-700">{o.orderQty}</td>
      <td className="td-num mono fw-700">{o.completed}</td>
      <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
        {o.qcAccepted}
      </td>
      <td className="td-num mono fw-700" style={{ color: 'var(--red2)' }}>
        {o.qcRejected}
      </td>
      <td className="td-num mono fw-700" style={{ fontSize: 16, color: 'var(--amber2)' }}>
        {o.qcPending}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {fmtDate(o.pendSince)}
        {o.overdue ? <span style={{ color: 'var(--red2)', fontWeight: 700 }}> ⚠</span> : null}
      </td>
      <td>
        <Link
          to="/qc-call-register"
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        >
          🔬 QC
        </Link>
      </td>
    </tr>
  );
}

function LogRow({ l }: { l: QcHistoryLogRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">{l.jcCode}</td>
      <td className="td-ctr mono">Op{opSrNo(l.opSeq)}</td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>
        {l.soCode ?? '—'}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {l.clientPoLineNo ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {itemCodeWithRev(l.itemCode, l.itemRevision)}
      </td>
      {/* Clipped with the full name on hover, the same as the pending table, so
          a long part name cannot widen the log row. Nothing is printed when the
          item did not resolve. */}
      <td
        className="fw-700"
        style={{
          fontSize: 12,
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        {...(l.itemName ? { title: l.itemName } : {})}
      >
        {l.itemName ? l.itemName : null}
      </td>
      <td style={{ fontSize: 11 }}>{l.operation}</td>
      <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
        {l.accepted}
      </td>
      <td className="td-num mono fw-700" style={{ color: 'var(--red2)' }}>
        {l.rejected}
      </td>
      <td style={{ fontSize: 11 }}>{fmtDate(l.logDate)}</td>
      <td style={{ fontSize: 11 }}>{l.shift ?? '—'}</td>
      <td style={{ fontSize: 11 }}>{l.inspector ?? '—'}</td>
      <td
        style={{
          fontSize: 11,
          maxWidth: 100,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {l.remarks ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>
        {l.qcReportPath ? (
          <QcReportLink path={l.qcReportPath} name={l.qcReportName} label="View" />
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
