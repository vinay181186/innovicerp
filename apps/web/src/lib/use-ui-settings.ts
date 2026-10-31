// The logged-in user's UI settings (ADR-199): the table density, Comfortable /
// Compact, one choice for EVERY table — and (ADR-264) how the home's department
// check lines open: `dashboardListOpen` plus the per-check overrides
// `dashboardCheckOpen`.
//
// GET /me/ui-settings on first use; any failure (including a 404 before the
// API side is deployed) falls back to Comfortable silently. A change applies
// at once — the `density-compact` class on <body> — and is then saved with
// PUT /me/ui-settings. A failed save re-reads the settings from the server.

import { useCallback, useEffect } from 'react';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_DASHBOARD_LIST_OPEN,
  type MeResponse,
  DEFAULT_TABLE_DENSITY,
  type SaveUiSettingsInput,
  type TableDensity,
  type UiSettings,
  uiSettingsSchema,
} from '@innovic/shared';

import { apiFetch } from './api';
import { sessionQueryKey, useSession } from './session';

/** Keyed by the logged-in user (shared PCs); every ['me', …] query is removed
 *  on sign-out (lib/session.ts). */
export const uiSettingsQueryKey = (userId: string) => ['me', 'ui-settings', userId] as const;
export const DENSITY_BODY_CLASS = 'density-compact';

const FALLBACK: UiSettings = {
  tableDensity: DEFAULT_TABLE_DENSITY,
  dashboardListOpen: DEFAULT_DASHBOARD_LIST_OPEN,
  dashboardCheckOpen: {},
};

/** Field by field, so an older API that answers only `tableDensity` still
 *  keeps the user's density (the missing fields take their defaults). */
function readSettings(raw: unknown): UiSettings {
  const parsed = uiSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) return FALLBACK;
  const d = parsed.data;
  return {
    tableDensity: d.tableDensity ?? FALLBACK.tableDensity,
    dashboardListOpen: d.dashboardListOpen ?? FALLBACK.dashboardListOpen,
    dashboardCheckOpen: d.dashboardCheckOpen ?? {},
  };
}

/** The cache after a save — the same rules the server applies: a new
 *  `dashboardListOpen` clears every per-check override; per-check entries
 *  merge into the record. */
export function applySave(prev: UiSettings, next: SaveUiSettingsInput): UiSettings {
  const out: UiSettings = { ...prev };
  if (next.tableDensity) out.tableDensity = next.tableDensity;
  if (next.dashboardListOpen) {
    out.dashboardListOpen = next.dashboardListOpen;
    out.dashboardCheckOpen = {};
  }
  if (next.dashboardCheckOpen) {
    out.dashboardCheckOpen = { ...out.dashboardCheckOpen };
    for (const c of next.dashboardCheckOpen) out.dashboardCheckOpen[c.checkKey] = c.open;
  }
  return out;
}

export function applyDensity(density: TableDensity): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(DENSITY_BODY_CLASS, density === 'compact');
}

// ADR-264 — every PUT waits for the one before it. Without this, two quick
// clicks (Show then Hide on one check, or a per-check toggle then a new
// "Lists open as" default, which clears the overrides) could commit out of
// order and leave the server different from the screen. One chain per signed-in
// user: a new user starts a fresh chain, and a queued save whose user is no
// longer the session user is dropped when its turn comes (shared PCs). A failed
// save never blocks the next one; once the queue has drained, a failure
// refetches the settings so the screen shows what the server actually holds
// instead of the optimistic value.
let saveChain: Promise<unknown> = Promise.resolve();
let chainUser: string | undefined;
let pending = 0;
let failed = false;
function enqueueSave(qc: QueryClient, userId: string, next: SaveUiSettingsInput): void {
  if (chainUser !== userId) {
    chainUser = userId;
    saveChain = Promise.resolve();
    pending = 0;
    failed = false;
  }
  pending += 1;
  saveChain = saveChain
    .then(async () => {
      if (qc.getQueryData<MeResponse | null>(sessionQueryKey)?.id !== userId) return;
      await apiFetch<UiSettings>('/me/ui-settings', { method: 'PUT', json: next });
    })
    .catch(() => {
      if (chainUser === userId) failed = true;
    })
    .finally(() => {
      if (chainUser !== userId) return; // chain was reset for another user
      pending -= 1;
      if (pending === 0 && failed) {
        failed = false;
        void qc.invalidateQueries({ queryKey: uiSettingsQueryKey(userId) });
      }
    });
}

export function useUiSettings(): {
  settings: UiSettings;
  save: (next: SaveUiSettingsInput) => void;
} {
  const qc = useQueryClient();
  const userId = useSession().data?.id;
  const queryKey = uiSettingsQueryKey(userId ?? '');
  const query = useQuery<UiSettings>({
    queryKey,
    enabled: userId !== undefined,
    queryFn: async () => {
      try {
        const out = readSettings(await apiFetch<unknown>('/me/ui-settings'));
        // Applied here, before the data reaches any screen, so a table that
        // measures its columns on that render already sees the right density.
        applyDensity(out.tableDensity);
        return out;
      } catch {
        return FALLBACK;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  const settings = query.data ?? FALLBACK;

  useEffect(() => {
    applyDensity(settings.tableDensity);
  }, [settings.tableDensity]);

  const save = useCallback(
    (next: SaveUiSettingsInput) => {
      // Instant: the class and the cache flip now; the save follows.
      // Only ever on the user's own click — never on mount. The PUTs go one at
      // a time, in click order (enqueueSave), so the server ends where the
      // screen does even when two clicks land close together.
      qc.setQueryData<UiSettings>(uiSettingsQueryKey(userId ?? ''), (prev) =>
        applySave(prev ?? FALLBACK, next),
      );
      if (next.tableDensity) applyDensity(next.tableDensity);
      if (userId) enqueueSave(qc, userId, next);
    },
    [qc, userId],
  );

  return { settings, save };
}

/** The table density and its setter — what the table toolbar uses. */
export function useTableDensity(): {
  density: TableDensity;
  setDensity: (d: TableDensity) => void;
} {
  const { settings, save } = useUiSettings();
  const setDensity = useCallback((d: TableDensity) => save({ tableDensity: d }), [save]);
  return { density: settings.tableDensity, setDensity };
}
