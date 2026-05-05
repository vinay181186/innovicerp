import type { AdHocSpec } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/saved-reports/$id" params={{ id }}>
            <ArrowLeft />
            Back to report
          </Link>
        </Button>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit report</h1>
          <p className="text-sm text-muted-foreground">
            Update the spec — preview to validate before saving.
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            </CardContent>
          </Card>
        ) : errored || !sourcesQ.data || !reportQ.data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load</CardTitle>
              <CardDescription>{errorMessage}</CardDescription>
            </CardHeader>
          </Card>
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
    </main>
  );
}
