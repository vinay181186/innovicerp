// QC Call Register (legacy renderQCDashboard L4126, page `qcdashboard`). The
// screen body is QcRegisterScreen in 'register' mode — shared with Incoming QC
// (ADR-251), which is the same screen narrowed to Direct Purchase GRNs + Party GRNs.

import { createRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { type QcScreenPatch, QcRegisterScreen } from '../components/qc-register-screen';

// `| undefined` on line / op / page is deliberate: the deep-link effect strips a
// consumed param by writing `undefined` back, and exactOptionalPropertyTypes
// rejects that on a plain `line?: string`.
type QcCallRegisterSearch = {
  line?: string | undefined;
  op?: string | undefined;
  tab?: 'qc' | 'tpi';
  search?: string;
  /** 1-based register page (ADR-201); absent = page 1. */
  page?: number | undefined;
};

export const qcCallRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-call-register',
  // ?line=<grnLineId> deep-opens the Inspect popup for that incoming-QC row;
  // ?op=<jcOpId> does the same for an in-process / final call. Both are
  // consumed — acted on once, then stripped from the URL (see useQcInspect), so
  // a refresh does not throw the box up again.
  // ?tab=tpi opens straight on the TPI tab (the JC op card's 📋 TPI link). It
  // SEEDS the tab only — the tab state stays local.
  // ?search=<text> seeds the search box the same way (the JC op card's
  // 🔬 QC Call button passes its job-card code, so the inspector lands on that
  // card's calls instead of the whole register). Seed only.
  validateSearch: (search: Record<string, unknown>): QcCallRegisterSearch => {
    const out: QcCallRegisterSearch = {};
    if (typeof search.line === 'string') out.line = search.line;
    if (typeof search.op === 'string') out.op = search.op;
    if (search.tab === 'qc' || search.tab === 'tpi') out.tab = search.tab;
    if (typeof search.search === 'string' && search.search.trim()) out.search = search.search;
    const page = Number(search.page);
    if (Number.isInteger(page) && page > 1) out.page = page;
    return out;
  },
  component: QcCallRegisterPage,
});

function QcCallRegisterPage(): React.JSX.Element {
  const params = qcCallRegisterRoute.useSearch();
  const navigate = qcCallRegisterRoute.useNavigate();
  const patchSearch = useCallback(
    (patch: QcScreenPatch): void =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }),
    [navigate],
  );
  return <QcRegisterScreen mode="register" params={params} patchSearch={patchSearch} />;
}
