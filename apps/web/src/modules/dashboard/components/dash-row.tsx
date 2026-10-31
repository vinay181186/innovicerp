// ADR-250/262 — the home's row parts: number formats, the status pill, the
// item cell and the header row of the Approval inbox rows.
// Presentational: every figure comes from the server.

import type { DashTone } from '@innovic/shared';

export const fmtQty = (n: number): string => n.toLocaleString('en-IN');
export const fmtAmount = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function StatusPill({ label, tone }: { label: string; tone: DashTone }): React.JSX.Element {
  return <span className={`dh-pill t-${tone}`}>{label}</span>;
}

/** Item code (bold mono) + name, one line, ellipsis. */
export function ItemCell({
  code,
  name,
  extra,
}: {
  code: string | null;
  name: string | null;
  extra?: string | undefined;
}): React.JSX.Element {
  const title = [code, name, extra].filter(Boolean).join(' ');
  return (
    <div className="dh-it" title={title}>
      {code ? <span className="dh-code">{code}</span> : null}{' '}
      <span className="dh-mut">{name ?? (code ? '' : '—')}</span>
      {extra ? <span className="dh-mut"> · {extra}</span> : null}
    </div>
  );
}

/** The header row: [document, item, qty, status] + an empty action column. */
export function RowHead({
  head,
  approve,
}: {
  head: readonly [string, string, string, string];
  approve?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className={`dh-row dh-hd${approve ? ' dh-ap' : ''}`} aria-hidden="true">
      {approve ? <span /> : null}
      <span>{head[0]}</span>
      <span>{head[1]}</span>
      <span className="dh-q">{head[2]}</span>
      <span>{head[3]}</span>
      <span />
    </div>
  );
}
