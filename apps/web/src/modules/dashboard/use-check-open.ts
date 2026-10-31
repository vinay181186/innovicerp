// ADR-264 — which department check lines are open, per user.
//
// Open = dashboardCheckOpen[key] when the user has set it by hand, else
// dashboardListOpen === 'expanded'. Every change goes through the one
// ui-settings cache (lib/use-ui-settings.ts): the screen flips at once, and the
// PUTs are sent one at a time in click order, so the server ends up matching
// the screen. The screen no longer offers a default switch (owner 31-Oct); the
// stored dashboardListOpen (default 'collapsed') still applies.

import type { DashCheck } from '@innovic/shared';
import { useUiSettings } from '@/lib/use-ui-settings';

export function useCheckOpen() {
  const { settings, save } = useUiSettings();
  const isOpen = (key: string): boolean =>
    settings.dashboardCheckOpen[key] ?? settings.dashboardListOpen === 'expanded';
  return {
    isOpen,
    toggle: (key: string): void =>
      save({ dashboardCheckOpen: [{ checkKey: key, open: !isOpen(key) }] }),
    /** Expand all / Collapse all — the current department's checks, one save. */
    setAll: (checks: readonly DashCheck[], open: boolean): void => {
      if (checks.length === 0) return;
      save({ dashboardCheckOpen: checks.map((c) => ({ checkKey: c.key, open })) });
    },
  };
}
