import type { AdHocSpec } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateSavedReport, usePreviewSpec, useSourceCatalog } from '../api';
import { Builder, type SaveInput } from '../components/builder';

export const savedReportNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports/new',
  component: SavedReportNewPage,
});

function SavedReportNewPage() {
  const navigate = useNavigate();
  const sourcesQ = useSourceCatalog();
  const previewMutation = usePreviewSpec();
  const createMutation = useCreateSavedReport();
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [excelLoading, setExcelLoading] = useState(false);

  const onExcel = async (spec: AdHocSpec) => {
    setExcelLoading(true);
    try {
      await apiDownload('/saved-reports/preview/export.xlsx', { method: 'POST', json: spec });
    } finally {
      setExcelLoading(false);
    }
  };

  const onSave = (input: SaveInput) => {
    setSaveError(undefined);
    createMutation.mutate(
      {
        name: input.name,
        description: input.description,
        sourceKey: input.spec.sourceKey,
        spec: input.spec,
        isShared: input.isShared,
      },
      {
        onSuccess: (created) => {
          void navigate({ to: '/saved-reports/$id', params: { id: created.id } });
        },
        onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
      },
    );
  };

  return (
    <div>
      {/* Legacy header — renderReportBuilder L17554-59 */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📄 Excel Report Builder</div>
        <div className="flex items-center gap-2">
          <Link to="/saved-reports" className="btn btn-sm btn-ghost">
            ← Saved Reports
          </Link>
        </div>
      </div>

      {sourcesQ.isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">Loading sources…</div>
          </div>
        </div>
      ) : sourcesQ.isError || !sourcesQ.data ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Failed to load source catalog</div>
          </div>
          <div className="panel-body">
            <div className="empty-state">
              {sourcesQ.error instanceof Error ? sourcesQ.error.message : 'Unknown error'}
            </div>
          </div>
        </div>
      ) : (
        <Builder
          sources={sourcesQ.data.sources}
          initial={{ name: '', description: '', isShared: false, spec: null }}
          onSave={onSave}
          onPreview={(spec) => previewMutation.mutate(spec)}
          preview={previewMutation.data}
          previewLoading={previewMutation.isPending}
          previewError={
            previewMutation.error instanceof Error ? previewMutation.error.message : undefined
          }
          onExcel={onExcel}
          excelLoading={excelLoading}
          saving={createMutation.isPending}
          saveError={saveError}
          saveLabel="Save report"
        />
      )}
    </div>
  );
}
