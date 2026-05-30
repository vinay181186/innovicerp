// Access Control client helpers.
//
// `useMyAccess()` fetches the caller's effective access matrix once per
// session and caches it. Re-exports the typed gate helpers from
// `@innovic/shared` so components can do:
//
//   const { eff } = useMyAccess();
//   if (!canEditForm(eff, 'po_create')) return null;
//   if (!hasDeptAccess(eff, 'qc')) hideSection();
//
// Unconfigured users (no full_access + no depts + no forms) fall through
// to allow-all — that's the day-one rollout shape per docs/PARITY/
// access-control.md §10 DELTA #6.

import type { EffectiveAccess } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export const myAccessKey = ['access-control', 'me'] as const;

export function useMyAccess() {
  return useQuery<EffectiveAccess>({
    queryKey: myAccessKey,
    queryFn: () => apiFetch<EffectiveAccess>('/access-control/me'),
    staleTime: 60_000,
  });
}

// Re-export the typed helpers so callers don't have to dual-import.
export {
  canViewForm,
  canEntryForm,
  canEditForm,
  hasDeptAccess,
  ACCESS_DEPTS,
  ACCESS_FORMS,
  ACCESS_DEPT_KEYS,
  ACCESS_FORM_KEYS,
  accessFormsByDept,
  type AccessDeptKey,
  type AccessFormKey,
  type EffectiveAccess,
} from '@innovic/shared';
