// Server-side Access Control matrix enforcement (0100).
//
// Until now the matrix only hid sidebar links — every write was gated by
// `users.role` alone (see ./auth.ts) and the matrix was never consulted on
// the server. ADR-035 option A called that a deferred audit task. This is
// the mechanism that closes it.
//
// TWO LAYERS, both must pass:
//   1. the role guard in ./auth.ts (and the row-level-security policies
//      behind it) — the outer wall, unchanged
//   2. `requireFormAccess` — the per-user (Tier + Department) matrix
//
// The matrix can only ever NARROW what the role already allows. That is
// deliberate: it means switching a user's tier can never accidentally hand
// out a right their role does not have, so the tier model could be rolled
// out without re-auditing all 176 RLS policies first.
//
// Currently wired into: the approve / reject paths of Purchase Orders and
// Purchase Requests. Those went first because `approve` is a brand-new
// action with no legacy behaviour to preserve — nobody can be locked out of
// something they could do yesterday. Extending this to the remaining
// modules' write endpoints is a follow-up sweep.

import {
  type AccessAction,
  type AccessFormKey,
  ACCESS_FORMS,
  effectiveFormPerms,
} from '@innovic/shared';
import type { AuthContext } from '../db/with-user-context';
import { getMyAccess } from '../modules/access-control/service';
import { AuthorizationError } from './errors';

const ACTION_VERB: Record<AccessAction, string> = {
  view: 'open',
  entry: 'create records in',
  edit: 'change records in',
  approve: 'approve records in',
};

function formLabel(formKey: AccessFormKey): string {
  return ACCESS_FORMS.find((f) => f.key === formKey)?.label ?? formKey;
}

/**
 * Throw unless the caller's access matrix grants `action` on `formKey`.
 *
 * Admins pass unconditionally — the same bypass the sidebar and the
 * dashboard already apply, so the matrix can never lock the one role that
 * has to be able to repair it.
 *
 * A user with no matrix row (or an entirely empty one) also passes: that is
 * the documented day-one rollout state, and it is the shared
 * `isUnconfigured` rule, applied here rather than re-implemented.
 */
export async function requireFormAccess(
  user: AuthContext,
  formKey: AccessFormKey,
  action: AccessAction,
): Promise<void> {
  if (user.role === 'admin') return;

  const eff = await getMyAccess(user);
  if (effectiveFormPerms(eff, formKey)[action]) return;

  throw new AuthorizationError(
    `Your access does not let you ${ACTION_VERB[action]} ${formLabel(formKey)}. ` +
      `Ask an admin to raise your tier for this department, or to tick ${action} ` +
      `on ${formLabel(formKey)} in Access Control.`,
  );
}

/**
 * Segregation of duty — the approver may not be the person who raised the
 * document. Structural check #4 of the Generic Role Audit Checklist.
 *
 * Applies to admins too. An approval that the raiser signed themselves is
 * not an approval, and "the admin did it" is exactly the case an auditor
 * cares about. Where a company genuinely has one person, the answer is a
 * second approver account, not an exemption.
 */
export function assertNotSelfApproval(
  user: AuthContext,
  createdBy: string | null,
  docLabel: string,
): void {
  if (createdBy && createdBy === user.id) {
    throw new AuthorizationError(
      `You raised ${docLabel}, so you cannot approve it yourself. ` +
        `Someone else with approve rights has to sign it off.`,
    );
  }
}
