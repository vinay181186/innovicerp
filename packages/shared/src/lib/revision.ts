// Drawing revision on an SO / JWSO line (ADR-178).
//
// The revision is the customer's drawing revision for that ordered item — it
// is typed on the order line, snapshotted into the drawing history and shown
// as CODE/REV on every downstream document. Two rules (user, 2026-09-22):
//
//   1. Letters are always CAPITAL: "b" is stored and shown as "B".
//   2. A revision never goes backwards on a line: once "B", it cannot be set
//      to "A" again; once "2", not "1". Letters order as letters (A < B < …
//      < Z < AA), numbers as numbers (2 < 10). A change of KIND — "1" to "A",
//      or "R1" to "B" — cannot be ordered and is therefore allowed.
//
// Values are short: letters and digits, optionally with '.', '-' or '/'
// (e.g. "A", "R1", "1.2"). Anything else is refused by the input schema.

export const REVISION_PATTERN = /^[A-Z0-9][A-Z0-9./-]{0,31}$/;

/** Trim + upper-case. The one place the capital-letter rule is written. */
export function normalizeRevision(raw: string): string {
  return raw.trim().toUpperCase();
}

type RevisionKind = 'letters' | 'number' | 'other';

function kindOf(rev: string): RevisionKind {
  if (/^[A-Z]+$/.test(rev)) return 'letters';
  if (/^\d+$/.test(rev)) return 'number';
  return 'other';
}

/** "A" → 1, "Z" → 26, "AA" → 27 (spreadsheet-column order). */
function lettersRank(rev: string): number {
  let n = 0;
  for (const ch of rev) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Compare two normalized revisions of the SAME kind.
 * Returns <0, 0, >0 like a comparator, or null when the two cannot be ordered
 * (different kinds, or a free-form value such as "R1").
 */
export function compareRevision(a: string, b: string): number | null {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb || ka === 'other') {
    // "R1" vs "R2": same prefix, digits differ → still orderable.
    const m1 = /^([A-Z./-]*)(\d+)$/.exec(a);
    const m2 = /^([A-Z./-]*)(\d+)$/.exec(b);
    if (m1 && m2 && m1[1] === m2[1]) return Number(m1[2]) - Number(m2[2]);
    return null;
  }
  if (ka === 'letters') return lettersRank(a) - lettersRank(b);
  return Number(a) - Number(b);
}

/**
 * True when changing a line's revision from `current` to `next` would move it
 * backwards — the case the form and the server both refuse. Same value or an
 * un-orderable pair is never "backwards".
 */
export function revisionGoesBackwards(current: string, next: string): boolean {
  const cur = normalizeRevision(current);
  const nxt = normalizeRevision(next);
  if (cur === '' || nxt === '' || cur === nxt) return false;
  const cmp = compareRevision(cur, nxt);
  return cmp !== null && cmp > 0;
}

/** The sentence both the form and the API show for a backwards change. */
export function revisionBackwardsMessage(lineNo: number, current: string, next: string): string {
  return `Ln ${lineNo}: Drawing revision cannot go back from ${normalizeRevision(current)} to ${normalizeRevision(next)}.`;
}
