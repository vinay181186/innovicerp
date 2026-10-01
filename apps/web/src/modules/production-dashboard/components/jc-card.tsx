// Open Job Card tile (legacy L3719-3799). A look-only WIDGET under ADR-199
// ("widgets are look-only exceptions") — the Open Job Cards grid is a set of
// cards, not the main Ready-to-process list, so it stays a card. Split out of
// routes/index.tsx (file-size rule); no behaviour change.

import type { ProductionDashboardJc } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

export function JcCard({ jc }: { jc: ProductionDashboardJc }): React.JSX.Element {
  const navigate = useNavigate();
  const pct = jc.totalOps > 0 ? Math.round((jc.doneOps / jc.totalOps) * 100) : 0;
  // Resolved once, with an empty fallback, so the card can tell a real item code
  // from the part-name stand-in it falls back to. Only a genuine code gets the
  // promoted treatment below; a part name is allowed to stay quiet.
  const itemCode = itemCodeWithRev(jc.itemCode, jc.itemRevision, '');
  // The whole card still opens Op Entry for this card, exactly as before; only
  // the JC number inside it now goes to the job card. An <a> cannot legally
  // contain another <a> — the browser silently breaks the nesting apart — so the
  // card becomes a clickable div with the same destination and the code becomes
  // the real link. Same shape as the Job Cards list (job-cards/routes/list.tsx),
  // where the band is a click handler and the code inside it is a <Link>.
  return (
    <div
      onClick={() => void navigate({ to: '/op-entry', search: { jc: jc.code } })}
      style={{
        display: 'block',
        padding: '10px 12px',
        background: 'var(--bg3)',
        borderRadius: 8,
        border: '1px solid var(--border)',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        {/* stopPropagation so the code wins over the card's own click: without
            it the card would navigate to Op Entry at the same moment the link
            navigates to the job card. `.cyan` keeps the colour, so only the
            browser's underline has to be undone inline. */}
        <Link
          to="/job-cards/$id"
          params={{ id: jc.jobCardId }}
          title="View job card status"
          className="mono fw-700 cyan"
          style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          {jc.code}
        </Link>
        {/* Legacy badge(jc.priority) (L3723): High→b-amber, Normal→b-grey */}
        <div style={{ display: 'flex', gap: 4 }}>
          <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
            {jc.priority === 'high' ? 'High' : 'Normal'}
          </span>
        </div>
      </div>
      <div
        className="text2"
        style={{
          fontSize: 11,
          marginBottom: 5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {/* The item code is the primary value on this card — it is how the part
            gets matched to its drawing — so it takes the darkest text token and
            the bold weight. When there is no code the line still falls back to
            the part name, and a name stays on the muted line colour. */}
        {itemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {itemCode}
          </span>
        ) : (
          (jc.itemName ?? '—')
        )}{' '}
        — <b>{jc.orderQty} pcs</b>
      </div>
      {/* Legacy progBar(pct,'#3b82f6') (L1972-1974, called L3728). The literal
          is a dark-theme blue → mapped to the nearest token, var(--blue).
          L3728 drops the bare `.prog-wrap` straight into a flex row where it
          has no width and collapses; legacy's other progBar-in-flex call site
          (L5133) wraps it in `flex:1`, which is applied here so the bar stays
          visible. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div className="prog-wrap">
            <div
              className="prog-bar"
              style={{ width: `${Math.min(100, pct)}%`, background: 'var(--blue)' }}
            />
          </div>
        </div>
        <span className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {pct}%
        </span>
      </div>
      {jc.dueDate ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
          Due: {fmtDate(jc.dueDate)}
        </div>
      ) : null}
    </div>
  );
}
