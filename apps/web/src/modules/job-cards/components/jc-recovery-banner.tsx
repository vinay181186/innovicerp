// Rework / repair child banner (docs/QC-NC-HANDLING-DESIGN.md §4, §8). Shown
// on BOTH the JC view and the JC edit page, so it lives in its own file rather
// than in either screen's module.
import type { JobCardListItem } from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

// Rework / repair child banner (docs/QC-NC-HANDLING-DESIGN.md §4, §8). A
// recovery job card looks like any other JC — same item, same drawing, its own
// ops — so without this the person opening IN-JC-26-00085-RW1 has no way to
// tell it exists only to recover 5 pieces rejected at Op 2 of 00085, or that
// whatever its final QC accepts goes BACK to that parent op rather than out
// the door. Shown in both view and edit mode (edit is where the recovery ops
// get defined). Null on an ordinary job card, so nothing else on the page
// moves.
export function RecoveryBanner({ jc }: { jc: JobCardListItem }): React.JSX.Element | null {
  if (!jc.recoveryKind) return null;
  const kind = jc.recoveryKind === 'repair' ? 'Repair' : 'Rework';
  // display rule — see opSrNo in @innovic/shared
  const opN = jc.originOpSeq != null ? fmtOpSrNo(jc.originOpSeq) : '?';
  // Both ids are nullable in the contract; a code with no id renders as text
  // rather than a link to nowhere (rule #8 — no dead links).
  const parent = jc.parentJobCardId ? (
    <Link to="/job-cards/$id" params={{ id: jc.parentJobCardId }} className="td-code">
      {jc.parentJobCardCode ?? '—'}
    </Link>
  ) : (
    <span className="td-code">{jc.parentJobCardCode ?? '—'}</span>
  );
  const nc = jc.parentNcId ? (
    <Link to="/nc-register/$id" params={{ id: jc.parentNcId }} className="td-code">
      {jc.parentNcCode ?? '—'}
    </Link>
  ) : (
    <span className="td-code">{jc.parentNcCode ?? '—'}</span>
  );
  // Where the rejects came from, from the parent NC. Any part may be null —
  // those parts are dropped, never shown as a bare "—".
  const sourceAt = [jc.parentOpName, jc.parentMachineCode].filter(Boolean).join(' / ');
  const sourceLine = [
    jc.parentRejectedQty != null ? `${jc.parentRejectedQty} rejected` : null,
    sourceAt ? `at ${sourceAt}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      style={{
        background: 'var(--amber3)',
        border: '1px solid var(--amber)',
        borderLeft: '4px solid var(--amber)',
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 12,
      }}
    >
      <div
        className="fw-700"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          fontSize: 13,
          color: 'var(--amber2)',
        }}
      >
        <span>♻ {kind} of</span>
        {parent}
        <span>
          (NC {nc}, Op {opN}) — returns to Op {opN} after final QC.
        </span>
        {sourceLine ? <span>· {sourceLine}</span> : null}
      </div>
    </div>
  );
}
