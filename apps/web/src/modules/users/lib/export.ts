// ADR-310 — the User Management list's shared Export (copies the JWSO pilot).
//
// One sheet "User Management": ONLY the columns the user sees (Name,
// Department, Access, Email, Phone, Status, Approver). The list API carries
// no password or token, and nothing beyond the visible columns is written.
// Status is a StatusBadge and Access a component, so both get plain words.

import type {
  ListUsersQuery,
  ListUsersResponse,
  UserAccessListItem,
  UserRole,
} from '@innovic/shared';
import { ROLE_LABEL } from '@/lib/role-label';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchUsersPage } from '../api';

export type UserRow = ListUsersResponse['items'][number];

/** The words AccessCell shows. */
function accessWords(a: UserAccessListItem | undefined): string | null {
  if (!a) return null;
  if (a.fullAccess) return 'L6 Super Admin';
  if (a.auditor) return 'L7 Auditor';
  return a.tierSummary || 'No access';
}

export function withUserExportValues(
  columns: DataTableColumn<UserRow>[],
  accessByUser: Map<string, UserAccessListItem>,
): DataTableColumn<UserRow>[] {
  return columns.map((c) => {
    if (c.id === 'access') return { ...c, exportValue: (u) => accessWords(accessByUser.get(u.id)) };
    if (c.id === 'status')
      return { ...c, exportValue: (u) => (u.isActive ? 'Active' : 'Inactive') };
    return c;
  });
}

export interface UsersExportArgs {
  columns: DataTableColumn<UserRow>[];
  tableKey: string;
  search: string | undefined;
  role: UserRole | undefined;
  isActive: boolean | undefined;
  sfParam: string | undefined;
}

export function usersExportSpec(a: UsersExportArgs): ListExportSpec<UserRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.role ? `role ${ROLE_LABEL[a.role]}` : null,
    a.isActive === undefined ? null : a.isActive ? 'Active only' : 'Inactive only',
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListUsersQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.role ? { role: a.role } : {}),
    ...(a.isActive === undefined ? {} : { isActive: a.isActive }),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'User Management',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchUsersPage({ ...base, limit, offset }),
  };
}
