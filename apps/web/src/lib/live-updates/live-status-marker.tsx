// ADR-230 — the top-bar marker that tells the user their screen may be stale.
//
// Shown ONLY while live updates cannot hear changes. Silent when live, while
// first connecting (no flash on every page load) and when this build has no
// live transport at all.

import { SyncDot } from '@/ui/core';
import { useLiveStatus } from './live-updates-provider';

export function LiveStatusMarker(): React.JSX.Element | null {
  const status = useLiveStatus();
  if (status !== 'paused') return null;
  return (
    <span
      role="status"
      title="Changes made on other PCs are not reaching this screen. Reconnecting — reload if this stays."
    >
      <SyncDot state="offline" label="Live updates paused — reconnecting" />
    </span>
  );
}
