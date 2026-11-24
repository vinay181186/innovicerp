// Scroll position back on a tab switch (ADR-313).
//
// Two things scroll in this app: #content (the page area, innovic-theme.css)
// and, on FIT lists, the table's own box (`.tbl-wrap`, ADR-199) — the page
// itself does not move there. The router's scroll restoration knows neither.
// This remembers #content's scrollTop AND every table box's, per page path
// (the query is ignored), in sessionStorage, and when the user comes back through the
// open-pages tab bar scrolls them there again. Rows arrive after the page
// mounts, so it waits (up to 4 s) until each one is tall enough; the user's own
// wheel / touch / key stops the wait at once. Any other navigation behaves
// exactly as before.
import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { clearTabSwitch, isTabSwitch } from './tab-switch';

export const SCROLL_PREFIX = 'innovic.scroll:';
const WAIT_MS = 4_000;
const BOX = '.tbl-wrap';

interface Saved {
  page: number;
  boxes: number[];
}

function read(key: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved> | number;
    if (typeof v === 'number') return { page: v, boxes: [] };
    return {
      page: Number(v.page) || 0,
      boxes: Array.isArray(v.boxes) ? v.boxes.map((n) => Number(n) || 0) : [],
    };
  } catch {
    return null;
  }
}

export function useScrollKeeper(): void {
  // Per PATH, not path + query: lists rewrite their query on arrival (?page=1),
  // which would miss the saved key and re-run this effect after the mark is used.
  const path = useLocation({ select: (l) => l.pathname });
  useEffect(() => {
    const el = document.getElementById('content');
    if (!el) return;
    const key = SCROLL_PREFIX + path;
    const boxes = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(BOX));
    let stopped = false;
    let frame = 0;
    const stop = (): void => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
    };

    if (isTabSwitch()) {
      clearTabSwitch();
      const saved = read(key);
      if (saved && (saved.page > 0 || saved.boxes.some((n) => n > 0))) {
        const start = Date.now();
        const fits = (node: HTMLElement, top: number): boolean =>
          node.scrollHeight - node.clientHeight >= top;
        const tick = (): void => {
          frame = 0;
          if (stopped) return;
          const late = Date.now() - start >= WAIT_MS;
          let pending = false;
          if (saved.page > 0) {
            if (fits(el, saved.page) || late) el.scrollTop = saved.page;
            else pending = true;
          }
          const list = boxes();
          saved.boxes.forEach((top, i) => {
            if (top <= 0) return;
            const node = list[i];
            if (node && (fits(node, top) || late)) node.scrollTop = top;
            else pending = true;
          });
          if (pending && !late) frame = requestAnimationFrame(tick);
        };
        tick();
      }
    }

    let pending = 0;
    const save = (): void => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const value: Saved = {
          page: Math.round(el.scrollTop),
          boxes: boxes().map((b) => Math.round(b.scrollTop)),
        };
        try {
          sessionStorage.setItem(key, JSON.stringify(value));
        } catch {
          // storage blocked — nothing to restore later, nothing breaks
        }
      });
    };
    // `scroll` does not bubble; a capture listener on #content also hears the
    // table boxes inside it.
    el.addEventListener('scroll', save, { passive: true, capture: true });
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      stop();
      if (pending) cancelAnimationFrame(pending);
      el.removeEventListener('scroll', save, { capture: true });
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [path]);
}
