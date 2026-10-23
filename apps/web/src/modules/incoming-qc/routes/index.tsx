// Incoming QC (QC Wave 2; legacy renderIncomingQC HTML L23748). ADR-251: the
// QC Call Register's own screen (QcRegisterScreen, mode 'incoming') narrowed to
// the two kinds of incoming call — Direct Purchase GRNs and Party
// GRNs (customer material on a JWSO). OSP returns (Against JW PO / DC) and NC
// returns (Against NC) are inspected on the QC Call Register.

import { createRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  type QcScreenPatch,
  QcRegisterScreen,
} from '@/modules/qc-call-register/components/qc-register-screen';

// `| undefined` on line / page: the screen strips a consumed ?line= and resets
// the page by writing `undefined` back (exactOptionalPropertyTypes).
type IncomingQcSearch = {
  line?: string | undefined;
  search?: string;
  /** 1-based page (ADR-201); absent = page 1. */
  page?: number | undefined;
};

export const incomingQcRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'incoming-qc',
  // DEEP LINK: ?line=<grnLineId> opens the Inspect popup for that GRN line, then
  // is taken back out of the URL (a refresh or Back does not reopen it).
  // ?search=<text> seeds the search box. Older links' ?tab= / ?donePage= are
  // ignored.
  validateSearch: (search: Record<string, unknown>): IncomingQcSearch => {
    const out: IncomingQcSearch = {};
    if (typeof search.line === 'string') out.line = search.line;
    if (typeof search.search === 'string' && search.search.trim()) out.search = search.search;
    const page = Number(search.page);
    if (Number.isInteger(page) && page > 1) out.page = page;
    return out;
  },
  component: IncomingQcPage,
});

function IncomingQcPage(): React.JSX.Element {
  const params = incomingQcRoute.useSearch();
  const navigate = incomingQcRoute.useNavigate();
  const patchSearch = useCallback(
    (patch: QcScreenPatch): void =>
      void navigate({
        // Incoming QC has no ?op= — never write one into its URL.
        search: (prev) => ({
          ...prev,
          ...('page' in patch ? { page: patch.page } : {}),
          ...('line' in patch ? { line: undefined } : {}),
        }),
        replace: true,
      }),
    [navigate],
  );
  return <QcRegisterScreen mode="incoming" params={params} patchSearch={patchSearch} />;
}
