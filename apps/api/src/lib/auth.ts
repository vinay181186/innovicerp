import type { AuthContext } from '../db/with-user-context';
import { AuthorizationError } from './errors';

const WRITE_ROLES = new Set(['admin', 'manager']);

export function requireWriteRole(user: AuthContext): void {
  if (!WRITE_ROLES.has(user.role)) {
    throw new AuthorizationError(`Role "${user.role}" cannot perform writes on this resource`);
  }
}
