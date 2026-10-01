// The logged-in user's UI settings (ADR-199): today only the table density,
// Comfortable / Compact, one choice for EVERY table.
//
// GET /me/ui-settings on first use; any failure (including a 404 before the
// API side is deployed) falls back to Comfortable silently. A change applies
// at once — the `density-compact` class on <body> — and is then saved with
// PUT /me/ui-settings. A failed save keeps the choice for this session.

import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_TABLE_DENSITY,
  type SaveUiSettingsInput,
  type TableDensity,
  type UiSettings,
  uiSettingsSchema,
} from '@innovic/shared';

import { apiFetch } from './api';
import { useSession } from './session';

/** Keyed by the logged-in user (shared PCs); every ['me', …] query is removed
 *  on sign-out (lib/session.ts). */
export const uiSettingsQueryKey = (userId: string) => ['me', 'ui-settings', userId] as const;
export const DENSITY_BODY_CLASS = 'density-compact';

const FALLBACK: UiSettings = { tableDensity: DEFAULT_TABLE_DENSITY };

export function applyDensity(density: TableDensity): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(DENSITY_BODY_CLASS, density === 'compact');
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
        const parsed = uiSettingsSchema.safeParse(await apiFetch<unknown>('/me/ui-settings'));
        const out = parsed.success ? parsed.data : FALLBACK;
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

  const mutation = useMutation({
    mutationFn: (next: SaveUiSettingsInput) =>
      apiFetch<UiSettings>('/me/ui-settings', { method: 'PUT', json: next }),
  });
  const { mutate } = mutation;

  const save = useCallback(
    (next: SaveUiSettingsInput) => {
      // Instant: the class and the cache flip now; the save follows.
      // Only ever on the user's own click — never on mount — and density is
      // one value, so the last write is the right one.
      qc.setQueryData<UiSettings>(uiSettingsQueryKey(userId ?? ''), (prev) => ({
        ...(prev ?? FALLBACK),
        ...next,
      }));
      applyDensity(next.tableDensity);
      mutate(next);
    },
    [qc, mutate, userId],
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
