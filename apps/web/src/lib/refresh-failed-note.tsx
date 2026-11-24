// ADR-313 — a failed BACKGROUND refresh must not wipe the screen.
//
// React Query keeps the last good data when a refetch fails (window focus,
// reconnect, live update) and sets `isError`. Screens used to early-return on
// `if (isError || !row)`, so coming back to a Chrome tab after a network blip
// replaced a half-filled form with the error box.
//
// The rule: keep the screen ONLY for a real refresh failure — the data on
// screen is the same query's last good answer (not a placeholder carried over
// from another filter) and the server did not answer "gone" or "not allowed".
// Everything else still shows the error box.
//
//   if (!row || hardError(q)) return <error box/>;
//   ...
//   <RefreshFailedNote show={q.isError} />
import { Banner } from '@/ui/feedback';

interface QueryLike {
  isError: boolean;
  error?: unknown;
  isPlaceholderData?: boolean;
}

/** 401 / 403 / 404 / 410: the record is gone or no longer yours to see. */
const HARD_STATUSES = new Set([401, 403, 404, 410]);

/** True when the error must replace the screen even though old data exists. */
export function hardError(q: QueryLike): boolean {
  if (!q.isError) return false;
  if (q.isPlaceholderData) return true; // the rows shown belong to the previous filter
  const status = (q.error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' && HARD_STATUSES.has(status);
}

export function RefreshFailedNote({ show }: { show: boolean }): React.JSX.Element | null {
  if (!show) return null;
  return (
    <Banner tone="warn">
      Could not refresh just now. Showing what was loaded; it will try again.
    </Banner>
  );
}
