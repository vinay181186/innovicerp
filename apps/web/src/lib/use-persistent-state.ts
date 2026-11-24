// usePersistentState — useState that is still there when you come back (ADR-313).
//
// Every tab-bar click is a route change, so the page you leave unmounts and its
// useState is gone: the sub-tab you picked, the SO you chose in a picker, the
// rows you expanded. This keeps such VIEW choices in sessionStorage:
//   - per browser tab (sessionStorage), so two Chrome tabs do not fight, and a
//     reload or a Chrome Memory-Saver restore keeps it;
//   - cleared at sign-out with the other per-person keys (lib/session.ts), so
//     the next person on a shared PC starts clean;
//   - never business data — only what the user was looking at.
//
// `key` names the screen AND the record: `jc-detail:${id}:tab`, `pr-list:tab`.
// A null key behaves like plain useState (e.g. while the id is unknown). When
// the key changes (another record in the same component) the value is re-read.
// `valid` guards what comes back: storage is not trusted (an old build may have
// written a tab that no longer exists).
import { useCallback, useState } from 'react';

export const PERSISTENT_STATE_PREFIX = 'innovic.ui:';

function read<T>(key: string | null, fallback: T, valid: (v: unknown) => boolean): T {
  if (!key) return fallback;
  try {
    const raw = globalThis.sessionStorage?.getItem(PERSISTENT_STATE_PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string | null, value: unknown): void {
  if (!key) return;
  try {
    globalThis.sessionStorage?.setItem(PERSISTENT_STATE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the choice lasts for this visit only.
  }
}

export function usePersistentState<T>(
  key: string | null,
  fallback: T,
  valid: (v: unknown) => boolean = () => true,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key, fallback, valid) }));
  let current = state;
  if (state.key !== key) {
    // Same component, another record: take that record's saved value.
    current = { key, value: read(key, fallback, valid) };
    setState(current);
  }
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(s.value) : next;
      write(s.key, value);
      return { key: s.key, value };
    });
  }, []);
  return [current.value, set];
}

/** A list of allowed values, for `valid`: `oneOf(['ops', 'history'])`. */
export function oneOf(allowed: readonly unknown[]): (v: unknown) => boolean {
  return (v) => allowed.includes(v);
}
