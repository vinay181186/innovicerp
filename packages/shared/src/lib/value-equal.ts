// ADR-226 — ONE rule for "is this the same value", used by the browser and the
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
// Compared BY KEY across two shapes on purpose, not by one generic type. The
// record a screen loads and the payload it sends are different types: an NC's
// stored `reason` is `string | null`, its edit input's is `string | undefined`.
// Forcing them into one `T` makes every caller fight
// exactTypeOptionalProperties instead of describing what it means. The
// comparison is structural — same key, same value by the rules above — so a
// key-indexed signature is the honest one.
export function changedKeys(
  loaded: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  keys?: readonly string[],
): string[] {
  const candidates = keys ?? Object.keys(current);
  const out: string[] = [];
  for (const k of candidates) {
    if (!(k in current) || current[k] === undefined) continue; // not touched
    if (valuesEqual(loaded[k], current[k])) continue;
    out.push(k);
  }
  return out;
}

/**
 * `current` reduced to only the keys that differ from `loaded` — the payload an
 * edit should actually send. The same arguments as `changedKeys`; the result
 * keeps `current`'s own type, so the caller's mutation signature still applies.
 */
export function changedFields<TCurrent extends object>(
  loaded: Readonly<Record<string, unknown>>,
  current: TCurrent,
  keys?: readonly string[],
): Partial<TCurrent> {
  const c = current as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of changedKeys(loaded, c, keys)) out[k] = c[k];
  return out as Partial<TCurrent>;
}
