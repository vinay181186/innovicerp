// JC Status deep-link page — thin wrapper around the shared JcStatusContent
// (also used by the in-list modal). Legacy viewJCStatus is a modal; this route
// keeps the status screen deep-linkable / shareable as a page too.
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
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
  return (
    <div>
      <Link to="/job-cards" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Job Cards
      </Link>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        JC Status{jc?.code ? ` - ${jc.code}` : ''}
      </div>
      <JcStatusContent id={id} />
      <RelatedDocsPanel module="job-cards" id={id} />
    </div>
  );
}
