// JC Status deep-link page — thin wrapper around the shared JcStatusContent.
// Legacy viewJCStatus is a modal; this route keeps the status screen
// deep-linkable / shareable as a page too.
//
// The page's own chrome (Back to List · Print · Excel · Open in Op Entry ·
// Edit Job Card, gated on jc_create.edit) and the Related Documents panel now
// render INSIDE the view body (jc-status-view.tsx), where the 2026-09-18
// layout places them. This wrapper only keeps the "Hide page" guard.
import { createRoute } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { JcStatusContent } from '../components/jc-status-content';

export const jobCardStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id',
  component: JobCardStatusPage,
});

function JobCardStatusPage(): React.JSX.Element {
  const { id } = jobCardStatusRoute.useParams();
  const { data: eff } = useMyAccess();
  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Job Cards. Ask an admin.
      </div>
    );
  }
  return <JcStatusContent id={id} />;
}
