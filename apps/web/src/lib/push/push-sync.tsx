// ADR-309 — once per page load: re-tie this laptop's pop-up subscription to the
// person now signed in (idempotent on the server), and listen to the service
// worker — a pop-up arrived → refresh the bell and the Task Board; a pop-up
// clicked while the worker could not navigate → open its screen here.

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { notificationKeys } from '@/modules/dashboard/api';
import { taskKeys } from '@/modules/tasks/api';
import type { PushConfigResponse } from '@innovic/shared';
import { apiFetch } from '@/lib/api';
import { pushKeys, pushSwitchBusy } from './api';
import {
  currentSubscription,
  pushSupported,
  saveOrRenewSubscription,
  subscribeThisBrowser,
} from './browser';

let resynced = false;

export function PushSync(): null {
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!pushSupported()) return undefined;
    const resave = (): void => {
      if (Notification.permission !== 'granted') return;
      void currentSubscription()
        .then((sub) => (sub ? saveOrRenewSubscription(sub) : undefined))
        .catch(() => undefined);
    };
    if (!resynced && Notification.permission === 'granted') {
      resynced = true;
      resave();
    }
    const onMessage = (e: MessageEvent): void => {
      const msg = e.data as { type?: string; href?: unknown } | null;
      if (msg?.type === 'push-resync') {
        // the browser rotated the subscription — tie the new one to this person
        resave();
      } else if (msg?.type === 'task-notice') {
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
        void qc.invalidateQueries({ queryKey: taskKeys.all });
      } else if (msg?.type === 'open' && typeof msg.href === 'string' && msg.href.startsWith('/')) {
        router.history.push(msg.href);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    // Allow / Block given from the address bar (the band's hint) fires no
    // click here: watch the permission, refresh the switch, and once granted
    // with no subscription yet, subscribe (no click is needed after a grant).
    let perm: PermissionStatus | null = null;
    const onPermission = (): void => {
      void qc.invalidateQueries({ queryKey: pushKeys.browser() });
      // Turn on is already subscribing for this grant: leave it to that.
      if (perm?.state !== 'granted' || pushSwitchBusy()) return;
      void (async () => {
        if (await currentSubscription()) return;
        const cfg = await qc.fetchQuery({
          queryKey: pushKeys.config(),
          queryFn: () => apiFetch<PushConfigResponse>('/me/push'),
        });
        if (cfg.enabled && cfg.publicKey) await subscribeThisBrowser(cfg.publicKey);
        await qc.invalidateQueries({ queryKey: pushKeys.browser() });
      })().catch(() => undefined);
    };
    void navigator.permissions
      ?.query({ name: 'notifications' })
      .then((p) => {
        perm = p;
        p.addEventListener('change', onPermission);
      })
      .catch(() => undefined);

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      perm?.removeEventListener('change', onPermission);
    };
  }, [qc, router]);

  return null;
}
