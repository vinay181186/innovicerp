import type { AuthContext } from '../db/with-user-context';
import { AuthorizationError } from './errors';

const WRITE_ROLES = new Set(['admin', 'manager']);
const OP_ENTRY_ROLES = new Set(['admin', 'manager', 'operator']);
const QC_ROLES = new Set(['admin', 'manager', 'qc']);

/** requireWriteRole's rule without the throw — for read paths that list only
 *  what the caller could act on (the approvals inbox, ADR-189). */
export function isWriteRole(user: AuthContext): boolean {
  return WRITE_ROLES.has(user.role);
}

export function requireWriteRole(user: AuthContext): void {
  if (!WRITE_ROLES.has(user.role)) {
    throw new AuthorizationError('You do not have permission to change this. Ask an admin.');
  }
}

// For admin-only actions (managing users, deactivating accounts, editing
// company settings). Distinct from requireWriteRole so a manager can edit
// items / vendors / etc. but cannot promote anyone else to admin.
export function requireAdminRole(user: AuthContext): void {
  if (user.role !== 'admin') {
    throw new AuthorizationError('You do not have permission to do this. Ask an admin.');
  }
}

// For Op Entry actions (start op, submit completion, stop op). Operators
// log shop-floor work; managers/admins can override or correct.
export function requireOpEntryRole(user: AuthContext): void {
  if (!OP_ENTRY_ROLES.has(user.role)) {
    throw new AuthorizationError('You do not have permission to record Op Entry. Ask an admin.');
  }
}

// For QC actions (record inspection). Managers/admins can override.
export function requireQcRole(user: AuthContext): void {
  if (!QC_ROLES.has(user.role)) {
    throw new AuthorizationError(
      'You do not have permission to record QC inspections. Ask an admin.',
    );
  }
}
