// New Job Card (parity: addJC L6020). Write-gated to admin/manager (canEntry).
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { JobCardForm } from '../components/job-card-form';

export const jobCardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/new',
  component: JobCardNewPage,
});

function JobCardNewPage(): React.JSX.Element {
  const { data: me } = useSession();
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
      <JobCardForm />
    </div>
  );
}
