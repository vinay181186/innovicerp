// ADR-313 — a failed BACKGROUND refresh must not wipe the screen.
//
// React Query keeps the last good data when a refetch fails (window focus,
// reconnect, live update) and sets `isError`. Screens used to early-return on
// `if (isError || !row)`, so coming back to a Chrome tab after a network blip
// replaced a half-filled form with the error box. The rule now: the error box
// only when there is NO data (`if (!row)`); with data, keep the screen and show
// this one line above it.
import { Banner } from '@/ui/feedback';

export function RefreshFailedNote({ show }: { show: boolean }): React.JSX.Element | null {
  if (!show) return null;
  return (
    <Banner tone="warn">
      Could not refresh just now. Showing what was loaded; it will try again.
    </Banner>
  );
}
