// Which report columns the fit engine has on screen, left to right
// (ADR-199 Phase 4). The engine decides that inside <DataTable> (the user's
// saved order / hidden / pins, then what still fits the width) and does not
// hand it out, so the grid reads it back off the drawn header: every report
// header carries `data-rpt-col`. Used to line the Total row up under its
// columns and to order the column-filter strip.
//
// A MutationObserver, not a render-time read: the engine re-lays the table on
// its own (a resize, a Columns ▾ change) without the report grid rendering.
import { useEffect, useState, type RefObject } from 'react';

/** The engine's real table only — never its hidden measuring copy. */
const HEAD_SELECTOR = '.dt-fit-wrap > table > thead > tr > th [data-rpt-col]';

function readKeys(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(HEAD_SELECTOR)].map(
    (el) => el.dataset.rptCol ?? '',
  );
}

export function useVisibleColumnKeys(rootRef: RefObject<HTMLElement | null>): string[] {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const next = readKeys(root);
      setKeys((prev) =>
        prev.length === next.length && prev.every((k, i) => k === next[i]) ? prev : next,
      );
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [rootRef]);
  return keys;
}
