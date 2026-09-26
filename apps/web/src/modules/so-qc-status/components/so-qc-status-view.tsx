// SO QC Status view (legacy renderSOQCStatus L18347) — folded in as the "SO
// Status" tab of QC Documents. SO selector → rich per-line QC-stage report:
// per-JC/per-op ✅/⏳/❌ rows, Incoming-QC / TPI / Docs pills, an overall %
// progress bar, an expandable detail row, and a TOTAL footer. Read-only.
// Uses local component state for the SO selection (the standalone route drove
// it off the URL).

import type { SoQcLine, SoQcStageOp, SoStatus } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { StatStrip } from '@/components/shared/stat-strip';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/date';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { useSoQcStatus } from '../api';

const TABLE_COLS = 9;

function pctColor(pct: number): string {
  if (pct >= 100) return 'var(--green)';
  if (pct >= 50) return 'var(--amber)';
  return 'var(--red)';
}

function stageIcon(status: SoQcStageOp['status']): string {
  if (status === 'passed' || status === 'passed_rej') return '✅';
  if (status === 'in_progress') return '⏳';
  return '❌';
}

export function SoQcStatusView(): React.JSX.Element {
  const [selectedSo, setSelectedSo] = useState<string | null>(null);
  const [soSearch, setSoSearch] = useState('');
  const soList = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const detail = useSoQcStatus(selectedSo ?? undefined);

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ minWidth: 300 }}>
          <SearchableSelect
            id="so-qc-select"
            value={selectedSo}
            onChange={setSelectedSo}
            onSearch={setSoSearch}
            loading={soList.isFetching}
            placeholder="Search SO No. or customer…"
            options={(soList.data?.items ?? []).map((s) => ({
              id: s.id,
              code: s.code,
              name: s.customerName ?? '',
            }))}
          />
        </div>
      </div>

      {!selectedSo ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-icon">🔬</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Select a Sales Order to view QC status</div>
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {detail.error instanceof Error
              ? detail.error.message
              : 'Could not load SO QC status. Try again.'}
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
              <span style={{ marginLeft: 12 }}>
                <SoStatusBadge status={detail.data.so.status as SoStatus} />
              </span>
            </div>
            <div className="text3" style={{ fontSize: 12 }}>
              SO Date: {fmtDate(detail.data.so.soDate)}
              {detail.data.so.dueDate ? ` · Due: ${fmtDate(detail.data.so.dueDate)}` : ''}
              {detail.data.so.type ? ` · Type: ${detail.data.so.type}` : ''}
            </div>
          </div>

          <SummaryStrip lines={detail.data.lines} />

          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Ln</th>
                    {/* POL — the CUSTOMER's own line number off their purchase
                        order, beside (never instead of) our SO line number. */}
                    <th style={{ width: 50, color: 'var(--purple)' }}>POL</th>
                    <th style={{ width: 100 }}>Item Code</th>
                    <th>Item Name</th>
                    <th style={{ width: 40 }}>Order Qty</th>
                    <th style={{ minWidth: 240 }}>QC Stages (in JC)</th>
                    <th style={{ width: 80 }}>Incoming QC</th>
                    <th style={{ width: 60 }}>Docs</th>
                    <th style={{ width: 90 }}>Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={TABLE_COLS} className="empty-state">
                        No lines on this SO.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {detail.data.lines.map((l) => (
                        <LineRow key={l.soLineId} l={l} />
                      ))}
                      <TotalRow lines={detail.data.lines} />
                    </>
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

function StatusPill({ done, total }: { done: number; total: number }): React.JSX.Element {
  if (total === 0) return <span className="text3">—</span>;
  const cls = done >= total ? 'b-green' : 'b-amber';
  const icon = done >= total ? '✅' : '⏳';
  return (
    <span className={`badge ${cls}`}>
      {icon} {done}/{total}
    </span>
  );
}

function StageOpRow({ op }: { op: SoQcStageOp }): React.JSX.Element {
  const countColor =
    op.status === 'passed' || op.status === 'passed_rej' || op.status === 'in_progress'
      ? 'var(--green)'
      : 'var(--text3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>
        {stageIcon(op.status)}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{op.operation}</span>
      <span className="mono fw-700" style={{ fontSize: 11, color: countColor, whiteSpace: 'nowrap' }}>
        {op.accepted}/{op.orderQty}
      </span>
      {op.rejected > 0 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red2)', marginLeft: 2 }}>
          {op.rejected} Rejected
        </span>
      ) : null}
      {op.pending > 0 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber2)', marginLeft: 2 }}>
          {op.pending} QC Pending
        </span>
      ) : null}
      {op.attempts > 1 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber2)', marginLeft: 2 }}>
          {op.attempts} attempts
        </span>
      ) : null}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }): React.JSX.Element {
  const color = pctColor(pct);
  return (
    <>
      <div
        style={{
          height: 6,
          width: 60,
          background: 'var(--bg3)',
          borderRadius: 3,
          overflow: 'hidden',
          display: 'inline-block',
          verticalAlign: 'middle',
          marginRight: 6,
        }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
      <span className="mono fw-700" style={{ color }}>
        {pct}%
      </span>
    </>
  );
}

function LineRow({ l }: { l: SoQcLine }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = l.grnDetail.length > 0 || l.tpiDetail.length > 0 || l.docDetail.length > 0;

  return (
    <>
      <tr
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <td className="fw-700">{l.lineNo}</td>
        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {l.clientPoLineNo ?? '—'}
        </td>
        <td className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(l.itemCode, l.itemRevision)}
        </td>
        <td>{l.partName ?? '—'}</td>
        <td className="mono fw-700">{l.orderQty}</td>

        {!l.hasAnyQc ? (
          <>
            <td style={{ color: 'var(--amber2)', fontWeight: 700, fontSize: 11 }}>
              ⚠ No QC stage defined for this line
            </td>
            <td className="text3">—</td>
            <td className="text3">—</td>
            <td className="text3">—</td>
            <td>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>— N/A</span>
            </td>
          </>
        ) : (
          <>
            <td style={{ verticalAlign: 'top' }}>
              {l.jcQc.length === 0 ? (
                <span className="text3" style={{ fontSize: 11 }}>
                  —
                </span>
              ) : (
                l.jcQc.map((jd, ji) => (
                  <div key={jd.jobCardId}>
                    <div
                      className="mono fw-700"
                      style={{
                        fontSize: 11,
                        color: 'var(--cyan)',
                        padding: '3px 0 2px',
                        marginTop: ji > 0 ? 4 : 0,
                        borderBottom: '1px dashed var(--border)',
                      }}
                    >
                      {jd.jcCode}
                    </div>
                    {jd.ops.map((op) => (
                      <StageOpRow key={op.opSeq} op={op} />
                    ))}
                  </div>
                ))
              )}
            </td>
            <td style={{ verticalAlign: 'middle' }}>
              <StatusPill done={l.grnDone} total={l.grnTotal} />
            </td>
            <td style={{ verticalAlign: 'middle' }}>
              <StatusPill done={l.docUploaded} total={l.docCount} />
            </td>
            <td style={{ verticalAlign: 'middle' }}>
              <ProgressBar pct={l.overallPct} />
            </td>
          </>
        )}
      </tr>

      {hasDetail && open ? (
        <tr>
          <td colSpan={TABLE_COLS} style={{ padding: 0 }}>
            <div style={{ background: 'var(--bg)', borderTop: '2px solid var(--cyan)', padding: 16 }}>
              {l.grnDetail.length > 0 ? <GrnDetailTable l={l} /> : null}
              {l.tpiDetail.length > 0 ? <TpiDetailTable l={l} /> : null}
              {l.docDetail.length > 0 ? <DocDetailTable l={l} /> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailHeading({ color, children }: { color: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        marginBottom: 8,
        color,
      }}
    >
      {children}
    </div>
  );
}

function GrnDetailTable({ l }: { l: SoQcLine }): React.JSX.Element {
  return (
    <>
      <DetailHeading color="var(--amber)">📥 Incoming Material QC</DetailHeading>
      <table className="innovic-table" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>GRN No.</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item</th>
            <th>Vendor</th>
            <th>Received</th>
            <th>Accepted</th>
            <th>Rejected</th>
            <th>QC Pending</th>
            <th>QC Status</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {l.grnDetail.map((g, i) => (
            <tr key={`${g.grnNo}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {g.grnNo}
              </td>
              <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                {g.clientPoLineNo ?? '—'}
              </td>
              {/* Item code is THE main thing — strong mono, CODE/REV (ADR-177). */}
              <td className="mono fw-700" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
                {itemCodeWithRev(g.itemCode, g.itemRevision)}
              </td>
              <td>{g.vendorName ?? '—'}</td>
              <td className="mono">{g.receivedQty}</td>
              <td className="mono fw-700" style={{ color: 'var(--green2)' }}>
                {g.accepted}
              </td>
              <td
                className="mono"
                style={g.rejected > 0 ? { color: 'var(--red2)', fontWeight: 700 } : undefined}
              >
                {g.rejected}
              </td>
              <td
                className="mono"
                style={g.pending > 0 ? { color: 'var(--amber2)', fontWeight: 700 } : undefined}
              >
                {g.pending}
              </td>
              <td>
                <span className={`badge ${g.status === 'done' ? 'b-green' : 'b-amber'}`}>
                  {g.status === 'done' ? '✅ Inspected' : '⏳ QC Pending'}
                </span>
              </td>
              <td>
                {g.qcReportPath ? (
                  <QcReportLink path={g.qcReportPath} name={g.qcReportName} label="Report" />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TpiDetailTable({ l }: { l: SoQcLine }): React.JSX.Element {
  return (
    <>
      <DetailHeading color="var(--purple)">🔍 TPI (Third Party Inspection)</DetailHeading>
      <table className="innovic-table" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>JC No.</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Organisation</th>
            <th>Inspector Name</th>
            <th>Accepted</th>
            <th>Rejected</th>
            <th>TPI Date</th>
            <th>TPI Status</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {l.tpiDetail.map((t, i) => (
            <tr key={`${t.jcCode}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {t.jcCode}
              </td>
              {/* POL comes off the SO line this TPI sub-table is nested under —
                  the TPI row itself carries no line of its own. */}
              <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                {l.clientPoLineNo ?? '—'}
              </td>
              <td>{t.organization ?? '—'}</td>
              <td>{t.inspector ?? '—'}</td>
              <td className="mono fw-700" style={{ color: 'var(--green2)' }}>
                {t.accepted}
              </td>
              <td
                className="mono"
                style={t.rejected > 0 ? { color: 'var(--red2)', fontWeight: 700 } : undefined}
              >
                {t.rejected}
              </td>
              <td>{fmtDate(t.date)}</td>
              <td>
                <span className={`badge ${t.status === 'passed' ? 'b-green' : 'b-amber'}`}>
                  {t.status === 'passed' ? '✅ Accepted' : '⚠ Partly Accepted'}
                </span>
              </td>
              <td>
                {t.qcReportPath ? (
                  <QcReportLink path={t.qcReportPath} name={t.qcReportName} label="Report" />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DocDetailTable({ l }: { l: SoQcLine }): React.JSX.Element {
  return (
    <>
      <DetailHeading color="var(--teal)">📄 QC Documents</DetailHeading>
      <table className="innovic-table" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>JC No.</th>
            <th>Document Type</th>
            <th>File Name</th>
            <th>Doc Status</th>
          </tr>
        </thead>
        <tbody>
          {l.docDetail.map((d, i) => (
            <tr key={`${d.jcCode}-${d.docType}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {d.jcCode}
              </td>
              <td>{d.docType}</td>
              <td className="text3" style={{ fontSize: 11 }}>
                {d.fileName ?? '—'}
              </td>
              <td>
                <span className={`badge ${d.uploaded ? 'b-green' : 'b-red'}`}>
                  {d.uploaded ? '✅ Uploaded' : '❌ Missing'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TotalRow({ lines }: { lines: SoQcLine[] }): React.JSX.Element {
  const t = lines.reduce(
    (a, l) => ({
      qcOps: a.qcOps + l.qcOpsTotal,
      qcPassed: a.qcPassed + l.qcOpsPassed,
      jcCount: a.jcCount + l.jcQc.length,
      grn: a.grn + l.grnTotal,
      grnDone: a.grnDone + l.grnDone,
      tpi: a.tpi + l.tpiCount,
      docs: a.docs + l.docCount,
      docsUp: a.docsUp + l.docUploaded,
    }),
    { qcOps: 0, qcPassed: 0, jcCount: 0, grn: 0, grnDone: 0, tpi: 0, docs: 0, docsUp: 0 },
  );
  const totItems = t.qcOps + t.grn + t.tpi + t.docs;
  const doneItems = t.qcPassed + t.grnDone + t.tpi + t.docsUp;
  const totPct = totItems > 0 ? Math.round((doneItems / totItems) * 100) : 0;
  const color = (done: number, total: number): string =>
    total > 0 && done >= total ? 'var(--green)' : 'var(--amber)';

  return (
    <tr style={{ background: 'var(--bg4)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>
      <td colSpan={5} style={{ fontSize: 11, color: 'var(--text2)' }}>
        Total ({lines.length} lines)
      </td>
      <td style={{ fontSize: 11, color: 'var(--text2)' }}>
        {t.qcOps} QC stages across {t.jcCount} JCs
      </td>
      <td>
        <span className="mono" style={{ color: color(t.grnDone, t.grn) }}>
          {t.grnDone}/{t.grn}
        </span>
      </td>
      <td>
        <span className="mono" style={{ color: color(t.docsUp, t.docs) }}>
          {t.docsUp}/{t.docs}
        </span>
      </td>
      <td>
        <ProgressBar pct={totPct} />
      </td>
    </tr>
  );
}

function SummaryStrip({ lines }: { lines: SoQcLine[] }): React.JSX.Element {
  const t = lines.reduce(
    (a, l) => ({
      qcOps: a.qcOps + l.qcOpsTotal,
      qcPassed: a.qcPassed + l.qcOpsPassed,
      grn: a.grn + l.grnTotal,
      grnDone: a.grnDone + l.grnDone,
      docs: a.docs + l.docCount,
      docsUp: a.docsUp + l.docUploaded,
    }),
    { qcOps: 0, qcPassed: 0, grn: 0, grnDone: 0, docs: 0, docsUp: 0 },
  );
  const allDone = (done: number, total: number): string =>
    total > 0 && done >= total ? 'var(--green)' : 'var(--amber)';
  return (
    <div style={{ marginBottom: 16 }}>
      <StatStrip
        items={[
          {
            key: 'qc-ops',
            label: 'QC Ops',
            count: `${t.qcPassed}/${t.qcOps}`,
            sub: 'Accepted',
            color: allDone(t.qcPassed, t.qcOps),
          },
          {
            key: 'incoming-qc',
            label: 'Incoming QC',
            count: `${t.grnDone}/${t.grn}`,
            sub: 'Completed',
            color: allDone(t.grnDone, t.grn),
          },
          {
            key: 'documents',
            label: 'Documents',
            count: `${t.docsUp}/${t.docs}`,
            sub: 'Uploaded',
            color: allDone(t.docsUp, t.docs),
          },
        ]}
      />
    </div>
  );
}
