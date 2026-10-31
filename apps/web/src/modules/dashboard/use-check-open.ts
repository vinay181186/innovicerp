// ADR-262 — which department check lines are open, per user.
//
// Open = dashboardCheckOpen[key] when the user has set it by hand, else
// dashboardListOpen === 'expanded'. Every change is saved at once through the
// one ui-settings cache (lib/use-ui-settings.ts): the screen flips first, the
// PUT follows. A new default clears the overrides — on the server and in the
// cache alike (applySave).

import type { DashCheck, DashboardListOpen } from '@innovic/shared';
import { useUiSettings } from '@/lib/use-ui-settings';

export function useCheckOpen() {
  const { settings, save } = useUiSettings();
  const isOpen = (key: string): boolean =>
    settings.dashboardCheckOpen[key] ?? settings.dashboardListOpen === 'expanded';
  return {
    listOpen: settings.dashboardListOpen,
    isOpen,
    toggle: (key: string): void =>
      save({ dashboardCheckOpen: [{ checkKey: key, open: !isOpen(key) }] }),
    /** Expand all / Collapse all — the current department's checks, one save. */
    setAll: (checks: readonly DashCheck[], open: boolean): void => {
      if (checks.length === 0) return;
      save({ dashboardCheckOpen: checks.map((c) => ({ checkKey: c.key, open })) });
    },
    /** Also when it is already the default: picking it again puts every
     *  hand-opened / hand-closed line back to the default. */
    setDefault: (v: DashboardListOpen): void => save({ dashboardListOpen: v }),
  };
}
