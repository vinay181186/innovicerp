// ADR-306 — "Internal SO No.": the office's own number, typed as DIGITS only
// (433). The system puts "SO-" in front and that becomes the order's ONE SO
// No. (SO-433). Left blank on a new SO, the order gets the next system number
// in the IN-SO-##### series instead. One rule for the web form and the API:
//   - digits only, at most INTERNAL_SO_NO_MAX_DIGITS; "SO-433" is also
//     accepted (the prefix is dropped) so a pasted number still works;
//   - leading zeros are dropped ("0433" = 433), so SO-0433 and SO-433 can
//     never be two orders;
//   - 0 is not a number.
// Uniqueness (against every SO of the company, live or deleted, and every
// number an SO ever had) is the server's job.

export const INTERNAL_SO_NO_PREFIX = 'SO-';
export const INTERNAL_SO_NO_MAX_DIGITS = 9;

/** The digits a person typed, cleaned: spaces and a leading "SO-" removed,
 *  leading zeros dropped. '' when nothing usable was typed. */
export function internalSoNoDigits(raw: string): string {
  const t = raw.trim().replace(/^so-/i, '').trim();
  return /^\d+$/.test(t) ? t.replace(/^0+/, '') : t;
}

/** The plain-English problem with a typed Internal SO No., or null when it is
 *  fine. Blank is fine here — the caller decides whether blank is allowed. */
export function internalSoNoError(raw: string): string | null {
  const t = raw.trim().replace(/^so-/i, '').trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'Internal SO No.: type digits only (e.g. 433).';
  const d = t.replace(/^0+/, '');
  if (d === '') return 'Internal SO No. cannot be 0.';
  if (d.length > INTERNAL_SO_NO_MAX_DIGITS) {
    return `Internal SO No. can be at most ${INTERNAL_SO_NO_MAX_DIGITS} digits.`;
  }
  return null;
}

/** "433" -> "SO-433": the SO No. a typed Internal SO No. gives the order. */
export function soNoFromInternal(raw: string): string {
  return `${INTERNAL_SO_NO_PREFIX}${internalSoNoDigits(raw)}`;
}

/** The digits of an SO No. that came from a typed number ("SO-433" -> "433"),
 *  '' for a system number (IN-SO-00014). Fills the box on the edit form. */
export function internalSoNoOfCode(code: string | null | undefined): string {
  const m = /^SO-(\d+)$/.exec((code ?? '').trim());
  return m ? m[1]! : '';
}

/** The 409 text when the number is already used by another SO. */
export function internalSoNoTakenMessage(soNo: string, usedBy?: string | null): string {
  return usedBy && usedBy !== soNo
    ? `${soNo} is already used (order ${usedBy}) — type a different number.`
    : `${soNo} is already used — type a different number.`;
}
