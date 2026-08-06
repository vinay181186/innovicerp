// Canonical JC summary tiles — the 6 stat cards (Item · SO/WO · Order Qty ·
// Overall Status · Completed Qty · Pending Qty). Extracted verbatim from
// jc-status-content so the JC VIEW and the JC EDIT page share ONE header format
// (same look, only the mode differs). Presentation-only; no behaviour.
import type { JcOpEnriched, JobCardRmAvailable, JobCardListItem } from '@innovic/shared';
import { JcStatusBadge } from './jc-status-badge';

const cardStyle = (bg: string, brd: string): React.CSSProperties => ({
  background: bg,
  border: `1px solid ${brd}`,
  borderRadius: 8,
  padding: 12,
  // With a 7th tile the strip is tight. `minWidth: 0` lets a card shrink below
  // its content width, and wrapping keeps long item names inside the box —
  // without both, the grid pushes past the viewport and adds a horizontal
  // scrollbar to the whole page.
  minWidth: 0,
  overflowWrap: 'anywhere',
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
  rmAvailable,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  /** ADR-103 client material still workable on this JWSO Job Card. Null/absent
   *  on SO-sourced and pre-cutover Job Cards — the tile is then not rendered
   *  at all and the strip stays at its original 6 columns. */
  rmAvailable?: JobCardRmAvailable | null;
}): React.JSX.Element {
  const totalOps = ops.length;
  const doneOps = ops.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);
  // Order Qty and RM Avail are single numbers, so they get the narrow columns;
  // Item and SO/WO carry the most text and keep the width. Every track is
  // minmax(0, …) so the strip never overflows into a page scrollbar.
  const cols = rmAvailable
    ? '1.5fr 1.35fr 0.62fr 0.78fr 1.15fr 0.9fr 0.9fr'
    : 'repeat(6, 1fr)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: cols
          .split(' ')
          .map((c) => (c.startsWith('repeat') ? 'repeat(6, minmax(0, 1fr))' : `minmax(0, ${c})`))
          .join(' '),
        gap: 10,
        marginBottom: 16,
      }}
    >
      <div style={cardStyle('var(--bg3)', 'var(--border)')}>
        <div style={lblStyle}>Item</div>
        <div className="fw-700">{jc.itemName || jc.itemCode}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{jc.itemCode}</div>
        {/* Route Card reference (the item's active route card + current revision). */}
        <div style={{ fontSize: 11, marginTop: 3 }}>
          {jc.routeCardCode ? (
            <>
              <span style={{ color: 'var(--text3)' }}>Route Card: </span>
              <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>{jc.routeCardCode}</span>
              {jc.routeCardRevision != null ? (
                <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>Rev {jc.routeCardRevision}</span>
              ) : null}
            </>
          ) : (
            <span style={{ color: 'var(--text3)' }}>Route Card: <span style={{ color: 'var(--amber)' }}>none</span></span>
          )}
        </div>
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
      {/* ADR-103 — client material still workable on this job card:
          issued to it MINUS what its first operation has already produced.
          Zero means nobody can start until more is issued. */}
      {rmAvailable ? (
        <div
          style={cardStyle(
            rmAvailable.availableQty > 0 ? 'var(--bg3)' : 'var(--red3)',
            rmAvailable.availableQty > 0 ? 'var(--border)' : 'var(--red2)',
          )}
          title={
            `Client material issued to this job card: ${rmAvailable.issuedQty}. ` +
            `Already produced on the first operation: ${rmAvailable.consumedQty}. ` +
            (rmAvailable.availableQty > 0
              ? `${rmAvailable.availableQty} can still be worked.`
              : 'Issue more client material from Party Material Issue to continue.')
          }
        >
          <div style={lblStyle}>RM Avail</div>
          <div
            className="mono"
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: rmAvailable.availableQty > 0 ? 'var(--cyan)' : 'var(--red)',
            }}
          >
            {rmAvailable.availableQty}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {rmAvailable.issuedQty} issued
          </div>
          {rmAvailable.availableQty === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>issue material</div>
          ) : null}
        </div>
      ) : null}
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
