// New Job Card (parity: addJC L6020). Write-gated to admin/manager (canEntry).
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { JobCardForm } from '../components/job-card-form';

// Optional deep-link param: pre-select an SO/JW source line (from SO Status
// Review's "Create Job Card" button). Absent for the plain "New Job Card" link.
const jobCardNewSearchSchema = z.object({
  sourceLineId: z.string().uuid().optional(),
});

export const jobCardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/new',
  validateSearch: jobCardNewSearchSchema,
  component: JobCardNewPage,
});

function JobCardNewPage(): React.JSX.Element {
  const { data: me } = useSession();
  const { sourceLineId } = jobCardNewRoute.useSearch();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  if (!canWrite) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Admin / manager access required to create a job card.
        </div>
      </div>
    );
  }
  return (
    <div>
      <Link to="/job-cards" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Job Cards
      </Link>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        New Job Card
      </div>
      <JobCardForm initialSourceLineId={sourceLineId} />
    </div>
  );
}
