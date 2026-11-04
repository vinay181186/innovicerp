// QC Documents (legacy renderQCDocuments L23039). SO-pivoted QC-completion.
//
// This file is the slim page shell only: the permission gate, the
// Dossier | File Register | SO Status view switch, and the route.
// Dossier (ADR-252) is the first tab and the default. Each view is
// its own component under ../components (ADR-199 split — the old single file was
// 1641 lines, well over the 400-line ceiling), and each is a shared FIT table:
//   • File Register → <DataTable tableKey={qcDocsRegister}>
//   • SO Status     → <DataTable tableKey={qcDocsStatus}>  (totals footer)

import { QC_DOC_CATEGORIES, QC_DOSSIER_ORDER_KINDS } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { pageSearchParam } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DossierView } from '../components/dossier-view';
import { RegisterView } from '../components/register-view';
import { SoStatusView } from '../components/so-status-view';
import { TabStrip } from '@/ui/navigation';

const searchSchema = z.object({
  /** 'matrix' is the retired Matrix tab: old links land on the Dossier. */
  view: z.enum(['dossier', 'matrix', 'register', 'status']).optional(),
  so: z.string().optional(),
  /** ADR-252 Dossier: the order (SO / JWSO), the POL line and the report folder. */
  kind: z.enum(QC_DOSSIER_ORDER_KINDS).optional(),
  orderId: z.string().optional(),
  lineId: z.string().optional(),
  folder: z.string().optional(),
  category: z.enum(QC_DOC_CATEGORIES).optional(),
  search: z.string().optional(),
  /** File Register page (ADR-201, 25 rows). */
  page: pageSearchParam,
});

export const qcDocumentsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-docs',
  validateSearch: searchSchema,
  component: QcDocumentsPage,
});

function QcDocumentsPage(): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const view = search.view === 'matrix' ? 'dossier' : (search.view ?? 'dossier');
  const { data: eff } = useMyAccess();

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qcdocs_upload').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view QC Documents. Ask an admin.
      </div>
    );
  }

  // Dossier | File Register | SO Status — the tabs sit in every view's
  // ListHeader band, so each view owns its own count, search and
  // actions. The search box term belongs to one view, so it does not follow.
  const setView = (v: 'dossier' | 'register' | 'status'): void =>
    void navigate({
      search: (p) => ({ ...p, view: v, search: undefined, page: 1 }),
      replace: true,
    });
  const tabs = (
    <TabStrip
      label="QC Documents views"
      tabs={[
        { key: 'dossier', label: 'Dossier' },
        { key: 'register', label: 'File Register' },
        { key: 'status', label: 'SO Status' },
      ]}
      activeKey={view}
      onChange={(k) =>
        setView(k === 'register' ? 'register' : k === 'status' ? 'status' : 'dossier')
      }
    />
  );

  if (view === 'dossier') return <DossierView tabs={tabs} />;
  if (view === 'register') return <RegisterView tabs={tabs} />;
  return <SoStatusView tabs={tabs} />;
}
