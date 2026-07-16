// SO QC Status (legacy renderSOQCStatus L18347). SO selector -> rich per-line
// QC-stage report: a "QC Stages (in JC)" cell (per-JC, per-op ✅/⏳/❌ rows with
// accepted/orderQty, (rej), [pending], [Nx] badges), Incoming-QC / TPI / Docs
// pills, an overall % progress bar, an expandable detail row (Incoming Material
// QC / TPI / QC Documents sub-tables), and a TOTAL footer. Legacy chrome.
//
// Not ported (no server-side source — do NOT approximate):
//   • QC Documents sub-table "Action" column (legacy L18579 = 5 cols; ours 4).
//     Legacy links d.url (fileData/downloadUrl); soQcDocDetailSchema carries no
//     path/url field, so the column would be permanently empty. Needs the doc
//     download path on the API before it can be rendered.
//
// The SO selector is fed by sales-orders' list hook (limit 20), NOT by this
// module's own uncapped /so-qc-status list endpoint — see report/ISSUE note.

import type { SoQcLine, SoQcStageOp, SoStatus } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoQcStatus } from '../api';

const searchSchema = z.object({ so: z.string().uuid().optional() });

export const soQcStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-qc-status',
  validateSearch: searchSchema,
  component: SoQcStatusPage,
});

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

