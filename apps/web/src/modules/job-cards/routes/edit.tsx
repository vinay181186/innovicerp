// Edit Job Card (parity: editJC L6076). Renders the mode-switched JC Status
// component in EDIT mode — the Job Card detail page's own layout (header line,
// banners, fact block, one Operations panel) with the editable fields as
// inputs in their cells. The header (← Back · code · Edit Job Card · status ·
// Cancel · Save Changes) is drawn by that component, beside the Save it owns.
// Write-gated on jc_create.edit.
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { JcStatusContent } from '../components/jc-status-content';

export const jobCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id/edit',
  component: JobCardEditPage,
});

function JobCardEditPage(): React.JSX.Element {
  const { id } = jobCardEditRoute.useParams();
  // Tier-driven, per department (jc_create sits in Production). Editing a saved
  // Job Card needs `edit` (L3 Editor and up). URL-reachable, so it gates itself.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          You do not have permission to edit Job Cards. Ask an admin.
        </div>
      </div>
    );
  }
  return <JcStatusContent id={id} mode="edit" />;
}
