// ADR-207 — an SO number rendered the way item codes are (strong mono, --text,
// never the faint --text3): "IN-SO-00786 · SO-2401", or just the SO No. when
// the order has no Internal SO No. Text comes from lib/so-number.ts.

import { soNoWithInternal } from '@/lib/so-number';

export function SoNo(props: {
  code: string;
  internal?: string | null;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={props.className ?? 'mono fw-700'}
      style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}
    >
      {soNoWithInternal(props.code, props.internal)}
    </span>
  );
}
