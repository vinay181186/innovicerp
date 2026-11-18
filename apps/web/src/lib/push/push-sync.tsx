// ADR-309 — once per page load: re-tie this laptop's pop-up subscription to the
// person now signed in (idempotent on the server), and listen to the service
// worker — a pop-up arrived → refresh the bell and the Task Board; a pop-up
// clicked while the worker could not navigate → open its screen here.

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { notificationKeys } from '@/modules/dashboard/api';
import { taskKeys } from '@/modules/tasks/api';
import { currentSubscription, pushSupported, saveSubscription } from './browser';

let resynced = false;

export function PushSync(): null {
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!pushSupported()) return undefined;
    if (!resynced && Notification.permission === 'granted') {
      resynced = true;
      void currentSubscription()
        .then((sub) => (sub ? saveSubscription(sub) : undefined))
        .catch(() => undefined);
    }
    const onMessage = (e: MessageEvent): void => {
      const msg = e.data as { type?: string; href?: unknown } | null;
      if (msg?.type === 'task-notice') {
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
        void qc.invalidateQueries({ queryKey: taskKeys.all });
      } else if (msg?.type === 'open' && typeof msg.href === 'string' && msg.href.startsWith('/')) {
        router.history.push(msg.href);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [qc, router]);

  return null;
}
