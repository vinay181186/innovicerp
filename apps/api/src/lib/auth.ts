import type { AuthContext } from '../db/with-user-context';
import { AuthorizationError } from './errors';

const WRITE_ROLES = new Set(['admin', 'manager']);
const OP_ENTRY_ROLES = new Set(['admin', 'manager', 'operator']);
const QC_ROLES = new Set(['admin', 'manager', 'qc']);

export function requireWriteRole(user: AuthContext): void {
  if (!WRITE_ROLES.has(user.role)) {
    throw new AuthorizationError(`Role "${user.role}" cannot perform writes on this resource`);
  }
}

// For admin-only actions (managing users, deactivating accounts, editing
// company settings). Distinct from requireWriteRole so a manager can edit
// items / vendors / etc. but cannot promote anyone else to admin.
export function requireAdminRole(user: AuthContext): void {
  if (user.role !== 'admin') {
    throw new AuthorizationError(`Role "${user.role}" cannot perform this action — admin required`);
  }
}

// For Op Entry actions (start op, submit completion, stop op). Operators
// log shop-floor work; managers/admins can override or correct.
export function requireOpEntryRole(user: AuthContext): void {
  if (!OP_ENTRY_ROLES.has(user.role)) {
    throw new AuthorizationError(
      `Role "${user.role}" cannot record op entries — operator/manager/admin required`,
    );
  }
}

// For QC actions (record inspection). Managers/admins can override.
export function requireQcRole(user: AuthContext): void {
  if (!QC_ROLES.has(user.role)) {
    throw new AuthorizationError(
      `Role "${user.role}" cannot record QC inspections — qc/manager/admin required`,
    );
  }
}
