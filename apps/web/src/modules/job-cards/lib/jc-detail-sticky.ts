// Job Card detail — page scroll + collapsible header (owner-approved option 4,
// 2026-11-02). Two small hooks, used only by jc-status-view.tsx:
//
//   useFactsCollapsed  the fact block shown / collapsed to one line, kept per
//                      browser (one person's convenience, never business data)
//   useStickyBand      the sticky band under the header (summary strip + tabs):
//                      `past` = the header has scrolled above the band, and the
//                      band's height goes to --jc-sticky-h on the page root so
//                      the ops table's header rows stick right under it.
import { useCallback, useEffect, useState } from 'react';

const COLLAPSED_KEY = 'innovic.jc-detail.facts-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useFactsCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setState] = useState(readCollapsed);
  const set = useCallback((next: boolean) => {
    setState(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }, []);
  return [collapsed, set];
}

/** The element that scrolls the page — the app's #content. */
function scroller(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>('#content') ?? null;
}

export function useStickyBand(): {
  rootRef: (el: HTMLDivElement | null) => void;
  bandRef: (el: HTMLDivElement | null) => void;
  sentinelRef: (el: HTMLDivElement | null) => void;
  past: boolean;
  toTop: () => void;
} {
  // Callback refs: the page renders a loading state first, so the elements
  // appear after the first effect run.
  const [root, rootRef] = useState<HTMLDivElement | null>(null);
  const [band, bandRef] = useState<HTMLDivElement | null>(null);
  const [sentinel, sentinelRef] = useState<HTMLDivElement | null>(null);
  const [past, setPast] = useState(false);

  // The header is "past" once the sentinel under it leaves the top of #content.
  // The sentinel sits BEFORE the band, so the band growing (strip appears)
  // never moves it — no flicker loop.
  useEffect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        const top = e.rootBounds?.top ?? 0;
        setPast(!e.isIntersecting && e.boundingClientRect.top < top);
      },
      { root: scroller(sentinel), threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (!root || !band) return;
    const put = (): void => root.style.setProperty('--jc-sticky-h', `${band.offsetHeight}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(band);
    return () => ro.disconnect();
  }, [root, band]);

  const toTop = useCallback(() => {
    scroller(root)?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [root]);

  return { rootRef, bandRef, sentinelRef, past, toTop };
}
