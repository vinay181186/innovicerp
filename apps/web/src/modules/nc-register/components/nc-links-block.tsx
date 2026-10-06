// The links a recovery leaves behind on an NC (docs/QC-NC-HANDLING-DESIGN.md
// §3–§5): the child rework / repair JC, (ADR-217) the zero-value job-work order
// a return to vendor raised, the return challan, the NC this one was split
// from, the rows split off it and (ADR-167) the NC whose return replacement
// this one continues. Renders nothing when there is nothing to link.
//
// ADR-217 — the replacement order is shown FIRST of the return pair, because
// that is the order it happens in: the disposition raises the order, then the
// challan hangs off it. `replacementPoId` is null on every NC disposed before
// ADR-217 and on every disposition that is not a return to vendor, and null
// renders nothing at all here — exactly like the child JC and the challan.

import { NC_STATUS_LABELS, type NcRegister } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

export function NcLinksBlock(props: {
  detail: NcRegister;
  splitParent: NcRegister | null;
  siblings: NcRegister[];
}): React.JSX.Element | null {
  const { detail, splitParent, siblings } = props;
  const childId = detail.childJobCardCode ? detail.childJobCardId : null;
  const dcId = detail.deliveryChallanCode ? detail.deliveryChallanId : null;
  // Both halves are needed to make a link: the id to route to and the code to
  // show. A code with no id (or the reverse) is not rendered rather than
  // rendered dead — the same rule the child JC and the challan already follow.
  const poId = detail.replacementPoCode ? detail.replacementPoId : null;
  if (
    !childId &&
    !poId &&
    !dcId &&
    !detail.splitFromNcId &&
    !detail.parentNcId &&
    siblings.length === 0
  )
    return null;
  const linkStyle = { textDecoration: 'none' } as const;
  return (
    <div className="form-grid" style={{ fontSize: 12, marginBottom: 10 }}>
      {childId ? (
        <InlinePair label={detail.disposition === 'repair' ? 'Repair JC:' : 'Rework JC:'}>
          <Link
            to="/job-cards/$id"
            params={{ id: childId }}
            className="mono"
            style={{ ...linkStyle, color: 'var(--cyan)' }}
          >
            {detail.childJobCardCode}
          </Link>
        </InlinePair>
      ) : null}
      {poId ? (
        <InlinePair label="Replacement PO No.:">
          <Link
            to="/purchase-orders/$id"
            params={{ id: poId }}
            className="mono fw-700"
            style={{ ...linkStyle, color: 'var(--cyan)' }}
            title="Open the zero-value job-work order this return raised"
          >
            {detail.replacementPoCode}
          </Link>
        </InlinePair>
      ) : null}
      {dcId ? (
        <InlinePair label="DC No.:">
          <Link
            to="/delivery-challans/$id"
            params={{ id: dcId }}
            className="mono"
            style={{ ...linkStyle, color: 'var(--cyan)' }}
            title="Open the return-to-vendor challan"
          >
            {detail.deliveryChallanCode}
          </Link>
        </InlinePair>
      ) : null}
      {detail.parentNcId ? (
        <InlinePair label="Earlier NC:">
          <Link
            to="/nc-register/$id"
            params={{ id: detail.parentNcId }}
            className="mono fw-700"
            style={{ ...linkStyle, color: 'var(--red2)' }}
            title="Earlier NC whose vendor replacement deviated again"
          >
            {detail.parentNcCode ?? '…'}
          </Link>
        </InlinePair>
      ) : null}
      {detail.splitFromNcId ? (
        <InlinePair label="Split from:">
          <Link
            to="/nc-register/$id"
            params={{ id: detail.splitFromNcId }}
            className="mono"
            style={{ ...linkStyle, color: 'var(--red2)' }}
          >
            {splitParent?.code ?? '…'}
          </Link>
        </InlinePair>
      ) : null}
      {siblings.length > 0 ? (
        <InlinePair label="Split off this NC:">
          {siblings.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? ', ' : ''}
              <Link
                to="/nc-register/$id"
                params={{ id: s.id }}
                className="mono"
                style={{ ...linkStyle, color: 'var(--red2)' }}
                title={`${Number(s.rejectedQty)} pcs · ${NC_STATUS_LABELS[s.status]}`}
              >
                {s.code}
              </Link>
            </span>
          ))}
        </InlinePair>
      ) : null}
    </div>
  );
}

// Same inline "Label: <b>value</b>" pair the detail grid uses (legacy
// HTML L22728-22736), kept local so this block has no import back into the route.
function InlinePair(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span className="text3">{props.label}</span> <b>{props.children}</b>
    </div>
  );
}
