// SO QC Status — the ▸ expand detail tables (Incoming Material QC, TPI, QC
// Documents). Ported from the so-qc-status module into the QC Docs screen's own
// module as part of the ADR-199 conversion (the SO Status tab now lives here as
// a fit table). These nested detail tables stay as compact raw tables inside the
// expand; the main register became a <DataTable>.

import type { SoQcLine } from '@innovic/shared';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

function DetailHeading({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color }}>{children}</div>;
}

export function SoStatusExpanded({ l }: { l: SoQcLine }): React.JSX.Element {
  return (
    <div style={{ background: 'var(--bg)', borderTop: '2px solid var(--cyan)', padding: 16 }}>
      {l.grnDetail.length > 0 ? <GrnDetailTable l={l} /> : null}
      {l.tpiDetail.length > 0 ? <TpiDetailTable l={l} /> : null}
      {l.docDetail.length > 0 ? <DocDetailTable l={l} /> : null}
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
            <th className="th-num">Received</th>
            <th className="th-num">Accepted</th>
            <th className="th-num">Deviated</th>
            <th className="th-num">QC Pending</th>
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
              <td className="mono td-num">{g.receivedQty}</td>
              <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                {g.accepted}
              </td>
              <td
                className="mono td-num"
                style={g.rejected > 0 ? { color: 'var(--red2)', fontWeight: 700 } : undefined}
              >
                {g.rejected}
              </td>
              <td
                className="mono td-num"
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
            <th className="th-num">Accepted</th>
            <th className="th-num">Deviated</th>
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
              {/* POL comes off the SO line this TPI sub-table is nested under. */}
              <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                {l.clientPoLineNo ?? '—'}
              </td>
              <td>{t.organization ?? '—'}</td>
              <td>{t.inspector ?? '—'}</td>
              <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                {t.accepted}
              </td>
              <td
                className="mono td-num"
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
