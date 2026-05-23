// SO QC Status (legacy renderSOQCStatus L18347). SO selector -> per-line QC
// stage rollup over all four legacy stages: QC Ops + TPI + GRN-QC + Docs, with
// a summary strip and per-line Overall pill. Legacy chrome.

import type { SoQcLine, SoQcOverall } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoForQc, useSoQcStatus } from '../api';

const searchSchema = z.object({ so: z.string().uuid().optional() });

export const soQcStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-qc-status',
  validateSearch: searchSchema,
  component: SoQcStatusPage,
});

function overallBadge(o: SoQcOverall): { cls: string; label: string } {
  if (o === 'passed') return { cls: 'b-green', label: 'Passed' };
  if (o === 'in_progress') return { cls: 'b-amber', label: 'In Progress' };
  if (o === 'pending') return { cls: 'b-red', label: 'Pending' };
  return { cls: 'b-grey', label: 'No QC' };
}

function SoQcStatusPage(): React.JSX.Element {
  const search = soQcStatusRoute.useSearch();
  const navigate = soQcStatusRoute.useNavigate();
  const sos = useSoForQc();
  const detail = useSoQcStatus(search.so);

  function selectSo(id: string): void {
    void navigate({ search: () => (id ? { so: id } : {}), replace: true });
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
          flexWrap: 'wrap',
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔬 SO QC Status
        </div>
        <select
          className="innovic-select"
          style={{ minWidth: 300, fontSize: 13 }}
          value={search.so ?? ''}
          onChange={(e) => selectSo(e.target.value)}
        >
          <option value="">— Select SO —</option>
          {(sos.data?.sos ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.customerName ?? ''} ({s.status})
            </option>
          ))}
        </select>
      </div>

      {!search.so ? (
        <div className="panel">
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔬</div>
            Select a Sales Order to view its per-line QC status.
          </div>
        </div>
      ) : detail.isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC status…
          </div>
        </div>
      ) : detail.isError || !detail.data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {detail.error instanceof Error ? detail.error.message : 'Failed to load SO QC status'}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: 14,
              background: 'rgba(34,211,238,0.04)',
              border: '1px solid rgba(34,211,238,0.15)',
              borderRadius: 'var(--radius)',
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span className="mono fw-700" style={{ fontSize: 18, color: 'var(--cyan)' }}>
                {detail.data.so.code}
              </span>
              <span style={{ marginLeft: 12, fontSize: 14, fontWeight: 600 }}>
                {detail.data.so.customerName ?? '—'}
              </span>
              <span className="badge b-blue" style={{ marginLeft: 12 }}>
                {detail.data.so.status}
              </span>
            </div>
            <div className="text3" style={{ fontSize: 12 }}>
              SO Date: {detail.data.so.soDate ?? '—'}
            </div>
          </div>

          <SummaryStrip lines={detail.data.lines} />

          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">Per-line QC Status</span>
              <span className="text3" style={{ fontSize: 11 }}>
                {detail.data.lines.length} lines
              </span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Item</th>
                    <th>Part</th>
                    <th style={{ textAlign: 'center' }}>Qty</th>
                    <th style={{ textAlign: 'center' }}>JCs</th>
                    <th style={{ textAlign: 'center' }}>QC Ops (passed/total)</th>
                    <th style={{ textAlign: 'center', color: 'var(--green)' }}>QC Acc</th>
                    <th style={{ textAlign: 'center', color: 'var(--red)' }}>QC Rej</th>
                    <th style={{ textAlign: 'center', color: 'var(--amber)' }}>QC Pend</th>
                    <th style={{ textAlign: 'center', color: 'var(--purple)' }}>TPI</th>
                    <th style={{ textAlign: 'center' }}>GRN QC</th>
                    <th style={{ textAlign: 'center' }}>Docs</th>
                    <th>Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="empty-state">
                        No lines on this SO.
                      </td>
                    </tr>
                  ) : (
                    detail.data.lines.map((l) => <LineRow key={l.soLineId} l={l} />)
                  )}
                </tbody>
              </table>
            </div>
            <div className="panel-body">
              <span className="text3" style={{ fontSize: 11 }}>
                💡 All four QC stages rolled up per SO line: QC Ops + TPI via the JCs sourced from
                the line, GRN-QC via the line's PO lines (direct or outsource), Docs via QC Documents
                on those JCs.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LineRow({ l }: { l: SoQcLine }): React.JSX.Element {
  const ov = overallBadge(l.overall);
  return (
    <tr>
      <td className="td-ctr mono fw-700">{l.lineNo}</td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {l.itemCode ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>{l.partName ?? '—'}</td>
      <td className="td-ctr mono">{l.orderQty}</td>
      <td className="td-ctr mono">{l.jcCount}</td>
      <td className="td-ctr mono">
        {l.qcOpsTotal === 0 ? '—' : `${l.qcOpsPassed}/${l.qcOpsTotal}`}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {l.qcAccepted}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: l.qcRejected > 0 ? 'var(--red)' : 'var(--text3)' }}>
        {l.qcRejected}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: l.qcPending > 0 ? 'var(--amber)' : 'var(--text3)' }}>
        {l.qcPending}
      </td>
      <td className="td-ctr mono" style={{ color: 'var(--purple)' }}>
        {l.tpiCount === 0 ? '—' : `${l.tpiCount} (${l.tpiAccepted}/${l.tpiRejected})`}
      </td>
      <td className="td-ctr">
        {l.grnTotal === 0 ? (
          <span className="text3">—</span>
        ) : (
          <span className={`badge ${l.grnDone >= l.grnTotal ? 'b-green' : 'b-amber'}`}>
            {l.grnDone >= l.grnTotal ? '✅' : '⏳'} {l.grnDone}/{l.grnTotal}
          </span>
        )}
      </td>
      <td className="td-ctr">
        {l.docCount === 0 ? (
          <span className="text3">—</span>
        ) : (
          <span className="badge b-green">📄 {l.docCount}</span>
        )}
      </td>
      <td>
        <span className={`badge ${ov.cls}`}>{ov.label}</span>
      </td>
    </tr>
  );
}

