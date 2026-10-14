// ADR-230 — the timings live updates run on. One place, so the numbers the owner
// was promised ("on the other PC within 3 s, never later than the safety
// refresh") can be read off one file.

/** Wait this long after the LAST change before refreshing, so one save that
 *  writes a header + 40 lines refreshes each screen once, not 41 times. */
export const LIVE_BATCH_WAIT_MS = 750;

/** …but never hold a refresh longer than this, however busy the shop floor is.
 *  A steady stream of changes must not starve the screen. */
export const LIVE_BATCH_MAX_WAIT_MS = 2_000;

/** After the screen's OWN save, ignore the change message that save causes.
 *  The message can arrive before the save's HTTP answer (slow API) or up to the
 *  batch ceiling after it, so the grace covers the save plus the ceiling. */
export const LIVE_OWN_SAVE_GRACE_MS = LIVE_BATCH_MAX_WAIT_MS + 1_000;

/** A transport that has not reported "connected" this long after starting is
 *  treated as down, so a connection that hangs silently still shows the marker
 *  instead of leaving the user trusting a screen nothing is updating. */
export const LIVE_CONNECT_TIMEOUT_MS = 10_000;

/** The safety refresh for the screens people watch (JC, SO, PO, GRN, PR,
 *  Approvals). It closes the one gap nothing can detect: a change message lost
 *  while the connection looked healthy. Runs only while the tab is on screen. */
export const LIVE_FALLBACK_POLL_MS = 60_000;
