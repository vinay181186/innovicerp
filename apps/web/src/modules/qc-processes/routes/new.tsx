import type { CreateQcProcessInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateQcProcess } from '../api';
import { QcProcessForm } from '../components/qc-process-form';

export const qcProcessNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes/new',
  component: QcProcessNewPage,
});

function QcProcessNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateQcProcess();
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <div>
      <Link to="/qc-processes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to QC Process Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">⚙ Add QC Process</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Master record for QC inspection processes — reusable across Route Cards and Job Cards.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <QcProcessForm
            mode="create"
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/qc-processes' })}
            onSubmit={async (values: CreateQcProcessInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                void navigate({ to: '/qc-processes/$id', params: { id: created.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to create QC process.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
