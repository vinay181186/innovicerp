// ADR-250 — mark home notifications seen: when the bell is clicked, or when the
// Notifications panel first comes into view. Sends the newest item's time; the
// server keeps the later of stored and sent, so a repeat is harmless. Each
// newest-time is sent once.

import type { HomeResponse } from '@innovic/shared';
import { useCallback, useEffect, useState } from 'react';
import { useMarkNotificationsSeen } from './api';

export function useNotificationsSeen(notes: HomeResponse['notifications']) {
  const { mutate } = useMarkNotificationsSeen();
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  const newest = notes.items.reduce<string | null>(
    (max, n) => (max == null || Date.parse(n.ts) > Date.parse(max) ? n.ts : max),
    null,
  );
  const pending = notes.unseen > 0 && newest != null && sentFor !== newest;

  const markSeen = useCallback((): void => {
    if (!pending || newest == null) return;
    setSentFor(newest);
    mutate({ seenAt: new Date(newest).toISOString() });
  }, [pending, newest, mutate]);

  useEffect(() => {
    if (!panel || !pending || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) markSeen();
    });
    io.observe(panel);
    return () => io.disconnect();
  }, [panel, pending, markSeen]);

  /** Bell: scroll the panel into view and mark seen. */
  const openPanel = (): void => {
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    markSeen();
  };

  return { panelRef: setPanel, openPanel };
}
