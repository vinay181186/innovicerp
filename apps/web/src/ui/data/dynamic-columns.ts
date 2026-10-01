// Stable ids for columns generated at runtime (ADR-199 Wave A).
//
// Some screens build their columns from data, not from a fixed list: the QC
// Docs matrix (one column per required document), an Alert drill-down (one
// column per metric), a saved report's result grid (one column per selected
// field). Those columns still need a STABLE `id` so the user's saved layout
// (order / hide / pin) survives a reload and does not thrash when the data
// shifts. The id must be derived from a stable field on the source item —
// never the array index, which changes the moment a row is added or reordered.
//
// The id must satisfy the same column-id rule the fixed columns use
// (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, see DataTableColumn.id): a code name,
// never a label. `dynId` sanitises a raw seed into that charset and prefixes it.
//
// NOTE: the screen's `tableKey` itself stays fixed and registered in
// table-keys.ts — only the generated COLUMN ids are dynamic. See the prefix
// convention note in table-keys.ts.

import type { DataTableColumn } from './data-table-types';

/** The full id must start alphanumeric; separators are . _ - only. */
const DISALLOWED = /[^A-Za-z0-9_.-]+/g;
const LEADING_SEP = /^[^A-Za-z0-9]+/;
const TRAILING_SEP = /[^A-Za-z0-9]+$/;
const MAX_ID = 64;

/**
 * Build a stable column id as `<prefix>.<sanitised-raw>` — NO colon, so the id
 * stays inside the column-id charset. `raw` is reduced to [A-Za-z0-9_.-] (runs
 * of anything else collapse to a single `-`) and the whole id is capped at 64
 * chars with a clean (non-separator) first and last character.
 */
export function dynId(prefix: string, raw: string): string {
  const cleanPrefix = prefix.replace(DISALLOWED, '-').replace(LEADING_SEP, '');
  const cleanRaw = raw.replace(DISALLOWED, '-');
  let id = `${cleanPrefix}.${cleanRaw}`;
  id = id.replace(LEADING_SEP, '');
  if (id.length > MAX_ID) id = id.slice(0, MAX_ID);
  return id.replace(TRAILING_SEP, '');
}

/**
 * Build a column per source item, stamping each with a stable
 * `id = dynId(prefix, idSeed)`. `build` returns a normal DataTableColumn plus an
 * `idSeed` — seed it off a stable field of the item (a code, a slug, a uuid),
 * NOT the loop index, so saved layouts do not thrash when items move.
 */
export function dynamicColumns<I, T>(
  prefix: string,
  items: I[],
  build: (item: I, index: number) => DataTableColumn<T> & { idSeed: string },
): DataTableColumn<T>[] {
  return items.map((item, index) => {
    const { idSeed, ...col } = build(item, index);
    return { ...col, id: dynId(prefix, idSeed) };
  });
}
