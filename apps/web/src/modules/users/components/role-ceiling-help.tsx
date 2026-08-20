// One line under the Role select saying what the chosen role can actually
// deliver (0100).
//
// Role and tier are two different things and the difference was invisible
// before: the role decides what the DATABASE will accept (the row-level
// security policies are keyed to it), while the tier in Access Control
// decides how much of that the person is given. Four of the eight roles —
// procurement, dispatch, design, viewer — appear in no write policy at all,
// so assigning one silently produces a user who cannot save anything. That
// deserves to be said at the moment of choosing, not discovered in use.

import { maxTierForRole, type UserRole } from '@innovic/shared';

const ROLE_NOTE: Partial<Record<UserRole, string>> = {
  admin: 'Full rights everywhere, bypasses the access matrix, and can approve any PO regardless of value.',
  manager: 'Can create and change records across every module. Can be given Approve rights per department.',
  operator: 'Records shop-floor work. A date/time correction goes to a manager for approval.',
  qc: 'Records and amends inspections, disposes NCs.',
  procurement: 'Carries no write rights anywhere — read-only in practice.',
  dispatch: 'Carries no write rights anywhere — read-only in practice.',
  design: 'Carries no write rights anywhere — read-only in practice. Designers need the manager role.',
  viewer: 'Read-only by design. Pair with the L7 Auditor flag in Access Control for a proper auditor account.',
};

export function RoleCeilingHelp({ role }: { role: UserRole }): React.JSX.Element {
  const ceiling = maxTierForRole(role);
  const readOnly = ceiling === 'L1';
  return (
    <div
      className="form-help"
      style={readOnly ? { color: 'var(--amber)' } : undefined}
    >
      {ROLE_NOTE[role] ?? ''} Highest Access Control tier this role can deliver: <b>{ceiling}</b>
      {readOnly ? ' — any tier above L1 will save but have no effect.' : '.'}
    </div>
  );
}
