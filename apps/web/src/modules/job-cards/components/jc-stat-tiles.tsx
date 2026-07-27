// Canonical JC summary tiles — the 6 stat cards (Item · SO/WO · Order Qty ·
// Overall Status · Completed Qty · Pending Qty). Extracted verbatim from
// jc-status-content so the JC VIEW and the JC EDIT page share ONE header format
// (same look, only the mode differs). Presentation-only; no behaviour.
import type { JcOpEnriched, JobCardListItem } from '@innovic/shared';
import { JcStatusBadge } from './jc-status-badge';

const cardStyle = (bg: string, brd: string): React.CSSProperties => ({
  background: bg,
  border: `1px solid ${brd}`,
  borderRadius: 8,
  padding: 12,
});
const lblStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  marginBottom: 4,
};

export function JcStatTiles({
  jc,
  ops,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
}): React.JSX.Element {
  const totalOps = ops.length;
  const doneOps = ops.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
      <div style={cardStyle('var(--bg3)', 'var(--border)')}>
        <div style={lblStyle}>Item</div>
        <div className="fw-700">{jc.itemName || jc.itemCode}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{jc.itemCode}</div>
      </div>
      <div style={cardStyle('var(--bg3)', 'var(--border)')}>
        <div style={lblStyle}>SO / WO</div>
        <div className="fw-700 mono">{jc.sourceLink?.code ?? '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>
          Line: <b>{jc.sourceLink?.lineNo ?? '1'}</b>
          {jc.clientPoLineNo ? (
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}> · CPO Ln: {jc.clientPoLineNo}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>Due: {jc.dueDate ?? '—'}</div>
        {jc.remarks ? (
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            Remarks: <span style={{ color: 'var(--text)' }}>{jc.remarks}</span>
          </div>
        ) : null}
      </div>
      <div style={cardStyle('var(--bg3)', 'var(--border)')}>
        <div style={lblStyle}>Order Qty</div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{jc.orderQty}</div>
        <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {jc.priority === 'high' ? 'High' : 'Normal'}
        </span>
      </div>
      <div style={cardStyle('var(--bg3)', 'var(--border)')}>
        <div style={lblStyle}>Overall Status</div>
        <div style={{ marginBottom: 6 }}>
          <JcStatusBadge status={jc.computedStatus} />
        </div>
        <div className="prog-wrap">
          <div className="prog-bar" style={{ width: `${pct}%`, background: 'var(--blue)' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
          {doneOps}/{totalOps} ops · {pct}%
        </div>
      </div>
      <div style={cardStyle('var(--green3)', 'var(--green2)')}>
        <div style={{ ...lblStyle, color: 'var(--green2)', marginBottom: 6 }}>Completed Qty</div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{completed}</div>
        <div style={{ fontSize: 11, color: 'var(--green2)' }}>of {jc.orderQty} ordered</div>
      </div>
      <div
        style={cardStyle(
          pending > 0 ? 'var(--red3)' : 'var(--green3)',
          pending > 0 ? 'var(--red2)' : 'var(--green2)',
        )}
      >
        <div style={{ ...lblStyle, color: pending > 0 ? 'var(--red2)' : 'var(--green2)', marginBottom: 6 }}>Pending Qty</div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: pending > 0 ? 'var(--red)' : 'var(--green)' }}>
          {pending}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{pending === 0 ? '✓ All complete' : 'pcs remaining'}</div>
      </div>
    </div>
  );
}
