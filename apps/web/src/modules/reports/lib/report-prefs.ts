// Per-user report preferences for the /reports catalogue: the reports a user
// has starred ("★ My Reports") and the ones they opened last ("Recently
// opened"). Kept in this browser's localStorage, one key per logged-in user,
// so two people sharing a shop-floor PC do not see each other's stars.
//
// Every storage read/write is wrapped: private mode, a full quota or a blocked
// storage API must never break the Reports page — it just means no stars.
//
// One module-level cache + listener set, read through useSyncExternalStore, so
// starring a report on the catalogue and on the report page stay in step, and
// a change made in another browser tab (the `storage` event) shows up too.

import { useCallback, useSyncExternalStore } from 'react';
import { useSession } from '@/lib/session';

interface ReportPrefs {
  starred: readonly string[];
  recent: readonly string[];
}

/** How many recently opened reports are remembered (and shown). */
const RECENT_MAX = 5;
const KEY_PREFIX = 'innovic.reports.prefs.';
const EMPTY: ReportPrefs = { starred: [], recent: [] };

const cache = new Map<string, ReportPrefs>();
const listeners = new Set<() => void>();

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function load(userId: string): ReportPrefs {
  const hit = cache.get(userId);
  if (hit) return hit;
  let prefs: ReportPrefs = EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as { starred?: unknown; recent?: unknown } | null;
      prefs = {
        starred: stringList(parsed?.starred),
        recent: stringList(parsed?.recent).slice(0, RECENT_MAX),
      };
    }
  } catch {
    prefs = EMPTY;
  }
  cache.set(userId, prefs);
  return prefs;
}

function save(userId: string, next: ReportPrefs): void {
  cache.set(userId, next);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // storage blocked / full — keep the in-memory copy for this session
  }
  for (const l of listeners) l();
}

// ONE window `storage` listener for the whole module, however many
// subscribers there are (the catalogue mounts a StarToggle per chip). Added on
// the first subscribe, removed when the last subscriber leaves. A change made
// in another tab clears the cache once and wakes every subscriber.
function onStorage(e: StorageEvent): void {
  if (e.key !== null && !e.key.startsWith(KEY_PREFIX)) return;
  cache.clear();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export interface UseReportPrefs {
  starred: readonly string[];
  /** Most recent first, at most 5. */
  recent: readonly string[];
  isStarred: (slug: string) => boolean;
  toggleStar: (slug: string) => void;
  pushRecent: (slug: string) => void;
}

export function useReportPrefs(): UseReportPrefs {
  const { data: me } = useSession();
  const userId = me?.id ?? null;

  const prefs = useSyncExternalStore(subscribe, () => (userId ? load(userId) : EMPTY));

  const isStarred = useCallback((slug: string) => prefs.starred.includes(slug), [prefs]);

  const toggleStar = useCallback(
    (slug: string) => {
      if (!userId) return;
      const cur = load(userId);
      const starred = cur.starred.includes(slug)
        ? cur.starred.filter((s) => s !== slug)
        : [...cur.starred, slug];
      save(userId, { ...cur, starred });
    },
    [userId],
  );

  const pushRecent = useCallback(
    (slug: string) => {
      if (!userId) return;
      const cur = load(userId);
      if (cur.recent[0] === slug) return;
      const recent = [slug, ...cur.recent.filter((s) => s !== slug)].slice(0, RECENT_MAX);
      save(userId, { ...cur, recent });
    },
    [userId],
  );

  return { starred: prefs.starred, recent: prefs.recent, isStarred, toggleStar, pushRecent };
}
