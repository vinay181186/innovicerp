// QC Documents (legacy renderQCDocuments L23039). SO-pivoted QC-completion.
//
// This file is the slim page shell only: the permission gate, the
// Matrix | File Register | SO Status view switch, and the route. Each view is
// its own component under ../components (ADR-199 split — the old single file was
// 1641 lines, well over the 400-line ceiling), and each is a shared FIT table:
//   • Matrix        → <DataTable tableKey={qcDocsMatrix}>  (dynamic op columns)
//   • File Register → <DataTable tableKey={qcDocsRegister}>
//   • SO Status     → <DataTable tableKey={qcDocsStatus}>  (totals footer)

import { QC_DOC_CATEGORIES } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { pageSearchParam } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { MatrixView } from '../components/matrix-view';
import { RegisterView } from '../components/register-view';
import { SoStatusView } from '../components/so-status-view';

const searchSchema = z.object({
  view: z.enum(['matrix', 'register', 'status']).optional(),
  so: z.string().optional(),
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
  const view = search.view ?? 'matrix';
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

  // Matrix | File Register | SO Status — the view switch sits in every view's
  // ListHeader tools, so each view owns its own count, search and actions.
  const setView = (v: 'matrix' | 'register' | 'status'): void =>
    void navigate({ search: (p) => ({ ...p, view: v }), replace: true });
  const toggle = (
    <div style={{ display: 'flex', gap: 4 }}>
      {(
        [
          ['matrix', 'Matrix'],
          ['register', 'File Register'],
          ['status', 'SO Status'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={view === v ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          aria-pressed={view === v}
          onClick={() => setView(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (view === 'matrix') return <MatrixView toggle={toggle} />;
  if (view === 'register') return <RegisterView toggle={toggle} />;
  return <SoStatusView toggle={toggle} />;
}
