// ADR-309 — desktop pop-ups: queries and the "Desktop pop-ups" switch state.

import type { PushConfigResponse, PushTestResponse } from '@innovic/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useToast } from '@/ui/feedback';
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

/** ONE copy of the switch's own state, shared by the every-page band and the
 *  bell row, so they never disagree and one click blocks the other. */
const usePushUi = create<{ busy: boolean; noAnswer: boolean }>(() => ({
  busy: false,
  noAnswer: false,
}));

/** True while Turn on / Turn off / test runs (PushSync must not subscribe then). */
export const pushSwitchBusy = (): boolean => usePushUi.getState().busy;

export function useDesktopPopups() {
  const supported = pushSupported();
  const qc = useQueryClient();
  const toast = useToast();
  const config = usePushConfig(supported);
  const browser = useBrowserPush(supported);
  const { busy, noAnswer } = usePushUi();

  let state: DesktopPopupsState;
  if (!supported) state = 'unsupported';
  else if (!config.data?.enabled || !config.data.publicKey || !browser.data) state = 'not-ready';
  else if (browser.data.permission === 'denied') state = 'blocked';
  else if (browser.data.permission === 'granted' && browser.data.subscribed) state = 'on';
  else state = 'off';

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: pushKeys.browser() });

  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    usePushUi.setState({ busy: true });
    try {
      return await work();
    } finally {
      await refresh();
      usePushUi.setState({ busy: false });
    }
  };

  return {
    state,
    busy,
    /** The browser's Allow box is (probably) open right now. */
    asking: busy && supported && Notification.permission === 'default',
    /** The last Turn on got no answer (box closed or hidden): show where it is. */
    noAnswer: state === 'off' && noAnswer,
    /** Call straight from the click: the browser only asks for permission on a
     *  user gesture. A second click while one runs does nothing. Errors go to a toast. */
    turnOn: (): void => {
      if (usePushUi.getState().busy) return;
      const publicKey = config.data?.publicKey;
      const asked = Notification.requestPermission();
      usePushUi.setState({ noAnswer: false });
      run(async () => {
        const answer = await asked;
        if (answer === 'granted' && publicKey) await subscribeThisBrowser(publicKey);
        usePushUi.setState({ noAnswer: answer === 'default' });
      }).catch(() => {
        toast.error('Could not turn on desktop pop-ups. Reload the page and try again.');
      });
    },
    turnOff: (): Promise<void> => run(unsubscribeThisBrowser),
    sendTest: (): Promise<PushTestResponse> =>
      run(() => apiFetch<PushTestResponse>('/me/push/test', { method: 'POST' })),
  };
}
