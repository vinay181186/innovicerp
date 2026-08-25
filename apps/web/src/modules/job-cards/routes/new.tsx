// New Job Card (parity: addJC L6020). Tier-gated on jc_create `entry` (Production).
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
  const { sourceLineId } = jobCardNewRoute.useSearch();
  // Tier-driven, per department (jc_create sits in Production). The list's create
  // buttons are hidden without entry rights, but this URL-reachable form had no
  // gate of its own — typing the URL still handed over the create form. The
  // server refuses the save either way; this stops the form appearing at all.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jc_create');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ You do not have create access to Job Cards. Ask an admin for L2 Data Entry or above in
          Production.
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
