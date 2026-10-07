// Turning Access Control's Planning people into rows the shared picker can
// render. Mirrors the Production-user picker (see production-users/options.ts)
// so the "Assembled By" box reads the same way as every "Issued To" box.

import { shortName, type PlanningUserOption } from '@innovic/shared';
import type { SearchableOption } from '@/components/shared/searchable-select';

/** The person's NAME leads each row; the second half only exists to tell two
 *  people apart. Tier codes are meaningless on their own, so 'L3' is shown as
 *  'Planning · L3', and a Full Access account says so plainly instead of
 *  pretending to be Planning staff. */
function badge(o: PlanningUserOption): string {
  if (o.fullAccess && !o.isPlanningDept) return 'Full Access';
  return o.tier ? `Planning · ${o.tier}` : '';
}

export function toPlanningSearchOptions(options: PlanningUserOption[]): SearchableOption[] {
  return options.map((o) => {
    const b = badge(o);
    // The short form -- "Jinal R." -- matches the Production and QC pickers.
    const n = shortName(o.name);
    // The FULL name rides along invisibly so the surname still finds the person:
    // the row reads "Jinal R." but typing "rohit" or "jayantibhai" matches it.
    // Never rendered — matching only.
    const searchText = o.name;
    // No badge → render the bare name, otherwise the picker draws a dangling
    // "Name — " with nothing after the dash.
    return b ? { id: o.id, code: n, name: b, searchText } : { id: o.id, name: n, searchText };
  });
}

/** The searchable picker wants an `onSearch` to feed a `?search=` param. There
 *  isn't one here: /access-control/planning-users returns every Planning person
 *  in one small response, so the picker's own substring filter does the whole
 *  job in the browser — same as the Production and QC pickers. */
export const NO_SERVER_SEARCH = (): void => {};
