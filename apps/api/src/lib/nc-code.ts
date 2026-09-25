// The NC number series (ADR-183).
//
// Auto-raised NCs used to be named after everything that produced them:
//
//   NC-AUTO-IN-JC-26-00018-Op10-143052123
//
// — JC code, op, and an HHMMSSmmm stamp bolted on to dodge collisions. Nobody
// can read that down a phone line or write it on a reject tag, which is what a
// quality number is for. The series is now the same shape as every other
// document in the system: `NC-00042`, five digits, per company.
//
// The number-picking is here, pure and testable, because the query around it
// needs a database and this rule is the part worth getting right. Only codes
// matching the strict `NC-<digits>` shape count toward the maximum — the old
// NC-AUTO-… rows and any hand-typed code are ignored, so neither can drag the
// series somewhere strange or pin it to a number that never increments.

export const NC_CODE_PREFIX = 'NC-';
export const NC_CODE_DIGITS = 5;

const STRICT_NC_CODE = /^NC-(\d+)$/;

/** The highest number already used by a strict `NC-<digits>` code, or 0. */
export function highestNcNumber(codes: readonly (string | null | undefined)[]): number {
  let max = 0;
  for (const code of codes) {
    const m = STRICT_NC_CODE.exec((code ?? '').trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max;
}

/** The next code in the series, given every code the company already holds.
 *  Padded to NC_CODE_DIGITS; a series that outgrows the padding simply gets
 *  longer rather than wrapping or colliding. */
export function nextNcCodeFrom(codes: readonly (string | null | undefined)[]): string {
  const n = highestNcNumber(codes) + 1;
  return `${NC_CODE_PREFIX}${String(n).padStart(NC_CODE_DIGITS, '0')}`;
}
