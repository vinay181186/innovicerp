// Routing rule: a QC op may NOT sit directly after an outsource (OSP) op.
//
// The rule itself lives in packages/shared (lib/jc-op-sequence.ts) so the JC
// form and the API refuse the same routing with the same message. This file
// is the server-side wrapper every jc_ops / plan_ops / route_card_ops writer
// calls: it turns the shared message into a ValidationError and builds the
// grandfather set for edits of documents saved before the rule existed.
//
// Exemptions are the CALLER's to apply:
//  - rework/repair children (recovery_kind set) skip the check entirely —
//    the server always appends the terminal QC there, outsource-last routings
//    included (ADR-069 / ADR-161);
//  - pairs already saved side by side (existing outsource op at op_seq n,
//    existing qc op at op_seq n+1) are grandfathered through `allowedPairs`,
//    so an old job card stays editable without being re-routed first.
//
// Always run the check on the USER's ops, never on the list after the
// terminal QC op has been appended (jc-default-qc.ts) — that op is generated,
// not entered, and must not be what the person is told to fix.

import { qcAfterOutsourceError } from '@innovic/shared';
import { ValidationError } from './errors';

// The grandfather-set builder lives in shared (grandfatheredOspQcPairs) so the
// JC form and the server compute the same pairs; re-exported here for callers.
export { grandfatheredOspQcPairs } from '@innovic/shared';

/** Throws ValidationError (400) with the shared message when a QC op sits
 *  directly after an outsource op, unless that exact pair is grandfathered. */
export function assertNoQcDirectlyAfterOutsource(
  ops: ReadonlyArray<{ opType: string; id?: string | null | undefined }>,
  allowedPairs?: ReadonlySet<string>,
): void {
  const msg = qcAfterOutsourceError(ops, allowedPairs);
  if (msg) throw new ValidationError(msg);
}
