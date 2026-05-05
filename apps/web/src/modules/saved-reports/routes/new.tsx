import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/saved-reports">
            <ArrowLeft />
            Back to saved reports
          </Link>
        </Button>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New report</h1>
          <p className="text-sm text-muted-foreground">
            Pick a source, drag fields into the Columns / Filters / Group-By zones, preview, save.
          </p>
        </div>

        {sourcesQ.isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sources…
              </div>
            </CardContent>
          </Card>
        ) : sourcesQ.isError || !sourcesQ.data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load source catalog</CardTitle>
              <CardDescription>
                {sourcesQ.error instanceof Error ? sourcesQ.error.message : 'Unknown error'}
              </CardDescription>
            </CardHeader>
          </Card>
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
            saving={createMutation.isPending}
            saveError={saveError}
            saveLabel="Save report"
          />
        )}
      </div>
    </main>
  );
}
