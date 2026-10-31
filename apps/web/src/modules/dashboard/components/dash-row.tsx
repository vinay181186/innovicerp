// ADR-250/262 — the home's row parts: number formats, the status pill —
// used by the check tables, the Approval inbox and the Day Log view.
// Presentational: every figure comes from the server.

import type { DashTone } from '@innovic/shared';

export const fmtQty = (n: number): string => n.toLocaleString('en-IN');
export const fmtAmount = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function StatusPill({ label, tone }: { label: string; tone: DashTone }): React.JSX.Element {
  return <span className={`dh-pill t-${tone}`}>{label}</span>;
}
