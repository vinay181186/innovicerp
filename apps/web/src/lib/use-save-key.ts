// R2 — "one save = one key" (ADR-172 follow-up, wave 3).
//
// The API's idempotency plugin (apps/api/src/plugins/idempotency.ts) answers a
// repeat of a key it has already seen with the FIRST run's stored result
// instead of running the handler again. apiFetch used to mint a fresh key for
// every call, which only covered the browser resending one request by itself.
// It did NOT cover the user clicking Save again after a dropped connection or a
// timeout — that second click carried a new key, so the server created a second
// document.
//
// A form now owns ONE key from the moment it opens (`useSaveKey()`), and every
// retry of that save reuses it until the server gives a definite answer:
//
//   - 2xx                 → saved. The key is spent; the next save (Save & New,
//                           or the next form) gets a fresh one.
//   - 4xx (not in_progress) → the server said no (validation, conflict …). The
//                           plugin STORES 4xx and would replay it for the same
//                           key, so after the user fixes the form the next
//                           click must carry a new key. Rotated.
//   - no answer (network error / timeout), 409 in_progress, 5xx
//                         → we do not know whether it saved (or the server
//                           dropped the row, 5xx). KEEP the key: the next click
//                           either replays the first result or runs afresh.
//
// It also answers R6's "don't close the tab mid-save": while any save that went
// through `withSaveKey` is in flight, closing / refreshing the tab asks first.
//
// Usage:
//
//   const saveKey = useSaveKey();
//   const create = useCreateThing(saveKey);          // hook passes it to withSaveKey
//
//   // in the api.ts hook
//   export function useCreateThing(saveKey?: SaveKey) {
//     return useMutation({
//       mutationFn: (input) =>
//         withSaveKey(saveKey, (headers) =>
//           apiFetch('/things', { method: 'POST', json: input, headers })),
//     });
//   }
//
// Only the ONE main write of a save should carry the key: the plugin refuses a
// key reused on a different path (422 idempotency_key_reused).

import { useEffect, useRef } from 'react';
import { ApiError, newRequestKey } from './api';

export interface SaveKey {
  /** The key the next attempt of this save will carry. */
  current: () => string;
  /** Throw the key away — the next attempt is a NEW save. */
  rotate: () => void;
  /** Number of saves through this key that are waiting for the server. */
  inFlight: { count: number };
}

/** Did the server give a final answer, after which the same key must not be reused? */
function isDefiniteAnswer(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false; // a bug in the caller — keep the key
  if (err.status === 0) return false; // network_error / timeout: outcome unknown
  if (err.status >= 500) return false; // plugin dropped the row; a retry runs afresh
  if (err.status === 409 && err.code === 'in_progress') return false; // first run still going
  return true;
}

/**
 * Run the main write of a save with the form's key. Without a key (a caller
 * that has not been wired) it behaves exactly like before: apiFetch mints a
 * one-off key.
 */
export async function withSaveKey<T>(
  saveKey: SaveKey | undefined,
  run: (headers: Record<string, string> | undefined) => Promise<T>,
): Promise<T> {
  if (!saveKey) return run(undefined);
  saveKey.inFlight.count += 1;
  try {
    const result = await run({ 'idempotency-key': saveKey.current() });
    saveKey.rotate();
    return result;
  } catch (err) {
    if (isDefiniteAnswer(err)) saveKey.rotate();
    throw err;
  } finally {
    saveKey.inFlight.count -= 1;
  }
}

/** One idempotency key per open form, reused for every retry of its save. */
export function useSaveKey(): SaveKey {
  const ref = useRef<SaveKey | null>(null);
  if (ref.current === null) {
    let key = newRequestKey();
    ref.current = {
      current: () => key,
      rotate: () => {
        key = newRequestKey();
      },
      inFlight: { count: 0 },
    };
  }
  const saveKey = ref.current;

  // R6: closing or refreshing the tab while the save is on its way asks first
  // (the browser shows its own generic wording; a page cannot choose it).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveKey.inFlight.count <= 0) return;
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveKey]);

  return saveKey;
}
