// ADR-312 — "open ready" links (the home check's document number): a page
// reads a URL param, opens its existing pop-up / panel for it ONCE, then takes
// the param back out of the URL so a refresh or Back does not reopen it.
//
// `ready` holds the act back until what it needs has loaded (access, the row).
// `act` decides for itself whether to open (the button's own right check) —
// when it does not, the page simply shows as normal. The param is stripped
// either way. Same shape as op-entry's autoOpenedOpRef + `mode` link.

import { useEffect, useRef } from 'react';

export function useLinkOpen<T extends string>(
  value: T | undefined,
  ready: boolean,
  act: (value: T) => void,
  strip: () => void,
): void {
  const doneRef = useRef<string | null>(null);
  const actRef = useRef(act);
  const stripRef = useRef(strip);
  // Latest callbacks, refreshed before the act effect below runs.
  useEffect(() => {
    actRef.current = act;
    stripRef.current = strip;
  });
  useEffect(() => {
    // Once the param is gone, forget it: the same link followed again (while
    // this page stays open) must open again.
    if (!value) {
      doneRef.current = null;
      return;
    }
    if (!ready || doneRef.current === value) return;
    doneRef.current = value;
    actRef.current(value);
    stripRef.current();
  }, [value, ready]);
}
