// ADR-230 — which transport this build listens with.
//
// null = no live push: screens still refresh when the user comes back to the
// window, when the network returns, and on the 60 s safety refresh. Each
// variant (v1 Realtime / v2 server push / v3 change poll) sets this one line.

import type { LiveTransport } from './transport';

export const activeTransport: LiveTransport | null = null;
