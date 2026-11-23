// "This navigation is a click on the open-pages tab bar" (ADR-313).
//
// The tab bar (components/shared/open-tabs-bar.tsx) marks the moment just
// before its <Link> navigates. Two readers use the mark:
//   - lib/exit-guard.tsx: a form that keeps a draft lets a tab switch through
//     without "Are you sure you want to exit?" — the draft brings the typing
//     back when the user returns (owner 2026-11-23).
//   - lib/use-scroll-keeper.ts: a tab switch puts the page back at the scroll
//     position it was left at; any other navigation starts at the top as before.
// A module variable, not router state: both readers run synchronously on the
// same navigation, and nothing else needs to see it.

const WINDOW_MS = 5_000;
let markedAt = 0;

export function markTabSwitch(): void {
  markedAt = Date.now();
}

/** True while the latest navigation came from the tab bar. */
export function isTabSwitch(): boolean {
  return markedAt > 0 && Date.now() - markedAt < WINDOW_MS;
}

/** The arriving page has used the mark; the next navigation is an ordinary one. */
export function clearTabSwitch(): void {
  markedAt = 0;
}
