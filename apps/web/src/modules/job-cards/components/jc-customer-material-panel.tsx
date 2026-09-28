// Customer Material roll-up (R1, ADR-194) — shown ONLY on a JW-sourced Job Card
// (jc.customerMaterial is not null). Needed = rmQtyPerPiece × JC qty (from the
// ADR-193 route-card RM); Received / Issued / Returned come from the party store
// ledger for this JWSO line; Balance = received − issued − returned. Hidden
// entirely on an own-material JC. Numbers are right-aligned (owner rule
// 2026-09-26); no rupee value — party material carries none.

import type { JobCardListItem } from '@innovic/shared';

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: '1 1 90px',
        minWidth: 80,
        padding: '6px 14px',
        borderLeft: '1px solid var(--border)',
        textAlign: 'right',
      }}
    >
      <div className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
        {label}
      </div>
      <div
        className="mono fw-700"
        style={{ fontSize: 18, lineHeight: 1.2, color: color ?? 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}

export function JcCustomerMaterialPanel({ jc }: { jc: JobCardListItem }): React.JSX.Element | null {
  const cm = jc.customerMaterial;
  // Own-material JC → nothing to show.
  if (!cm) return null;

  return (
    <div className="panel" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div
        className="panel-hdr"
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <div className="panel-title" style={{ color: 'var(--purple)' }}>
          Customer Material
        </div>
        <span className="text3" style={{ fontSize: 11 }}>
          Client-supplied material for this job (party store)
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          padding: '4px 0',
        }}
      >
        {/* The first cell drops its left border so the row reads as one strip. */}
        <div style={{ flex: '1 1 90px', minWidth: 80, padding: '6px 14px', textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
            Needed
          </div>
          <div className="mono fw-700" style={{ fontSize: 18, lineHeight: 1.2 }}>
            {cm.needed ?? '—'}
          </div>
        </div>
        <Metric label="Received" value={cm.received} color="var(--green2)" />
        <Metric label="Issued" value={cm.issued} color="var(--amber2)" />
        <Metric label="Returned" value={cm.returned} color="var(--purple)" />
        <Metric
          label="Balance"
          value={cm.balance}
          color={cm.balance > 0 ? 'var(--green)' : 'var(--text3)'}
        />
      </div>
    </div>
  );
}
