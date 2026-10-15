// Server-side Access Control matrix enforcement (0100).
//
// Until now the matrix only hid sidebar links — every write was gated by
// `users.role` alone (see ./auth.ts) and the matrix was never consulted on
// the server. ADR-035 option A called that a deferred audit task. This is
// the mechanism that closes it.
//
// ADR-232 (owner, 2026-10-15): ONE LAYER. The Access Control matrix alone
// decides every write — `requireFormAccess(user, page, action)`. The derived
// `users.role` (see roleForAccess) no longer refuses anyone: it used to, and it
// refused people the matrix allowed ("has the right, still 'Ask an admin'").
// The guard test `no-role-gates.test.ts` fails the build if a role check comes
// back on a write.
//
// Three fixed rules sit on top of the ticks:
//   - L6 Super Admin (full access, the only way to role 'admin') passes all.
//   - L7 Auditor never writes — enforced inside effectiveFormPerms.
//   - Deleting any record needs Super Admin — `requireDeleteRight` below.
// Genuine system screens (users, access control, company settings, backup,
// approval setup) stay on `requireAdminRole` in ./auth.ts.
//
// The API connects as a BYPASSRLS role (migration 0180), so the RLS policies
// that mention roles never run for API traffic; this file is the enforcement.

import {
  type AccessAction,
  type AccessFormKey,
  ACCESS_FORMS,
  canDeleteRecords,
  effectiveFormPerms,
  isUnconfigured,
} from '@innovic/shared';
import type { AuthContext } from '../db/with-user-context';
import { getMyAccess } from '../modules/access-control/service';
import { AuthorizationError } from './errors';

const ACTION_VERB: Record<AccessAction, string> = {
  view: 'open',
  entry: 'create records in',
  advance: 'move records forward in',
  edit: 'change records in',
  approve: 'approve records in',
};

