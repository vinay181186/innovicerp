import type { AuthContext } from '../db/with-user-context';
import { AuthorizationError } from './errors';

// ADR-232 (owner, 2026-10-15): the derived `users.role` no longer decides any
// write — the Access Control matrix does (`requireFormAccess` in ./access.ts).
// requireWriteRole / requireOpEntryRole / requireQcRole / isWriteRole were
// removed: they refused people the matrix allowed. The guard test
// `no-role-gates.test.ts` fails the build if one comes back.
//
// What remains is the one genuine role gate: system screens that only an L6
// Super Admin (full access — the only way to role 'admin') may use.

// For admin-only actions (managing users, access control, company settings,
// backup, approval setup).
export function requireAdminRole(user: AuthContext): void {
  if (user.role !== 'admin') {
    throw new AuthorizationError('You do not have permission to do this. Ask an admin.');
  }
}