// Summary strip (legacy summary cards L18483): QC Ops / Incoming QC / QC Pending
// (ops) / Documents / TPI — reduced over the lines.
function SummaryStrip({ lines }: { lines: SoQcLine[] }): React.JSX.Element {
  const t = lines.reduce(
    (a, l) => ({
      qcOps: a.qcOps + l.qcOpsTotal,
      qcPassed: a.qcPassed + l.qcOpsPassed,
      pendingOps: a.pendingOps + Math.max(0, l.qcOpsTotal - l.qcOpsPassed),
      grn: a.grn + l.grnTotal,
      grnDone: a.grnDone + l.grnDone,
      docs: a.docs + l.docCount,
      tpi: a.tpi + l.tpiCount,
    }),
    { qcOps: 0, qcPassed: 0, pendingOps: 0, grn: 0, grnDone: 0, docs: 0, tpi: 0 },
  );
  const allDone = (done: number, total: number): string =>
    total > 0 && done >= total ? 'var(--green)' : 'var(--amber)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8,
        marginBottom: 16,
      }}
    >
      <Card label="QC OPS" value={`${t.qcPassed}/${t.qcOps}`} sub="passed" color={allDone(t.qcPassed, t.qcOps)} />
      <Card label="INCOMING QC" value={`${t.grnDone}/${t.grn}`} sub="done" color={allDone(t.grnDone, t.grn)} />
      <Card label="QC PENDING" value={t.pendingOps} sub="ops" color={t.pendingOps > 0 ? 'var(--red)' : 'var(--green)'} />
      <Card label="DOCUMENTS" value={t.docs} sub="uploaded" color={t.docs > 0 ? 'var(--green)' : 'var(--text3)'} />
      <Card label="TPI" value={t.tpi} sub="done" color={t.tpi > 0 ? 'var(--green)' : 'var(--text3)'} />
    </div>
  );
}

function Card(props: {
  label: string;
  value: number | string;
  sub: string;
  color: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 9 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 20, color: props.color }}>
        {props.value}
      </div>
      <div className="text3" style={{ fontSize: 9 }}>
        {props.sub}
      </div>
    </div>
  );
}
