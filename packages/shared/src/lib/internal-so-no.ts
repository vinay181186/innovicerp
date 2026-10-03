// ADR-207 — "Internal SO No." (sales_orders.internal_so_no): the office's own
// Sales Order number, typed by the user beside the system SO No. (IN-SO-#####).
// One rule for the web form and the API:
//   - starts with "SO-" (letter O), then at least one character;
//   - after the prefix: letters, digits, / - . only;
//   - at most 30 characters, surrounding spaces trimmed;
//   - stored as typed, except the prefix is written upper-case ("so-12" -> "SO-12").
// Uniqueness (per company, case-insensitive, live SOs) is the server's job.

export const INTERNAL_SO_NO_PREFIX = 'SO-';
export const INTERNAL_SO_NO_MAX = 30;
export const INTERNAL_SO_NO_RE = /^SO-[A-Za-z0-9/.-]+$/;

/** Trim, and upper-case the "so-" prefix. Everything after it stays as typed. */
export function normaliseInternalSoNo(raw: string): string {
  const t = raw.trim();
  return /^so-/i.test(t) ? `${INTERNAL_SO_NO_PREFIX}${t.slice(3)}` : t;
}

/** The plain-English problem with a typed Internal SO No., or null when it is
 *  fine. Pass the raw value; it is normalised first. */
export function internalSoNoError(raw: string): string | null {
  const v = normaliseInternalSoNo(raw);
  if (v === '' || v === INTERNAL_SO_NO_PREFIX) return 'Internal SO No. is required.';
  if (v.length > INTERNAL_SO_NO_MAX) {
    return `Internal SO No. can be at most ${INTERNAL_SO_NO_MAX} characters.`;
  }
  if (!v.startsWith(INTERNAL_SO_NO_PREFIX)) return 'Internal SO No. must start with "SO-".';
  if (!INTERNAL_SO_NO_RE.test(v)) {
    return 'Internal SO No.: after "SO-" use only letters, digits, / - .';
  }
  return null;
}

/** The 409 text when the number is already used by another live SO. */
export function internalSoNoTakenMessage(internalSoNo: string): string {
  return `Internal SO No. ${internalSoNo} already exists — use a unique number.`;
}
