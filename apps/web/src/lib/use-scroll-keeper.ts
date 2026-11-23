// Scroll position back on a tab switch (ADR-313).
//
// #content is the app's scroll container (innovic-theme.css), not the window,
// so the router's own scroll restoration does not apply. This remembers
// #content's scrollTop per address (path + query) in sessionStorage and, when
// the user comes back through the open-pages tab bar, scrolls there again.
// Rows arrive after the page mounts, so it waits (up to 4 s) for the page to be
// tall enough; the user's own wheel / touch / key stops the wait at once.
// Any other navigation behaves exactly as before.
import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { clearTabSwitch, isTabSwitch } from './tab-switch';

export const SCROLL_PREFIX = 'innovic.scroll:';
const WAIT_MS = 4_000;

export function useScrollKeeper(): void {
  const href = useLocation({ select: (l) => l.href });
  useEffect(() => {
    const el = document.getElementById('content');
    if (!el) return;
    const key = SCROLL_PREFIX + href;
    let stopped = false;
    let frame = 0;
    const stop = (): void => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
    };

    if (isTabSwitch()) {
      clearTabSwitch();
      let saved = 0;
      try {
        saved = Number(sessionStorage.getItem(key) ?? 0) || 0;
      } catch {
        saved = 0;
      }
      if (saved > 0) {
        const start = Date.now();
        const tick = (): void => {
          frame = 0;
          if (stopped) return;
          if (el.scrollHeight - el.clientHeight >= saved) {
            el.scrollTop = saved;
            return;
          }
          if (Date.now() - start < WAIT_MS) frame = requestAnimationFrame(tick);
          else el.scrollTop = saved; // as far as the page goes
        };
        tick();
      }
    }

    let pending = 0;
    const onScroll = (): void => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        try {
          sessionStorage.setItem(key, String(Math.round(el.scrollTop)));
        } catch {
          // storage blocked — nothing to restore later, nothing breaks
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      stop();
      if (pending) cancelAnimationFrame(pending);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [href]);
}
