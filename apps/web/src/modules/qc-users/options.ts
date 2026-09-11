// Turning Access Control's QC people into rows the shared picker can render.
//
// Kept here rather than inline in each screen so the two "QC By" boxes (Incoming
// QC and the QC Call Register) always read the same way — the last time this was
// done per-screen the two fields ended up offering different lists.

import { shortName, type QcUserOption } from '@innovic/shared';
import type { SearchableOption } from '@/components/shared/searchable-select';

/** The person's NAME leads each row; the second half only exists to tell two
 *  people apart. Tier codes are meaningless on the shop floor on their own, so
 *  'L3' is shown as 'QC · L3', and a Full Access account says so plainly instead
 *  of pretending to be QC staff. */
function badge(o: QcUserOption): string {
  if (o.fullAccess && !o.isQcDept) return 'Full Access';
  return o.tier ? `QC · ${o.tier}` : '';
}

export function toQcSearchOptions(options: QcUserOption[]): SearchableOption[] {
  return options.map((o) => {
    const b = badge(o);
    // The short form -- "Jinal R." -- on the user's instruction (2026-09-11).
    // Done HERE rather than in each panel because this is the one list both
    // "QC By" boxes read, so neither can drift back to the full name, and
    // whatever the picker shows is what the QC record is stamped with.
    const n = shortName(o.name);
    // The FULL name rides along invisibly so the surname still finds the person:
    // the row reads "Jinal R." but typing "rohit" or "jayantibhai" matches it.
    // Never rendered — matching only.
    const searchText = o.name;
    // No badge → render the bare name, otherwise the picker draws a dangling
    // "Name — " with nothing after the dash.
    return b
      ? { id: o.id, code: n, name: b, searchText }
      : { id: o.id, name: n, searchText };
  });
}

/** What the input shows once someone is picked: just the name, which is exactly
 *  the text that gets saved as "QC By". */
export function qcSelectedLabel(o: SearchableOption): string {
  return o.code ?? o.name;
}

/** The searchable picker wants an `onSearch` to feed a `?search=` param. There
 *  isn't one here: /access-control/qc-users returns every QC person in one small
 *  response, so the picker's own substring filter does the whole job in the
 *  browser. Deliberate departure from the searchable-field skill's
 *  server-side-search rule, and safe only because the list can't run to page 2. */
export const NO_SERVER_SEARCH = (): void => {};
