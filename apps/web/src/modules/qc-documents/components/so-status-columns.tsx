// SO QC Status columns (ADR-199 fit table, tableKey qcDocsStatus). Ported from
// the so-qc-status module. Default-visible set per the brief: Ln · Item Code ·
// QC Stages · Incoming QC · Docs · Overall; POL / Item Name / Order Qty ride in
// the ▸ expand by default. The per-column totals feed the engine's showTotals
// footer (replacing the hand-written TotalRow).

import type { SoQcLine, SoQcStageOp } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

/** Ids hidden into the ▸ detail by default. */
export const SO_STATUS_DETAIL_IDS = ['pol', 'item_name', 'order_qty'];

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
        style={{ fontSize: 11, color: countColor, whiteSpace: 'nowrap' }}
      >
        {op.accepted}/{op.orderQty}
      </span>
      {op.rejected > 0 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red2)', marginLeft: 2 }}>
          {op.rejected} Deviated
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

function StagesCell({ l }: { l: SoQcLine }): React.JSX.Element {
  if (!l.hasAnyQc) {
    return (
      <span style={{ color: 'var(--amber2)', fontWeight: 700, fontSize: 11 }}>
        ⚠ No QC stage defined for this line
      </span>
    );
  }
  if (l.jcQc.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  return (
    <div style={{ textAlign: 'left' }}>
      {l.jcQc.map((jd, ji) => (
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
      ))}
    </div>
  );
}

const totColor = (done: number, total: number): string =>
  total > 0 && done >= total ? 'var(--green)' : 'var(--amber)';

export function buildSoStatusColumns(): DataTableColumn<SoQcLine>[] {
  return [
    {
      id: 'ln',
      header: 'Ln',
      nowrap: true,
      className: 'fw-700',
      render: (l) => l.lineNo,
    },
    {
      id: 'pol',
      header: 'POL',
      label: 'POL',
      nowrap: true,
      headColor: 'var(--purple)',
      render: (l) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {l.clientPoLineNo ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_code',
      kind: 'code',
      header: 'Item Code',
      nowrap: true,
      className: 'td-code mono fw-700',
      render: (l) => itemCodeWithRev(l.itemCode, l.itemRevision),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      label: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (l) => l.partName ?? '—',
      title: (l) => l.partName ?? '',
    },
    {
      id: 'order_qty',
      kind: 'num',
      header: 'Order Qty',
      label: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (l) => l.orderQty,
    },
    {
      id: 'qc_stages',
      header: 'QC Stages (in JC)',
      align: 'left',
      minWidth: 240,
      filterable: false,
      render: (l) => <StagesCell l={l} />,
      total: (rows) => {
        const qcOps = rows.reduce((a, l) => a + l.qcOpsTotal, 0);
        const jcCount = rows.reduce((a, l) => a + l.jcQc.length, 0);
        return (
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>
            {qcOps} QC stages across {jcCount} JCs
          </span>
        );
      },
    },
    {
      id: 'incoming_qc',
      kind: 'badge',
      header: 'Incoming QC',
      nowrap: true,
      render: (l) =>
        l.hasAnyQc ? (
          <StatusPill done={l.grnDone} total={l.grnTotal} />
        ) : (
          <span className="text3">—</span>
        ),
      total: (rows) => {
        const done = rows.reduce((a, l) => a + l.grnDone, 0);
        const tot = rows.reduce((a, l) => a + l.grnTotal, 0);
        return (
          <span className="mono" style={{ color: totColor(done, tot) }}>
            {done}/{tot}
          </span>
        );
      },
    },
    {
      id: 'docs',
      kind: 'badge',
      header: 'Docs',
      nowrap: true,
      render: (l) =>
        l.hasAnyQc ? (
          <StatusPill done={l.docUploaded} total={l.docCount} />
        ) : (
          <span className="text3">—</span>
        ),
      total: (rows) => {
        const up = rows.reduce((a, l) => a + l.docUploaded, 0);
        const tot = rows.reduce((a, l) => a + l.docCount, 0);
        return (
          <span className="mono" style={{ color: totColor(up, tot) }}>
            {up}/{tot}
          </span>
        );
      },
    },
    {
      id: 'overall',
      header: 'Overall',
      nowrap: true,
      filterable: false,
      render: (l) =>
        l.hasAnyQc ? (
          <ProgressBar pct={l.overallPct} />
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>— N/A</span>
        ),
      total: (rows) => {
        const totItems = rows.reduce(
          (a, l) => a + l.qcOpsTotal + l.grnTotal + l.tpiCount + l.docCount,
          0,
        );
        const doneItems = rows.reduce(
          (a, l) => a + l.qcOpsPassed + l.grnDone + l.tpiCount + l.docUploaded,
          0,
        );
        const pct = totItems > 0 ? Math.round((doneItems / totItems) * 100) : 0;
        return <ProgressBar pct={pct} />;
      },
    },
  ];
}