function SoQcStatusPage(): React.JSX.Element {
  const search = soQcStatusRoute.useSearch();
  const navigate = soQcStatusRoute.useNavigate();
  const [soSearch, setSoSearch] = useState('');
  const soList = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const detail = useSoQcStatus(search.so);

  function selectSo(id: string | null): void {
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
        <div style={{ minWidth: 300 }}>
          <SearchableSelect
            id="so-qc-select"
            value={search.so ?? null}
            onChange={selectSo}
            onSearch={setSoSearch}
            loading={soList.isFetching}
            placeholder="🔍 Select SO — type code or customer…"
            options={(soList.data?.items ?? []).map((s) => ({
              id: s.id,
              code: s.code,
              name: s.customerName ?? '',
            }))}
          />
        </div>
      </div>

      {!search.so ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-icon">🔬</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Select a Sales Order to view QC status
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              This report shows all QC stages for each SO line in table format
            </div>
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
              <span style={{ marginLeft: 12 }}>
                <SoStatusBadge status={detail.data.so.status as SoStatus} />
              </span>
            </div>
            <div className="text3" style={{ fontSize: 12 }}>
              SO Date: {detail.data.so.soDate ?? '—'}
              {detail.data.so.dueDate ? ` | Due: ${detail.data.so.dueDate}` : ''}
              {detail.data.so.type ? ` | Type: ${detail.data.so.type}` : ''}
            </div>
          </div>

          <SummaryStrip lines={detail.data.lines} />

          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Line</th>
                    <th style={{ width: 100 }}>Item Code</th>
                    <th>Item Name</th>
                    <th style={{ textAlign: 'center', width: 40 }}>Qty</th>
                    <th style={{ minWidth: 240 }}>QC Stages (in JC)</th>
                    <th style={{ textAlign: 'center', width: 80 }}>Incoming QC</th>
                    <th style={{ textAlign: 'center', width: 60 }}>TPI</th>
                    <th style={{ textAlign: 'center', width: 60 }}>Docs</th>
                    <th style={{ textAlign: 'center', width: 90 }}>Overall</th>
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
          <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
            💡 QC stages from JC shown directly. Click any line row to expand Incoming QC, TPI &
            Document detail tables. ⚠ = No QC stage defined.
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({
  done,
  total,
}: {
  done: number;
  total: number;
}): React.JSX.Element {
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
      <span
        className="mono fw-700"
        style={{ fontSize: 10, color: countColor, whiteSpace: 'nowrap' }}
      >
        {op.accepted}/{op.orderQty}
      </span>
      {op.rejected > 0 ? (
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--red)', marginLeft: 2 }}>
          ({op.rejected} rej)
        </span>
      ) : null}
      {op.pending > 0 ? (
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--amber)', marginLeft: 2 }}>
          [{op.pending} pending]
        </span>
      ) : null}
      {op.attempts > 1 ? (
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--amber)', marginLeft: 2 }}>
          [{op.attempts}x]
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
        <td className="td-ctr fw-700">{l.lineNo}</td>
        <td className="td-code mono fw-700" style={{ color: 'var(--cyan)' }}>
          {l.itemCode ?? '—'}
        </td>
        <td>{l.partName ?? '—'}</td>
        <td className="td-ctr mono fw-700">{l.orderQty}</td>

        {!l.hasAnyQc ? (
          <>
            <td style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>
              ⚠ No QC stage defined for this line
            </td>
            <td className="td-ctr text3">—</td>
            <td className="td-ctr text3">—</td>
            <td className="td-ctr text3">—</td>
            <td className="td-ctr">
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)' }}>— N/A</span>
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
                        fontSize: 10,
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
            <td className="td-ctr" style={{ verticalAlign: 'middle' }}>
              <StatusPill done={l.grnDone} total={l.grnTotal} />
            </td>
            <td className="td-ctr" style={{ verticalAlign: 'middle' }}>
              <StatusPill done={l.tpiCount} total={l.tpiCount} />
            </td>
            <td className="td-ctr" style={{ verticalAlign: 'middle' }}>
              <StatusPill done={l.docUploaded} total={l.docCount} />
            </td>
            <td className="td-ctr" style={{ verticalAlign: 'middle' }}>
              <ProgressBar pct={l.overallPct} />
            </td>
          </>
        )}
      </tr>

      {hasDetail && open ? (
        <tr>
          <td colSpan={TABLE_COLS} style={{ padding: 0 }}>
            <div
              style={{
                background: 'var(--bg)',
                borderTop: '2px solid var(--cyan)',
                padding: 16,
              }}
            >
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

function DetailHeading({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
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
            <th>GRN No</th>
            <th>Item</th>
            <th>Vendor</th>
            <th style={{ textAlign: 'center' }}>Received</th>
            <th style={{ textAlign: 'center' }}>Accepted</th>
            <th style={{ textAlign: 'center' }}>Rejected</th>
            <th style={{ textAlign: 'center' }}>Pending</th>
            <th style={{ textAlign: 'center' }}>Status</th>
            <th style={{ textAlign: 'center' }}>Report</th>
          </tr>
        </thead>
        <tbody>
          {l.grnDetail.map((g, i) => (
            <tr key={`${g.grnNo}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {g.grnNo}
              </td>
              <td>{g.itemCode ?? '—'}</td>
              <td>{g.vendorName ?? '—'}</td>
              <td className="td-ctr mono">{g.receivedQty}</td>
              <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                {g.accepted}
              </td>
              <td
                className="td-ctr mono"
                style={g.rejected > 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined}
              >
                {g.rejected}
              </td>
              <td
                className="td-ctr mono"
                style={g.pending > 0 ? { color: 'var(--amber)', fontWeight: 700 } : undefined}
              >
                {g.pending}
              </td>
              <td className="td-ctr">
                <span className={`badge ${g.status === 'done' ? 'b-green' : 'b-amber'}`}>
                  {g.status === 'done' ? '✅ Accepted' : '⏳ Pending'}
                </span>
              </td>
              <td className="td-ctr">
                {g.qcReportPath ? (
                  <QcReportLink path={g.qcReportPath} name={g.qcReportName} label="View" />
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
            <th>JC No</th>
            <th>Organization</th>
            <th>Inspector</th>
            <th style={{ textAlign: 'center' }}>Accepted</th>
            <th style={{ textAlign: 'center' }}>Rejected</th>
            <th style={{ textAlign: 'center' }}>Date</th>
            <th style={{ textAlign: 'center' }}>Status</th>
            <th style={{ textAlign: 'center' }}>Report</th>
          </tr>
        </thead>
        <tbody>
          {l.tpiDetail.map((t, i) => (
            <tr key={`${t.jcCode}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {t.jcCode}
              </td>
              <td>{t.organization ?? '—'}</td>
              <td>{t.inspector ?? '—'}</td>
              <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                {t.accepted}
              </td>
              <td
                className="td-ctr mono"
                style={t.rejected > 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined}
              >
                {t.rejected}
              </td>
              <td className="td-ctr">{t.date ?? '—'}</td>
              <td className="td-ctr">
                <span className={`badge ${t.status === 'passed' ? 'b-green' : 'b-amber'}`}>
                  {t.status === 'passed' ? '✅ Passed' : '⚠ Partial'}
                </span>
              </td>
              <td className="td-ctr">
                {t.qcReportPath ? (
                  <QcReportLink path={t.qcReportPath} name={t.qcReportName} label="View" />
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
      <DetailHeading color="var(--teal, #0d9488)">📄 QC Documents</DetailHeading>
      <table className="innovic-table" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>JC No</th>
            <th>Document Type</th>
            <th>File Name</th>
            <th style={{ textAlign: 'center' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {l.docDetail.map((d, i) => (
            <tr key={`${d.jcCode}-${d.docType}-${i}`}>
              <td className="mono" style={{ color: 'var(--cyan)' }}>
                {d.jcCode}
              </td>
              <td>{d.docType}</td>
              <td className="text3" style={{ fontSize: 10 }}>
                {d.fileName ?? '—'}
              </td>
              <td className="td-ctr">
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
      <td colSpan={4} style={{ textAlign: 'right', fontSize: 11, color: 'var(--text2)' }}>
        TOTAL ({lines.length} lines)
      </td>
      <td style={{ fontSize: 11, color: 'var(--text2)' }}>
        {t.qcOps} QC stages across {t.jcCount} JCs
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: color(t.grnDone, t.grn) }}>
          {t.grnDone}/{t.grn}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: t.tpi > 0 ? 'var(--green)' : 'var(--text3)' }}>
          {t.tpi}/{t.tpi}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: color(t.docsUp, t.docs) }}>
          {t.docsUp}/{t.docs}
        </span>
      </td>
      <td className="td-ctr">
        <ProgressBar pct={totPct} />
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
      docsUp: a.docsUp + l.docUploaded,
      tpi: a.tpi + l.tpiCount,
    }),
    { qcOps: 0, qcPassed: 0, pendingOps: 0, grn: 0, grnDone: 0, docs: 0, docsUp: 0, tpi: 0 },
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
      <Card
        label="QC OPS"
        value={`${t.qcPassed}/${t.qcOps}`}
        sub="passed"
        color={allDone(t.qcPassed, t.qcOps)}
      />
      <Card
        label="INCOMING QC"
        value={`${t.grnDone}/${t.grn}`}
        sub="done"
        color={allDone(t.grnDone, t.grn)}
      />
      <Card
        label="QC PENDING"
        value={t.pendingOps}
        sub="ops"
        color={t.pendingOps > 0 ? 'var(--red)' : 'var(--green)'}
      />
      <Card
        label="DOCUMENTS"
        value={`${t.docsUp}/${t.docs}`}
        sub="uploaded"
        color={allDone(t.docsUp, t.docs)}
      />
      <Card
        label="TPI"
        value={`${t.tpi}/${t.tpi}`}
        sub="done"
        color={t.tpi > 0 ? 'var(--green)' : 'var(--text3)'}
      />
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
