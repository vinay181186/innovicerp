// ADR-309 — desktop pop-ups: queries and the "Desktop pop-ups" switch state.

import type { PushConfigResponse, PushTestResponse } from '@innovic/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  currentSubscription,
  pushSupported,
  subscribeThisBrowser,
  unsubscribeThisBrowser,
} from './browser';

export const pushKeys = {
  all: ['push'] as const,
  /** GET /me/push — server set up for pop-ups + VAPID public key. */
  config: () => [...pushKeys.all, 'config'] as const,
  /** This browser's permission + subscription (read from the browser, not the API). */
  browser: () => [...pushKeys.all, 'browser'] as const,
};

export function usePushConfig(enabled = true) {
  return useQuery<PushConfigResponse>({
    queryKey: pushKeys.config(),
    queryFn: () => apiFetch<PushConfigResponse>('/me/push'),
    staleTime: 5 * 60_000,
    enabled,
  });
}

interface BrowserPushState {
  permission: NotificationPermission;
  subscribed: boolean;
}

function useBrowserPush(enabled: boolean) {
  return useQuery<BrowserPushState>({
    queryKey: pushKeys.browser(),
    queryFn: async () => ({
      permission: Notification.permission,
      subscribed: (await currentSubscription()) != null,
    }),
    enabled,
  });
}

export type DesktopPopupsState = 'unsupported' | 'not-ready' | 'off' | 'on' | 'blocked';

export function useDesktopPopups() {
  const supported = pushSupported();
  const qc = useQueryClient();
  const config = usePushConfig(supported);
  const browser = useBrowserPush(supported);
  const [busy, setBusy] = useState(false);

  let state: DesktopPopupsState;
  if (!supported) state = 'unsupported';
  else if (!config.data?.enabled || !config.data.publicKey || !browser.data) state = 'not-ready';
  else if (browser.data.permission === 'denied') state = 'blocked';
  else if (browser.data.permission === 'granted' && browser.data.subscribed) state = 'on';
  else state = 'off';

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: pushKeys.browser() });

  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await work();
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return {
    state,
    busy,
    /** Call straight from the click: the browser only asks for permission on a user gesture. */
    turnOn: (): Promise<void> => {
      const publicKey = config.data?.publicKey;
      const asked = Notification.requestPermission();
      return run(async () => {
        if ((await asked) !== 'granted' || !publicKey) return;
        await subscribeThisBrowser(publicKey);
      });
    },
    turnOff: (): Promise<void> => run(unsubscribeThisBrowser),
    sendTest: (): Promise<PushTestResponse> =>
      run(() => apiFetch<PushTestResponse>('/me/push/test', { method: 'POST' })),
  };
}
