// Shared list-search behaviour — the one place that decides what a typed search
// term MEANS, so every list in the app agrees.
//
// Before this module each list re-implemented "trim it and compare it" slightly
// differently, which is how the app ended up with search boxes that each cover
// different columns and treat spacing and case differently. New lists should
// reach for these two helpers rather than hand-rolling the same three lines.
//
// Deliberately dependency-free and pure: no React, no hooks, no component. That
// keeps it usable from a route component, a plain helper or a test alike.

/**
 * Clean up what the user typed before it is used as a query.
 *
 * Trims the ends and collapses any internal run of whitespace to a single
 * space. Whitespace-only input comes back as `''`, which callers read as
 * "no search".
 *
 * WHY collapse the middle, not just trim: the term normally ends up in the
 * `?search=` URL param and in the TanStack Query key. Without this,
 * `"  shaft   50 "` and `"shaft 50"` are two different queries — two cache
 * entries, two network round-trips and two different URLs in the user's
 * history — for one intent.
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Case-insensitive "does any of these fields contain the term" test.
 *
 * True when at least one field contains the term as a substring, ignoring
 * case. An empty term returns true — an empty search box hides nothing.
 * `null` / `undefined` fields are skipped; numbers are stringified so a
 * quantity or a line number can be searched like any other column.
 *
 * ONLY FOR LISTS THAT ALREADY HOLD EVERY ROW IN THE BROWSER — the masters,
 * which scroll rather than paginate and are fetched in one go. On a list that
 * is paginated or filtered by the server, filtering the downloaded rows this
 * way is WRONG: the browser only has the current page, so the box would appear
 * to work while silently hiding every matching row the server never sent.
 * Such a list must widen its API query instead. The Sales Order list
 * (`modules/sales-orders/routes/list.tsx`) is the server-side example: it
 * pushes the normalized term into `?search=` and the API does the matching.
 */
export function matchesSearchTerm(
  fields: ReadonlyArray<string | number | null | undefined>,
  term: string,
): boolean {
  const needle = normalizeSearchTerm(term).toLowerCase();
  if (needle === '') return true;
  return fields.some((f) => {
    if (f === null || f === undefined) return false;
    return String(f).toLowerCase().includes(needle);
  });
}
