// Turning Access Control's Production people into rows the shared picker can
// render. Mirrors the QC-user picker (see qc-users/options.ts) so the "Issued To"
// box reads the same way as every "QC By" box.

import { shortName, type ProductionUserOption } from '@innovic/shared';
import type { SearchableOption } from '@/components/shared/searchable-select';

/** The person's NAME leads each row; the second half only exists to tell two
 *  people apart. Tier codes are meaningless on the shop floor on their own, so
 *  'L3' is shown as 'Production · L3', and a Full Access account says so plainly
 *  instead of pretending to be Production staff. */
function badge(o: ProductionUserOption): string {
  if (o.fullAccess && !o.isProductionDept) return 'Full Access';
  return o.tier ? `Production · ${o.tier}` : '';
}

export function toProductionSearchOptions(options: ProductionUserOption[]): SearchableOption[] {
  return options.map((o) => {
    const b = badge(o);
    // The short form -- "Jinal R." -- matches the QC picker.
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

/** The searchable picker wants an `onSearch` to feed a `?search=` param. There
 *  isn't one here: /access-control/production-users returns every Production
 *  person in one small response, so the picker's own substring filter does the
 *  whole job in the browser — same as the QC picker. */
export const NO_SERVER_SEARCH = (): void => {};
