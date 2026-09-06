// Turning Access Control's QC people into rows the shared picker can render.
//
// Kept here rather than inline in each screen so the two "QC By" boxes (Incoming
// QC and the QC Call Register) always read the same way — the last time this was
// done per-screen the two fields ended up offering different lists.

import type { QcUserOption } from '@innovic/shared';
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
    // No badge → render the bare name, otherwise the picker draws a dangling
    // "Name — " with nothing after the dash.
    return b ? { id: o.id, code: o.name, name: b } : { id: o.id, name: o.name };
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
