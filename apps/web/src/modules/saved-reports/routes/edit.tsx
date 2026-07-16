import type { AdHocSpec } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePreviewSpec, useSavedReport, useSourceCatalog, useUpdateSavedReport } from '../api';
import { Builder, type SaveInput } from '../components/builder';

export const savedReportEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports/$id/edit',
  component: SavedReportEditPage,
});

function SavedReportEditPage() {
  const { id } = savedReportEditRoute.useParams();
  const navigate = useNavigate();
  const sourcesQ = useSourceCatalog();
  const reportQ = useSavedReport(id);
  const previewMutation = usePreviewSpec();
  const updateMutation = useUpdateSavedReport(id);
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
    updateMutation.mutate(
      {
        name: input.name,
        description: input.description,
        sourceKey: input.spec.sourceKey,
        spec: input.spec,
        isShared: input.isShared,
      },
      {
        onSuccess: () => {
          void navigate({ to: '/saved-reports/$id', params: { id } });
        },
        onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
      },
    );
  };

  const loading = sourcesQ.isLoading || reportQ.isLoading;
  const errored = sourcesQ.isError || reportQ.isError;
  const errorMessage =
    sourcesQ.error instanceof Error
      ? sourcesQ.error.message
      : reportQ.error instanceof Error
        ? reportQ.error.message
        : 'Unknown error';

  return (
    <div>
      {/* Legacy header — renderReportBuilder L17554-59. Legacy serves both new and edit
          from the one renderReportBuilder, so this matches routes/new.tsx exactly. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📄 Excel Report Builder</div>
        <div className="flex items-center gap-2">
          <Link
            to="/saved-reports/$id"
            params={{ id }}
            className="btn btn-sm btn-ghost"
          >
            ← Back to report
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">Loading…</div>
          </div>
        </div>
      ) : errored || !sourcesQ.data || !reportQ.data ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Failed to load</div>
          </div>
          <div className="panel-body">
            <div className="empty-state">{errorMessage}</div>
          </div>
        </div>
      ) : (
        <Builder
          sources={sourcesQ.data.sources}
          initial={{
            name: reportQ.data.name,
            description: reportQ.data.description,
            isShared: reportQ.data.isShared,
            spec: reportQ.data.spec,
          }}
          onSave={onSave}
          onPreview={(spec) => previewMutation.mutate(spec)}
          preview={previewMutation.data}
          previewLoading={previewMutation.isPending}
          previewError={
            previewMutation.error instanceof Error ? previewMutation.error.message : undefined
          }
          onExcel={onExcel}
          excelLoading={excelLoading}
          saving={updateMutation.isPending}
          saveError={saveError}
          saveLabel="Save changes"
        />
      )}
    </div>
  );
}
