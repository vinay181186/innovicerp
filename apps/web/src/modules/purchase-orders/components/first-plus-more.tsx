// ADR-303 — a one-row-per-document list cell for a LINE fact: the first value
// and a grey "+n" when the document's lines carry n more (SO No. on PO / OSP DC
// / GRN lists, JWSO No. on Party GRN, JC No. on OSP DC). The server sends the
// first value and the extra count. Shared by those four modules' lists.
// (Candidate for ui/data; kept here because ui/ was out of this change's scope.)

import type { ReactNode } from 'react';

export function FirstPlusMore({
  value,
  more,
  color = 'var(--blue)',
}: {
  value: string | null | undefined;
  more: number | null | undefined;
  color?: string;
}): ReactNode {
  const v = (value ?? '').trim();
  if (!v) return <span className="text3">—</span>;
  const n = more ?? 0;
  return (
    <span>
      <span style={{ color }}>{v}</span>
      {n > 0 ? (
        <span className="text3" title={`${n} more on this document's lines`}>
          {' '}
          +{n}
        </span>
      ) : null}
    </span>
  );
}
