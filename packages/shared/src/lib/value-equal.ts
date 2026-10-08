// ADR-225 — ONE rule for "is this the same value", used by the browser and the
// server alike.
//
// It was private to apps/api/src/lib/audit-trail.ts, where it decides what the
// History tab calls a change and whether a staged edit has drifted. The browser
// now needs the IDENTICAL rule to work out which fields a user actually
// changed, because an edit sends only those (§20.4). Two copies of this rule
// would mean the browser calling something a change that the server does not,
// or the reverse — so there is one copy, here, and `audit-trail.ts` imports it.
//
// The rule, in full:
//   • `undefined`, `null` and a blank/whitespace string all mean EMPTY. A box
//     the user cleared and a column that was already NULL are the same value.
//   • A `Date` compares by instant, via its ISO string.
//   • Numbers compare NUMERICALLY. Drizzle hands numerics back as strings
//     ("10.000") while a form sends a number (10) — those are not a change.
//   • Objects and arrays compare by their JSON text.
//
// `changedKeys` adds the one rule that makes a partial save safe: a key the
// caller did not provide is NOT a change, it is "untouched". That is the same
// convention `diffFields` already uses for an absent key, and the same one
// every server service reads as `if (input.x !== undefined)`.

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function isNumericLike(v: unknown): boolean {
  return (
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && NUMERIC_RE.test(v.trim()))
  );
}

/** undefined / '' / null all mean "empty"; a Date becomes its ISO string. */
export function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** True when two ALREADY-NORMALISED values are the same. Prefer `valuesEqual`. */
export function sameNormalizedValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Drizzle numerics arrive as strings ("10.000"), inputs as numbers (10).
  if (isNumericLike(a) && isNumericLike(b)) return Number(a) === Number(b);
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** True when `a` and `b` are "the same value" by the rules in this file's header. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return sameNormalizedValue(normalizeValue(a), normalizeValue(b));
}

/** Exported for the one place that needs the numeric test itself (History
 *  prints "10 → 12", not "10.000 → 12"). */
export function isNumericValue(v: unknown): boolean {
  return isNumericLike(v);
}

/**
 * The keys of `current` whose value differs from `loaded` — i.e. exactly what
 * the user changed on this screen, and therefore exactly what an edit should
 * send (§20.4).
 *
 * `loaded` is the record AS THE SCREEN LOADED IT (the photograph). `current` is
 * what the form holds now. Pass `keys` to limit the comparison to the fields
 * the screen can actually edit — without it, every key of `current` is
 * considered, and a key absent from `current` is left out as untouched.
 *
 * Returns [] when nothing changed. A caller that would otherwise send an empty
 * edit must refuse instead: on a Delivery Challan or a Dispatch an empty save
 * still bumps the document's revision and re-posts downstream quantities, so
 * "nothing to save" has to be an answer, not a write.
 */
export function changedKeys<T extends object>(
  loaded: T,
  current: Partial<T>,
  keys?: readonly (keyof T & string)[],
): (keyof T & string)[] {
  const l = loaded as Record<string, unknown>;
  const c = current as Record<string, unknown>;
  const candidates = keys ?? (Object.keys(c) as (keyof T & string)[]);
  const out: (keyof T & string)[] = [];
  for (const k of candidates) {
    if (!(k in c) || c[k] === undefined) continue; // not touched by this screen
    if (valuesEqual(l[k], c[k])) continue;
    out.push(k);
  }
  return out;
}

/**
 * `current` reduced to only the keys that differ from `loaded` — the payload an
 * edit should actually send. The same arguments as `changedKeys`.
 */
export function changedFields<T extends object>(
  loaded: T,
  current: Partial<T>,
  keys?: readonly (keyof T & string)[],
): Partial<T> {
  const c = current as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of changedKeys(loaded, current, keys)) out[k] = c[k];
  return out as Partial<T>;
}
