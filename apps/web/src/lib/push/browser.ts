// ADR-309 — desktop pop-ups: the browser half (no React). The service worker
// is public/sw.js; it only shows pop-ups and never caches anything.

import type { SavePushSubscriptionInput } from '@innovic/shared';
import { apiFetch } from '@/lib/api';

export const SW_URL = '/sw.js';

/** Service worker + Push + Notification all present (not e.g. an old browser or http). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID public key (base64url) → the bytes pushManager.subscribe wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** This browser's current subscription, or null. Never registers the worker. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** PushSubscription.toJSON() narrowed to the contract's shape. */
export function toSaveInput(sub: PushSubscription): SavePushSubscriptionInput {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
  };
}

export function saveSubscription(sub: PushSubscription): Promise<unknown> {
  return apiFetch('/me/push/subscription', { method: 'POST', json: toSaveInput(sub) });
}

export function removeSubscription(endpoint: string): Promise<unknown> {
  return apiFetch('/me/push/subscription', { method: 'DELETE', json: { endpoint } });
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const have = sub.options.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/** Register the worker, subscribe (or reuse a subscription made with the same
 *  key) and tie it to the signed-in person. Permission must already be granted. */
export async function subscribeThisBrowser(publicKey: string): Promise<void> {
  await navigator.serviceWorker.register(SW_URL);
  const reg = await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as BufferSource,
  });
  await saveSubscription(sub);
}

/** Switch off on this laptop: forget it on the server, then in the browser. */
export async function unsubscribeThisBrowser(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await removeSubscription(sub.endpoint);
  await sub.unsubscribe();
}

/** Sign-out: best effort, never longer than `ms`, never throws — a pop-up
 *  plumbing problem must not keep anyone signed in. */
export async function dropSubscriptionOnSignOut(ms = 2000): Promise<void> {
  const work = (async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      await removeSubscription(sub.endpoint);
    } finally {
      await sub.unsubscribe();
    }
  })();
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}
