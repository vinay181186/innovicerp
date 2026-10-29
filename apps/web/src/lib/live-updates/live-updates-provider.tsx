// ADR-230 — mounts live updates once for a signed-in user, and the two hooks
// screens use: the status (for the top-bar marker) and a per-record watch (for
// an edit screen's "changed by another user" notice).

import type { LiveTable } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { RecordWatch } from '@/lib/use-record-watch';
import { activeTransport } from './active-transport';
import { LiveSync, type LiveStatus } from './live-sync';
import { tokenCompanyProblem } from './token-check';

const LiveSyncContext = createContext<LiveSync | null>(null);

export function LiveUpdatesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [sync] = useState(() => new LiveSync(queryClient));
  const companyId = useSession().data?.companyId ?? null;

  useEffect(() => {
    // No company yet (session still loading) or no transport in this build:
    // nothing to listen to. The fallback refreshes still run.
    if (!activeTransport || !companyId) return;
    const stop = sync.start(activeTransport, companyId);
    let cancelled = false;
    const check = (): void => {
      void tokenCompanyProblem(companyId).then((problem) => {
        if (cancelled) return;
        if (problem === null) sync.clearTokenProblem();
        else sync.reportTokenProblem(problem);
      });
    };
    check();
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') check();
    });
    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
      stop();
    };
  }, [sync, companyId]);

  return <LiveSyncContext.Provider value={sync}>{children}</LiveSyncContext.Provider>;
}

const OFF = (): LiveStatus => 'off';
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

export function useLiveStatus(): LiveStatus {
  const sync = useContext(LiveSyncContext);
  return useSyncExternalStore(sync?.subscribeStatus ?? NO_SUBSCRIBE, sync?.getStatus ?? OFF);
}

/**
 * Has anybody changed this record since the screen opened? Same contract as
 * `useRecordWatch` (ADR-226): it only raises a flag and never touches the form,
 * so nothing the user typed is re-seeded or cleared. The real guard stays the
 * version check on save.
 */
export function useLiveRecordWatch(table: LiveTable, id: string | undefined): RecordWatch {
  const sync = useContext(LiveSyncContext);
  const [changedByOther, setChangedByOther] = useState(false);

  useEffect(() => {
    if (!sync || !id) return;
    return sync.watchRecord(table, id, () => setChangedByOther(true));
  }, [sync, table, id]);

  const acknowledge = useCallback(() => setChangedByOther(false), []);
  return { changedByOther, acknowledge };
}
