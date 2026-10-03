// What the ▸ row reveals under a Purchase Request (ADR-199 fit table). Carries
// the fields that do not earn a column of their own: POL, the SO/JC it was
// raised against, the operation, the estimated rate (price-gated), when it was
// approved, the purchase order it became, and the short-close reason. Every
// value is already on the list row, so no extra fetch — the panel just reads it.

import { type PurchaseRequestListItem, opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { prBalanceClosedText, prOrderBalance } from '../lib/pr-balance';

/** The SO or JC this PR came from — one or the other, like the old card. */
function SourceRef({ pr }: { pr: PurchaseRequestListItem }): React.JSX.Element {
  if (pr.soCode) {
    return (
      <span style={{ color: 'var(--cyan)' }}>
        {soNoWithInternal(pr.soCode, pr.soInternalNo)}
        {pr.soLineNo ? <span className="text3"> · Ln {pr.soLineNo}</span> : null}
      </span>
    );
  }
  if (pr.sourceJcCode) {
    return (
      <span style={{ color: 'var(--cyan)' }}>
        {pr.sourceJcCode}
        {pr.sourceJcOpSeq ? <span className="text3"> · Op {opSrNo(pr.sourceJcOpSeq)}</span> : null}
      </span>
    );
  }
  return <span className="text3">—</span>;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{children}</div>
    </div>
  );
}

export function PrListExpand({
  pr,
  priceHidden,
}: {
  pr: PurchaseRequestListItem;
  /** Hide the estimated rate for users without price visibility (unchanged gate). */
  priceHidden: boolean;
}): React.JSX.Element {
  const bal = prOrderBalance(pr);
  const estCost = Number(pr.estCost ?? 0);
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)',
        background: 'var(--bg3)',
      }}
    >
      <Fact label="POL">
        {pr.clientPoLineNo ? (
          <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
            {pr.clientPoLineNo}
          </span>
        ) : (
          <span className="text3">—</span>
        )}
      </Fact>
      <Fact label="SO / JC">
        <SourceRef pr={pr} />
      </Fact>
      <Fact label="Op">
        {pr.sourceJcOpSeq ? opSrNo(pr.sourceJcOpSeq) : <span className="text3">—</span>}
      </Fact>
      <Fact label="Operation">{pr.operation ?? <span className="text3">—</span>}</Fact>
      {priceHidden ? null : (
        <Fact label="Est. Rate (₹)">
          <span className="mono" style={{ color: 'var(--green2)' }}>
            {estCost > 0 ? `₹${estCost.toFixed(2)}` : '—'}
          </span>
        </Fact>
      )}
      <Fact label="Approved On">
        {pr.approvedAt ? (
          <span style={{ color: 'var(--blue)' }}>{fmtDate(pr.approvedAt)}</span>
        ) : (
          <span className="text3">—</span>
        )}
      </Fact>
      <Fact label="PO No. / Date">
        {pr.poCode ? (
          <span>
            {pr.poId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: pr.poId }}
                className="mono cyan"
                onClick={(e) => e.stopPropagation()}
              >
                {pr.poCode}
              </Link>
            ) : (
              <span className="mono cyan">{pr.poCode}</span>
            )}
            {pr.poCreatedAt ? <span className="text3"> · {fmtDate(pr.poCreatedAt)}</span> : null}
          </span>
        ) : (
          <span className="text3">—</span>
        )}
      </Fact>
      {bal.closed ? (
        <Fact label="Short-Close Reason">
          <span className="text3" title={bal.closedReason ?? undefined}>
            🚫 {prBalanceClosedText(bal)}
            {bal.closedReason ? ` — ${bal.closedReason}` : ''}
          </span>
        </Fact>
      ) : null}
    </div>
  );
}
