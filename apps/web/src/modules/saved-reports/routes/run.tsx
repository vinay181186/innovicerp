import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Edit, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSavedReport, useSavedReportRun } from '../api';
import { ResultTable } from '../components/result-table';

export const savedReportRunRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports/$id',
  component: SavedReportRunPage,
});

function SavedReportRunPage() {
  const { id } = savedReportRunRoute.useParams();
  const reportQ = useSavedReport(id);
  const runQ = useSavedReportRun(id);

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/saved-reports">
            <ArrowLeft />
            Back to saved reports
          </Link>
        </Button>

        {reportQ.isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            </CardContent>
          </Card>
        ) : reportQ.isError || !reportQ.data ? (
          <Card>
            <CardHeader>
              <CardTitle>Saved report not found</CardTitle>
              <CardDescription>
                {reportQ.error instanceof Error
                  ? reportQ.error.message
                  : 'No report exists with this id.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{reportQ.data.name}</h1>
                {reportQ.data.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{reportQ.data.description}</p>
                ) : null}
                <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {reportQ.data.sourceKey} · {reportQ.data.spec.columns.length} columns ·{' '}
                  {reportQ.data.isShared ? 'shared' : 'private'}
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/saved-reports/$id/edit" params={{ id }}>
                  <Edit />
                  Edit
                </Link>
              </Button>
            </div>

            <ResultTable
              data={runQ.data}
              isLoading={runQ.isLoading}
              isError={runQ.isError}
              errorMessage={runQ.error instanceof Error ? runQ.error.message : undefined}
              filenamePrefix={reportQ.data.name.replace(/[^a-z0-9-]/gi, '_').toLowerCase()}
            />
          </>
        )}
      </div>
    </main>
  );
}
