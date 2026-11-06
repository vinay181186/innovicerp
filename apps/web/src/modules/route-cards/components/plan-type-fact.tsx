import type { RouteCardDetail } from '@innovic/shared';

/** Plan Type is how the item is normally made — the same choice SO Planning
 *  asks per plan, so it reads in Planning's colours.
 *
 *  Built from ClusterFact's own classes rather than ClusterFact itself for ONE
 *  reason: an old Buy card carries a note under the value, and ClusterFact has
 *  no slot that can wrap — its value is one clipped line and its `after` chip
 *  never shrinks, so a 50-character note there would spill out of the cell.
 *  The third child takes the full cell width (the cell is `flex-wrap`) and
 *  wraps inside it. */
export function PlanTypeFact({
  planType,
}: {
  planType: RouteCardDetail['planType'];
}): React.JSX.Element {
  const color =
    planType === 'full_outsource'
      ? 'var(--purple)'
      : planType === 'direct_purchase'
        ? 'var(--green)'
        : 'var(--cyan)';
  const label =
    planType === 'full_outsource'
      ? '📦 Full Outsource'
      : planType === 'direct_purchase'
        ? '🛒 Buy'
        : '🏭 Manufacture';
  return (
    <div className="cl-fact">
      <span className="cl-fact-k">Plan Type</span>
      <span className="cl-fact-v" style={{ color, fontWeight: 700 }}>
        {label}
      </span>
      {planType === 'direct_purchase' ? (
        // ADR-171: the tile is gone from the form; the value survives on old
        // cards so the user knows where the flag now lives.
        <span
          className="text3"
          style={{ flexBasis: '100%', fontSize: 'var(--fs-xs)', textAlign: 'right' }}
        >
          Old setting — set the item&apos;s Source to Buy instead.
        </span>
      ) : null}
    </div>
  );
}
