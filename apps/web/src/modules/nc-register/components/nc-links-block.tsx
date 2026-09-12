// The links a recovery leaves behind on an NC (docs/QC-NC-HANDLING-DESIGN.md
// §3–§5): the child rework / repair JC, the return challan, the NC this one
// was split from and the rows split off it. Renders nothing when there is
// nothing to link.

import type { NcRegister } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

export function NcLinksBlock(props: {
  detail: NcRegister;
  splitParent: NcRegister | null;
  siblings: NcRegister[];
}): React.JSX.Element | null {
  const { detail, splitParent, siblings } = props;
  const childId = detail.childJobCardCode ? detail.childJobCardId : null;
  const dcId = detail.deliveryChallanCode ? detail.deliveryChallanId : null;
  if (!childId && !dcId && !detail.splitFromNcId && siblings.length === 0) return null;
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
            title="Open the child job card"
          >
            {detail.childJobCardCode}
          </Link>
        </InlinePair>
      ) : null}
      {dcId ? (
        <InlinePair label="Return DC:">
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
      {detail.splitFromNcId ? (
        <InlinePair label="Split from:">
          <Link
            to="/nc-register/$id"
            params={{ id: detail.splitFromNcId }}
            className="mono"
            style={{ ...linkStyle, color: 'var(--red)' }}
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
                style={{ ...linkStyle, color: 'var(--red)' }}
                title={`${Number(s.rejectedQty)} pcs · ${s.status}`}
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
