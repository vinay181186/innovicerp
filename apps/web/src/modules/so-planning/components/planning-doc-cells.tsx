// RC No. / PRO No. / JC No. on SO + JWSO Planning (owner-approved 2026-10-26):
// how the codes DRAW. Which documents a line or plan has is the shared rule in
// packages/shared (lib/planning-doc-codes.ts, ADR-268), so the level-1 list, the
// line table (planning-line-columns.tsx), the ▸ panel (planning-line-expand.tsx)
// and the server's search can never read differently.
//
// Nothing generated yet → the grey word "Pending".
// A code links to its detail page when the API sent its id; the Route Card has
// no id on the wire, and plan-less (direct) Job Cards carry codes only, so
// those render as plain text.

import { Link } from '@tanstack/react-router';
import { rcApprovalLabel, type PlanningDocRef, type PlanningRcRef } from '@innovic/shared';

export function PendingText(): JSX.Element {
  return (
    <span className="text3" style={{ fontWeight: 400 }}>
      Pending
    </span>
  );
}

const CODE_STYLE = { color: 'var(--blue)' } as const;

export function DocCode({ doc, kind }: { doc: PlanningDocRef; kind: 'pro' | 'jc' }): JSX.Element {
  if (!doc.id) {
    return (
      <span className="mono fw-700" style={CODE_STYLE}>
        {doc.code}
      </span>
    );
  }
  // A row of the list opens its order on click; the link must open only the PRO / JC.
  return kind === 'pro' ? (
    <Link
      to="/production-orders/$id"
      params={{ id: doc.id }}
      className="mono fw-700"
      style={CODE_STYLE}
      onClick={(e) => e.stopPropagation()}
    >
      {doc.code}
    </Link>
  ) : (
    <Link
      to="/job-cards/$id"
      params={{ id: doc.id }}
      className="mono fw-700"
      style={CODE_STYLE}
      onClick={(e) => e.stopPropagation()}
    >
      {doc.code}
    </Link>
  );
}

/** Route Card codes, each with its approval warning when not yet approved. */
export function RcCodes({ rcs }: { rcs: PlanningRcRef[] }): JSX.Element {
  if (rcs.length === 0) return <PendingText />;
  return (
    <>
      {rcs.map((rc, i) => {
        const warn = rcApprovalLabel(rc.approval);
        return (
          <span key={rc.code}>
            {i > 0 ? ' · ' : null}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {rc.code}
            </span>
            {warn ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginLeft: 4 }}>
                {warn}
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

/** PRO or JC codes, " · " joined on one line (`stacked` → one per line, for
 *  the ▸ panel where each PRO sits beside its own JC). */
export function DocCodes({
  docs,
  kind,
  stacked = false,
}: {
  docs: PlanningDocRef[];
  kind: 'pro' | 'jc';
  stacked?: boolean;
}): JSX.Element {
  if (docs.length === 0) return <PendingText />;
  return (
    <>
      {docs.map((d, i) =>
        stacked ? (
          <div key={`${d.code}-${i}`}>
            <DocCode doc={d} kind={kind} />
          </div>
        ) : (
          <span key={`${d.code}-${i}`}>
            {i > 0 ? ' · ' : null}
            <DocCode doc={d} kind={kind} />
          </span>
        ),
      )}
    </>
  );
}
