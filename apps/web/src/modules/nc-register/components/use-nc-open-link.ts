// ADR-312 — /nc-register/<id>?open=dispose | ?open=dc (the home check links):
// open the NC detail's existing Dispose / Create DC pop-up once, then strip
// ?open= so a refresh does not reopen it. Waits for the NC and the access to
// load. Dispose opens only for an NC Advance user; Create DC hands the pop-up
// the NC version, and the pop-up's own gate (awaiting a DC + OSP Outward DC
// entry) decides whether it shows — otherwise the page shows as normal.

import { useEffect } from 'react';

export type NcOpenLink = 'dispose' | 'dc';

export function useNcOpenLink(args: {
  open: NcOpenLink | undefined;
  /** The loaded NC's updatedAt; undefined while it loads. */
  updatedAt: string | undefined;
  /** NC Advance (nc_dispose); undefined while access loads. */
  canDispose: boolean | undefined;
  onDispose: () => void;
  onDc: (updatedAt: string) => void;
  strip: () => void;
}): void {
  const { open, updatedAt, canDispose, onDispose, onDc, strip } = args;
  useEffect(() => {
    if (!open || updatedAt === undefined || canDispose === undefined) return;
    if (open === 'dispose' && canDispose) onDispose();
    if (open === 'dc') onDc(updatedAt);
    strip();
    // Acts on the link only; the callbacks are fresh closures every render.
  }, [open, updatedAt, canDispose]);
}
