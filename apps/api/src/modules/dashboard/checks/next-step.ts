// ADR-312 — a check row's document number opens the page where the check's
// next step is done (Create PO, Start Operation, New GRN …) when the caller
// holds that right; otherwise CheckDef.docHref, the document itself. The
// right is the same tick the ADR-250 home list asks for that action
// (personal/lists.ts), and the page must open for the caller (canSeeLink —
// a per-page Hide closes it), as personal/lists.ts filterActions does.

import type { AccessAction, AccessFormKey } from '@innovic/shared';
import { type DashAccess, canSeeLink, hasTick } from '../access';
import type { RawRow } from '../personal/list-query';
import type { CheckDef } from './types';

/** CheckDef.actionHref: `href(r)` for a caller with `form`·`action` whose
 *  page opens for them; null (→ docHref) otherwise, or when `href` is null
 *  (the row lacks what the step needs). */
export function nextStep(
  form: AccessFormKey,
  action: AccessAction,
  href: (r: RawRow) => string | null,
): NonNullable<CheckDef['actionHref']> {
  return (r: RawRow, a: DashAccess) => {
    if (!hasTick(a, form, action)) return null;
    const to = href(r);
    return to !== null && canSeeLink(a, null, to) ? to : null;
  };
}

export const enc = encodeURIComponent;