// The tick-box names on the Access Control screen, for the refusal message.
const ACTION_TICK: Record<AccessAction, string> = {
  view: 'View',
  entry: 'Entry',
  advance: 'Advance',
  edit: 'Edit',
  approve: 'Approve',
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
 * A user with no matrix row (or an entirely empty one) is DENIED. That flipped
 * with the User Management split: an unconfigured account used to be allowed
 * through as a rollout convenience, which meant the person nobody had set up
 * yet had more access than the person who had been given two departments.
 */
export async function requireFormAccess(
  user: AuthContext,
  formKey: AccessFormKey,
  action: AccessAction,
): Promise<void> {
  if (user.role === 'admin') return;

  const eff = await getMyAccess(user);
  if (effectiveFormPerms(eff, formKey)[action]) return;

  // An account with nothing configured at all gets the reason, not a
  // per-form riddle — "you can't approve POs" reads like a missing tick when
  // the truth is that no one has set this person up yet.
  if (isUnconfigured(eff)) {
    throw new AuthorizationError(
      'Your account has no access configured yet. Ask an admin to set your ' +
        'department tiers in Access Control.',
    );
  }

  throw new AuthorizationError(
    `Your access does not let you ${ACTION_VERB[action]} ${formLabel(formKey)}. ` +
      `Ask an admin to raise your tier for this department, or to tick ${ACTION_TICK[action]} ` +
      `on ${formLabel(formKey)} in Access Control.`,
  );
}

/**
 * May this caller see money (rates / amounts / totals / costs) on `formKey`?
 *
 * The read-side counterpart to `requireFormAccess`: services call this and
 * null out money fields before returning when it is false, so a pure L1 Viewer
 * never receives prices they should not see. Admins bypass; everyone L2+ (and
 * L7 auditors) sees money via their tier; an L1 form can be granted money back
 * with an explicit "see price" tick in Access Control.
 *
 * Non-throwing — callers branch on the boolean, they do not fail the request.
 */
/**
 * Pass if ANY one of several (form, action) pairs is allowed.
 *
 * For a read that two different screens legitimately need: the stock
 * availability figure is shown on Store/Inventory (`item_create`) and inside
 * the Allocate box on SO Planning (`plan_create`). Gating it on the Store key
 * alone would give a planner a silent 403 and a stale number; gating it on
 * neither would publish stock figures to anyone with a login.
 *
 * The refusal names the FIRST pair, which is the screen the endpoint belongs
 * to, so the message stays actionable.
 */
export async function requireAnyFormAccess(
  user: AuthContext,
  pairs: ReadonlyArray<readonly [AccessFormKey, AccessAction]>,
): Promise<void> {
  if (user.role === 'admin') return;
  const eff = await getMyAccess(user);
  for (const [formKey, action] of pairs) {
    if (effectiveFormPerms(eff, formKey)[action]) return;
  }
  const [formKey, action] = pairs[0]!;
  await requireFormAccess(user, formKey, action);
}

/** ADR-193 — who may READ store stock screens (inventory, ledger, issue
 *  registers): anyone whose work depends on what is in the store. Wide on
 *  purpose (paper test P24): a planner or buyer must not be locked out. */
export const STORE_VIEW_FORMS: ReadonlyArray<readonly [AccessFormKey, AccessAction]> = [
  ['item_create', 'view'],
  ['issue_create', 'view'],
  ['toolissue_create', 'view'],
  ['grn_create', 'view'],
  ['plan_create', 'view'],
  ['pr_create', 'view'],
  ['po_create', 'view'],
  ['prodorder_create', 'view'],
  ['jc_create', 'view'],
  ['dispatch_create', 'view'],
  ['party_create', 'view'],
  ['ospdc_create', 'view'],
  ['qc_incoming', 'view'],
  ['bom_create', 'view'],
];

/** The non-throwing twin of requireFormAccess, for READ paths that must list
 *  only what the caller could act on (the approvals inbox, ADR-190). Same
 *  rule: admins pass, everyone else by the effective matrix. */
export async function hasFormAccess(
  user: AuthContext,
  formKey: AccessFormKey,
  action: AccessAction,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const eff = await getMyAccess(user);
  return effectiveFormPerms(eff, formKey)[action];
}

export async function canSeeFormPrice(user: AuthContext, formKey: AccessFormKey): Promise<boolean> {
  if (user.role === 'admin') return true;
  const eff = await getMyAccess(user);
  return effectiveFormPerms(eff, formKey).price;
}

/**
 * ADR-232 (owner, 2026-10-15): deleting ANY record — a document, a master or
 * an uploaded file — needs L6 Super Admin. No tier and no per-page tick grants
 * it. Cancel, short close, reverse and close are NOT deletes; they keep their
 * own rights (`requireFormAccess` with edit / advance / approve).
 *
 * `what` names the record in the refusal, e.g. "Route Cards".
 */
export async function requireDeleteRight(user: AuthContext, what: string): Promise<void> {
  if (await hasDeleteRight(user)) return;
  throw new AuthorizationError(
    `Only an L6 Super Admin can delete ${what}. Ask a Super Admin to do it.`,
  );
}

/** Non-throwing twin of requireDeleteRight, for read paths that decide whether
 *  to offer Delete. Same rule as `canDeleteRecords` on the web. */
export async function hasDeleteRight(user: AuthContext): Promise<boolean> {
  if (user.role === 'admin') return true;
  const eff = await getMyAccess(user);
  return canDeleteRecords(eff);
}

/**
 * ADR-232: for the few writes that belong to a PERSON rather than a page — their
 * own Task Board work, their own saved report — there is no page tick to ask.
 * Everyone who has been set up may do them, except an L7 Auditor (who writes
 * nothing anywhere) and an account nobody has configured yet.
 */
export async function requireCanWrite(user: AuthContext): Promise<void> {
  if (user.role === 'admin') return;
  const eff = await getMyAccess(user);
  if (eff.auditor) {
    throw new AuthorizationError('Auditor access is view-only. Ask an admin if you need to save.');
  }
  if (isUnconfigured(eff)) {
    throw new AuthorizationError(
      'Your account has no access configured yet. Ask an admin to set your ' +
        'department tiers in Access Control.',
    );
  }
}

/**
 * Load the caller's access into the per-request memo (ADR-229) BEFORE a
 * transaction opens. getMyAccess runs its own transaction, so a check made
 * inside an open one would hold a second pool connection — and, after a
 * FOR UPDATE, keep the row locked while it waits. Call this first in any
 * write whose permission check can only run once the row has been read.
 */
export async function primeAccess(user: AuthContext): Promise<void> {
  if (user.role !== 'admin') await getMyAccess(user);
}
