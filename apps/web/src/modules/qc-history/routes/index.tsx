// QC History & Tracking (QC Wave 2). Ports legacy renderQCHistory (HTML
// L23531): All/Pending/Completed tabs + 4 stat cards + SO/JC/Item + date
// filters + pending QC table + completed QC-entries table + Excel export.
// Read-only, legacy chrome.

import type { QcHistoryLogRow, QcHistoryPendingRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/print/doc-print';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcHistory } from '../api';
import { exportCompletedQc, exportPendingQc } from '../lib/export';

export const qcHistoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-history',
  component: QcHistoryPage,
});

type Tab = 'all' | 'pending' | 'completed';

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
    () => (data?.pending ?? []).filter((o) => matchText(o.soCode, o.jcCode, o.itemCode)),
    [data?.pending, t],
  );
  const logs = useMemo(
    () =>
      (data?.logs ?? []).filter(
        (l) =>
          matchText(l.soCode, l.jcCode, l.itemCode) &&
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
          📊 QC History &amp; Tracking
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" />
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={logs.length === 0}
            onClick={() => exportCompletedQc(logs)}
          >
            ⬇ Export Completed
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pending.length === 0}
            onClick={() => exportPendingQc(pending)}
          >
            ⬇ Export Pending
          </button>
          {(['all', 'pending', 'completed'] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              className={`btn btn-sm ${tab === tb ? 'btn-primary' : 'btn-ghost'}`}
              style={{ textTransform: 'capitalize' }}
              onClick={() => setTab(tb)}
            >
              {tb}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC history…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load QC history'}
          </div>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 8,
              marginBottom: 14,
            }}
          >
            <Stat label="Pending QC Ops" value={data.stats.pendingOps} color="var(--amber)" />
            <Stat label="Overdue (>1 day)" value={data.stats.overdue} color="var(--red)" />
            <Stat label="QC Entries (total)" value={data.stats.totalEntries} color="var(--green)" />
            <Stat label="Today" value={data.stats.today} color="var(--blue)" />
          </div>

          {/* Filters */}
          <div
            className="panel"
            style={{ marginBottom: 14, padding: '10px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <div>
              <label className="text3" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                SO / JC / Item
              </label>
              <input
                className="innovic-input"
                style={{ width: 180, fontSize: 12 }}
                placeholder="🔍 Filter…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text3" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Date From
              </label>
              <input
                type="date"
                className="innovic-input"
                style={{ fontSize: 12 }}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text3" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Date To
              </label>
              <input
                type="date"
                className="innovic-input"
                style={{ fontSize: 12 }}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear
            </button>
          </div>

          {showPend ? (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--amber)' }}>
                  ⏳ Pending QC ({pending.length})
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>JC</th>
                      <th>Op</th>
                      <th>SO</th>
                      <th>Item</th>
                      <th>Operation</th>
                      <th style={{ textAlign: 'center' }}>Order</th>
                      <th style={{ textAlign: 'center' }}>Done</th>
                      <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accepted</th>
                      <th style={{ textAlign: 'center', color: 'var(--red)' }}>Rejected</th>
                      <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Pending</th>
                      <th>Since</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="empty-state">
                          ✅ No pending QC
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
                <span className="panel-title" style={{ color: 'var(--green)' }}>
                  ✅ QC Entries ({logs.length})
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>JC</th>
                      <th>Op</th>
                      <th>SO</th>
                      <th>Item</th>
                      <th>Operation</th>
                      <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accepted</th>
                      <th style={{ textAlign: 'center', color: 'var(--red)' }}>Rejected</th>
                      <th>Date</th>
                      <th>Shift</th>
                      <th>Inspector</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="empty-state">
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

function Stat(props: { label: string; value: number; color: string }): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 10 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 22, color: props.color }}>
        {props.value}
      </div>
    </div>
  );
}

function PendRow({ o }: { o: QcHistoryPendingRow }): React.JSX.Element {
  return (
    <tr className={o.overdue ? 'qc-alert-blink' : undefined}>
      <td className="td-code cyan">{o.jcCode}</td>
      <td className="td-ctr mono">Op{o.opSeq}</td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>
        {o.soCode ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {o.itemCode ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>{o.operation}</td>
      <td className="td-ctr mono fw-700">{o.orderQty}</td>
      <td className="td-ctr mono fw-700">{o.completed}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {o.qcAccepted}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
        {o.qcRejected}
      </td>
      <td className="td-ctr mono fw-700" style={{ fontSize: 16, color: 'var(--amber)' }}>
        {o.qcPending}
      </td>
      <td className="text3" style={{ fontSize: 10 }}>
        {o.pendSince ? fmtDate(o.pendSince) : '—'}
        {o.overdue ? <span style={{ color: 'var(--red)', fontWeight: 700 }}> ⚠</span> : null}
      </td>
      <td>
        <Link
          to="/qc-call-register"
          className="btn btn-primary btn-sm"
          style={{ fontSize: 10, whiteSpace: 'nowrap' }}
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
      <td className="td-ctr mono">Op{l.opSeq}</td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>
        {l.soCode ?? '—'}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {l.itemCode ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>{l.operation}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {l.accepted}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
        {l.rejected}
      </td>
      <td style={{ fontSize: 11 }}>{fmtDate(l.logDate)}</td>
      <td style={{ fontSize: 11 }}>{l.shift ?? '—'}</td>
      <td style={{ fontSize: 11 }}>{l.inspector ?? '—'}</td>
      <td className="text3" style={{ fontSize: 10 }}>
        {l.remarks ?? '—'}
      </td>
    </tr>
  );
}
