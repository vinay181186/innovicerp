// What the ▸ row reveals under one SO/JWSO Planning line (level 2, ADR-199
// fit table). Everything the old sheet crammed into its cells and could not
// fit on one line:
//   - POL (the CUSTOMER's PO line number) — it used to sit under the item code;
//   - Reserved here and Physical (ADR-180) — "n reserved here" used to be a
//     second line inside the Available cell, which overflowed its column;
//   - one chip per plan (code · type · qty · ops · vendor · status, with links
//     to its Production Order / purchase requests / Job Card);
//   - one chip per purchase request raised from a BUY line (ADR-171);
//   - the "In Production (no plan)" block — Job Cards raised straight from SO
//     Status, shown so planners see production that bypassed planning and do
//     not double-issue.
// Every ACTION is in the row's ⋯ menu (planning-line-menu.ts), never here.

import type { PlanningLine } from '@innovic/shared';
import { PlanChip, PrChip } from './plan-chip';
import { lineStatusOf } from './planning-shared';

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <span>
      <span className="mono text3" style={{ fontSize: 11 }}>
        {label}
      </span>{' '}
      {children}
    </span>
  );
}

export function PlanningLineExpand({ line }: { line: PlanningLine }): JSX.Element {
  const status = lineStatusOf(line);
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          fontSize: 12,
          marginBottom: 'var(--sp-2)',
        }}
      >
        {/* POL is the CUSTOMER's own line number — an extra value beside our
            "Ln", never a substitute for it. */}
        <Fact label="POL">
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {line.clientPoLineNo ?? '—'}
          </span>
        </Fact>
        {line.reservedQty > 0 ? (
          <Fact label="Reserved here">
            <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {line.reservedQty}
            </span>
          </Fact>
        ) : null}
        <Fact label="Physical">
          <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
            {line.physicalQty}
          </span>
        </Fact>
      </div>

      {line.plans.length === 0 && line.prs.length === 0 && !status.hasDirectJc ? (
        <div className="text3" style={{ fontSize: 12 }}>
          No plans or purchase requests on this line yet.
        </div>
      ) : null}

      {line.prs.map((pr) => (
        <PrChip key={pr.id} pr={pr} />
      ))}
      {line.plans.map((p) => (
        <PlanChip key={p.id} plan={p} />
      ))}

      {status.hasDirectJc ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            padding: '3px 8px',
            margin: '2px 0',
            background: 'var(--cyan3)',
            border: '1px solid var(--cyan2)',
            borderRadius: 6,
            fontSize: 11,
          }}
          title="Job Card(s) created directly from SO Status — counted as covered."
        >
          <span>🏭</span>
          <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>In Production (no plan)</span>
          <span className="text2">{line.directJcQty} pcs</span>
          <span className="mono text3" style={{ fontSize: 11 }}>
            {line.directJcCodes.join(', ')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
