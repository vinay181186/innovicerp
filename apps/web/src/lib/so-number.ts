// ADR-207 — how an SO number is shown everywhere: the system SO No.
// (sales_orders.code, IN-SO-#####) followed by the user-typed Internal SO No.
// (sales_orders.internal_so_no, e.g. SO-2401) when the order has one.
//   soNoWithInternal('IN-SO-00786', 'SO-2401') -> 'IN-SO-00786 · SO-2401'
//   soNoWithInternal('IN-SO-00786', null)      -> 'IN-SO-00786'
// Always fed from the LIVE sales_orders row (never a copy on another table).
// For JSX use <SoNo code internal /> (components/shared/so-no.tsx).

export const SO_NO_SEPARATOR = ' · ';

export function soNoWithInternal(code: string, internalSoNo?: string | null): string {
  const internal = internalSoNo?.trim();
  return internal ? `${code}${SO_NO_SEPARATOR}${internal}` : code;
}
