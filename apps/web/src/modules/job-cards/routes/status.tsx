// JC Status deep-link page — thin wrapper around the shared JcStatusContent
// (also used by the in-list modal). Legacy viewJCStatus is a modal; this route
// keeps the status screen deep-linkable / shareable as a page too.
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Pencil } from 'lucide-react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCard } from '../api';
import { JcStatusContent } from '../components/jc-status-content';

export const jobCardStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id',
  component: JobCardStatusPage,
});

function JobCardStatusPage(): React.JSX.Element {
  const { id } = jobCardStatusRoute.useParams();
  // Shares the JcStatusContent query cache (same key) — no extra request.
  const { data: jc } = useJobCard(id);
  // Edit button uses the SAME key as the page it opens (/job-cards/$id/edit →
  // jc_create edit).
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link to="/job-cards" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Back to Job Cards
        </Link>
        {canWrite ? (
          <Link
            to="/job-cards/$id/edit"
            params={{ id }}
            className="btn btn-primary btn-sm"
            title="Edit this Job Card — add/route ops, or outsource an operation's balance"
          >
            <Pencil size={14} /> Edit Job Card
          </Link>
        ) : null}
      </div>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        JC Status{jc?.code ? ` - ${jc.code}` : ''}
      </div>
      <JcStatusContent id={id} />
      <RelatedDocsPanel module="job-cards" id={id} />
    </div>
  );
}
