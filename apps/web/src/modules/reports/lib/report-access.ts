// Which canned reports may this user see? A thin hook over the shared rule
// `canSeeReport` (@innovic/shared, lib/report-access.ts) — the same function
// the API uses for GET /reports, /reports/:slug and the Excel export, so the
// catalogue and the server can never disagree. Read the rule there.
//
// `ready` is false until both the session and the access matrix have loaded;
// callers render a loading state instead of a list that flickers as rows vanish.

import { canSeeReport, type ReportDefinition } from '@innovic/shared';
import { useCallback } from 'react';
import { useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';

export interface UseReportAccess {
  ready: boolean;
  canSee: (r: Pick<ReportDefinition, 'dept' | 'showsMoney'>) => boolean;
}

export function useReportAccess(): UseReportAccess {
  const { data: me, isLoading: meLoading } = useSession();
  const { data: eff, isLoading: effLoading } = useMyAccess();

  const canSee = useCallback(
    (r: Pick<ReportDefinition, 'dept' | 'showsMoney'>): boolean => canSeeReport(me, eff, r),
    [me, eff],
  );

  return { ready: !meLoading && !effLoading, canSee };
}
